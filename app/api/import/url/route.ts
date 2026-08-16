import { NextResponse } from "next/server";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { requireStaff } from "@/lib/admin/guards";
import { MSG } from "@/lib/admin/messages";
import { sanitizeHtml } from "@/lib/sanitize";
import { reportServerError } from "@/lib/server-log";

/** Readability needs a DOM. */
export const runtime = "nodejs";

/** Only small article pages — this route must never become a file pipeline. */
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export async function POST(request: Request) {
  try {
    await requireStaff();
  } catch {
    return NextResponse.json({ ok: false, error: MSG.forbidden }, { status: 403 });
  }

  let target = "";
  try {
    const body = (await request.json()) as { url?: string };
    target = String(body.url ?? "").trim();
  } catch {
    return NextResponse.json({ ok: false, error: "تور ئادرېسى ئوقۇلمىدى." }, { status: 400 });
  }

  if (!target) {
    return NextResponse.json({ ok: false, error: "تور ئادرېسى قۇرۇق." }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ ok: false, error: "تور ئادرېسى خاتا." }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ ok: false, error: "تور ئادرېسى خاتا." }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let html = "";
  try {
    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) {
      return NextResponse.json(
        { ok: false, error: `تور بەت ئېچىلمىدى (${response.status}).` },
        { status: 422 },
      );
    }
    const type = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(type)) {
      return NextResponse.json(
        { ok: false, error: "بۇ ئادرېس تور بەت ئەمەس." },
        { status: 415 },
      );
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_HTML_BYTES) {
      return NextResponse.json({ ok: false, error: "تور بەت بەك چوڭ." }, { status: 413 });
    }
    html = new TextDecoder("utf-8").decode(buffer);
  } catch {
    return NextResponse.json(
      { ok: false, error: "تور بەتكە يېتىپ بولمىدى. ئادرېسنى تەكشۈرۈڭ." },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }

  try {
    // Imported HERE, not at the top of the file. A top-level `import { JSDOM }`
    // is what took this route down in production: jsdom fails to load in
    // Vercel's function runtime, and a module that cannot be evaluated answers
    // 500 to everything — this route was returning 500 to unauthenticated
    // callers that should have been refused with 403, which is how the same
    // fault in the notebook was finally traced. Readability genuinely needs a
    // DOM, so jsdom stays; loading it late means the failure is confined to the
    // one feature that needs it, and is reported rather than fatal.
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM(html, { url: parsed.toString() });
    const article = new Readability(dom.window.document).parse();
    const rawContent = article?.content ?? "";
    if (!rawContent) {
      return NextResponse.json(
        { ok: false, error: "بۇ تور بەتتىن ماقالە تېكىستى چىقمىدى." },
        { status: 422 },
      );
    }
    // Sanitize the extracted article before it becomes book content.
    const clean = sanitizeHtml(rawContent, dom.window);
    const turndown = new TurndownService({ headingStyle: "atx" });
    const text = turndown.turndown(clean);

    return NextResponse.json({
      ok: true,
      text,
      title: (article?.title ?? "").trim() || parsed.host,
      author: (article?.byline ?? "").trim(),
    });
  } catch (error) {
    reportServerError("import/url:readability", error);
    return NextResponse.json(
      { ok: false, error: "تور بەتنى تەھلىل قىلغىلى بولمىدى. ھۆججەت قىلىپ يوللاڭ." },
      { status: 422 },
    );
  }
}
