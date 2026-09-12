import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  SEARCH_HEALTH_KEY,
  SEARCH_HEALTH_NAMES,
  anonymousSearchHealthClient,
  runSearchHealthCheck,
} from "@/lib/search/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * The search self-check below makes three calls of up to 10 s each after the
 * ping; a 10 s function limit would cut the route off before it could record
 * them. Hobby allows up to 60 s.
 */
export const maxDuration = 45;

/**
 * Keep-alive endpoint.
 *
 * A Supabase free project pauses after about 7 idle days, which would take a
 * free public library offline. A daily Vercel cron (vercel.json) touches this
 * route so the project always has recent activity.
 *
 * One trivial count query; returns no user data and no secrets. When
 * CRON_SECRET is set, callers must present it — the cron does so automatically.
 *
 * After the ping it also runs the search self-check (lib/search/health.ts):
 * three fixed calls as an anonymous visitor, recorded under the
 * `search_health` setting for /admin. Whole-library search had been failing
 * for every reader without an account before anyone noticed (2026-09-11);
 * this is what notices next time, without a second cron.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
    if (provided !== secret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, reason: "not-configured" }, { status: 503 });
  }

  const { error } = await supabase
    .from("categories")
    .select("id", { count: "exact", head: true });
  if (error) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  // Record the ping so /admin can show the library is alive.
  await supabase
    .from("settings")
    .upsert(
      { key: "last_health_ping", value: new Date().toISOString(), is_public: false },
      { onConflict: "key" },
    );

  // The self-check's outcome is recorded whatever it is, and only the ping
  // above decides the cron's answer: a slow search must never make the
  // keep-alive look dead.
  const anonymous = anonymousSearchHealthClient();
  const searchHealth = anonymous ? await runSearchHealthCheck(anonymous) : null;
  if (searchHealth) {
    await supabase
      .from("settings")
      .upsert({ key: SEARCH_HEALTH_KEY, value: searchHealth, is_public: false }, { onConflict: "key" });
  }

  return NextResponse.json(
    {
      ok: true,
      at: new Date().toISOString(),
      search:
        searchHealth &&
        Object.fromEntries(
          SEARCH_HEALTH_NAMES.map((name) => [
            name,
            { ok: searchHealth[name].ok, ms: searchHealth[name].ms, code: searchHealth[name].code },
          ]),
        ),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
