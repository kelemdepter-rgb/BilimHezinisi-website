import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Book requests: an inbox nobody but the admin can read.
 *
 * The spam defence is deliberately three layers, none of which is a
 * third-party captcha (no new vendor, and a captcha that cannot be read in
 * Uyghur is a wall in front of the people this is for):
 *
 *   1. A rate limit per address, in lib/rate-limit.ts.
 *   2. A honeypot field and a minimum time to fill the form. Both are
 *      SILENTLY accepted — a bot that is told it failed learns how to pass.
 *   3. Hard daily and total caps in the database itself (migration 0022), so
 *      posting straight to PostgREST with the public anon key gains nothing.
 */

/** What the database will store; anything longer is refused there too. */
export const REQUEST_LIMITS = {
  title: 200,
  author: 120,
  note: 500,
  contact: 160,
} as const;

/**
 * How quickly a form may be submitted after it was served.
 *
 * A person reads the labels and types a book's name; two seconds is not
 * enough time to have done that, and is well under the time an honest reader
 * takes even when pasting.
 */
export const MIN_FILL_SECONDS = 2;

/** How long a served form stays valid, so a stamp cannot be replayed forever. */
const STAMP_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * The key the form's timestamp is signed with.
 *
 * Derived from the service-role key by hashing rather than used directly: the
 * result is a key of this one purpose, and the secret it came from cannot be
 * recovered from a signature. Both stay on the server; neither is ever sent to
 * a browser or logged. Without a signature the timestamp would be a number a
 * bot could simply write, and the "too fast" check would mean nothing.
 */
function stampKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "bilim-hezinisi-book-request";
  return createHash("sha256").update(`${secret}:book-request-stamp`).digest();
}

/** A signed "this form was served at" token, put in a hidden field. */
export function issueStamp(now = Date.now()): string {
  const signature = createHmac("sha256", stampKey()).update(String(now)).digest("base64url");
  return `${now}.${signature}`;
}

/** Seconds since the form was served, or null when the stamp is not ours. */
export function readStamp(value: unknown, now = Date.now()): number | null {
  if (typeof value !== "string") return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;

  const issued = Number(value.slice(0, dot));
  if (!Number.isFinite(issued)) return null;

  const expected = createHmac("sha256", stampKey()).update(String(issued)).digest("base64url");
  const given = value.slice(dot + 1);
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, which would turn a forged stamp into a 500.
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;

  const age = now - issued;
  if (age < 0 || age > STAMP_TTL_MS) return null;
  return age / 1000;
}

export type BookRequest = {
  id: number;
  title: string;
  author: string;
  note: string;
  contact: string;
  handled: boolean;
  created_at: string;
};

export type SubmitOutcome = "sent" | "full" | "failed";

/**
 * Write one request.
 *
 * Goes in through the ordinary server client, so the row is inserted by the
 * caller's own role and the policy in migration 0022 is what allows it — the
 * service-role key is not used here, and a change to that policy would show up
 * as a failure rather than being quietly bypassed.
 */
export async function insertBookRequest(input: {
  title: string;
  author: string;
  note: string;
  contact: string;
}): Promise<SubmitOutcome> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return "failed";

  const { error } = await supabase.from("book_requests").insert({
    title: input.title.slice(0, REQUEST_LIMITS.title),
    author: input.author.slice(0, REQUEST_LIMITS.author),
    note: input.note.slice(0, REQUEST_LIMITS.note),
    contact: input.contact.slice(0, REQUEST_LIMITS.contact),
  });
  if (!error) return "sent";

  // The trigger's own words, turned into something a reader can act on.
  const message = `${error.message} ${error.details ?? ""}`;
  if (message.includes("book_requests_daily_cap") || message.includes("book_requests_total_cap")) {
    return "full";
  }
  return "failed";
}

/** The inbox, newest first. RLS returns nothing at all to anyone but an admin. */
export async function listBookRequests(limit = 100): Promise<BookRequest[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("book_requests")
    .select("id, title, author, note, contact, handled, created_at")
    .order("handled", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(1, limit), 200));
  if (error) return [];
  return (data as BookRequest[] | null) ?? [];
}

/** How many are still waiting. Zero for anyone who is not an admin. */
export async function countOpenRequests(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from("book_requests")
    .select("id", { count: "exact", head: true })
    .eq("handled", false);
  if (error) return 0;
  return count ?? 0;
}
