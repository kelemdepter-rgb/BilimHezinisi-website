import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Keep-alive endpoint.
 *
 * A Supabase free project pauses after about 7 idle days, which would take a
 * free public library offline. A daily Vercel cron (vercel.json) touches this
 * route so the project always has recent activity.
 *
 * One trivial count query; returns no user data and no secrets. When
 * CRON_SECRET is set, callers must present it — the cron does so automatically.
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

  return NextResponse.json(
    { ok: true, at: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
