import { NextResponse } from "next/server";
import { buildAccountExport, getAccountOwner } from "@/lib/my/account";
import { reportServerError } from "@/lib/server-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download everything this account owns, as one JSON file.
 *
 * A route handler rather than a server action, because the answer IS the
 * file: a server action would have to hand the whole export to the browser as
 * a string and rebuild it there. The session is re-read here — the export is
 * built for whoever is signed in on this request and for nobody else.
 */
export async function GET() {
  const owner = await getAccountOwner();
  if (!owner) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload;
  try {
    payload = await buildAccountExport(owner);
  } catch (error) {
    reportServerError("my/export", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  if (!payload) {
    return NextResponse.json({ error: "not-configured" }, { status: 503 });
  }

  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // ASCII filename only: Content-Disposition is a header, and a header
      // cannot carry Uyghur letters without encoding tricks that browsers
      // disagree about.
      "content-disposition": `attachment; filename="bilim-hezinisi-${stamp}.json"`,
      // Personal data must never sit in a shared cache.
      "cache-control": "no-store, private",
    },
  });
}
