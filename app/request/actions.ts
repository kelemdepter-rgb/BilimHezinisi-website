"use server";

import { redirect } from "next/navigation";
import { BOOK_REQUEST_RULE, callerKey, isRateLimited } from "@/lib/rate-limit";
import { MIN_FILL_SECONDS, insertBookRequest, readStamp } from "@/lib/requests";

/**
 * Take one book request, or quietly drop it.
 *
 * The two spam checks below both end in `sent`. A bot that is told which
 * field gave it away simply stops filling that field, so the honest and the
 * discarded paths are indistinguishable from outside — the only difference is
 * that one of them wrote a row.
 */
export async function submitRequestAction(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const author = String(formData.get("author") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const contact = String(formData.get("contact") ?? "").trim();

  if (!title) redirect("/request?xata=empty");

  // Before anything is written, and before the database is touched at all.
  if (isRateLimited(`request:${await callerKey()}`, BOOK_REQUEST_RULE)) {
    redirect("/request?xata=rate");
  }

  // A field no person can see, and a form no person could have filled that
  // fast. A stamp that is missing, forged or stale reads as null.
  const honeypot = String(formData.get("website") ?? "").trim();
  const elapsed = readStamp(formData.get("ts"));
  if (honeypot || elapsed === null || elapsed < MIN_FILL_SECONDS) {
    redirect("/request?uqtur=sent");
  }

  const outcome = await insertBookRequest({ title, author, note, contact });
  redirect(`/request?${outcome === "sent" ? "uqtur=sent" : `xata=${outcome}`}`);
}
