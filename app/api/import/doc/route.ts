import { NextResponse } from "next/server";
import WordExtractor from "word-extractor";
import { requireStaff } from "@/lib/admin/guards";
import { MSG } from "@/lib/admin/messages";

/** word-extractor is Node-only. */
export const runtime = "nodejs";

/** Vercel caps request bodies at 4.5 MB — keep headroom for the multipart envelope. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Legacy .doc import. Every other format is parsed in the browser; only this
 * one needs a Node library, so it accepts small files and tells the admin to
 * convert anything larger in the desktop app.
 */
export async function POST(request: Request) {
  try {
    await requireStaff();
  } catch {
    return NextResponse.json({ ok: false, error: MSG.forbidden }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BYTES + 512 * 1024) {
    return NextResponse.json(
      {
        ok: false,
        error: "ھۆججەت بەك چوڭ. كومپيۇتېر نۇسخىسىدا .docx ياكى PDF قىلىپ ساقلاڭ.",
      },
      { status: 413 },
    );
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (value instanceof File) file = value;
  } catch {
    return NextResponse.json({ ok: false, error: "ھۆججەتنى قوبۇل قىلغىلى بولمىدى." }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json({ ok: false, error: "ھۆججەت تاپشۇرۇلمىدى." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: "بۇ .doc ھۆججەت 4 MB دىن چوڭ. كومپيۇتېر نۇسخىسىدا .docx ياكى PDF قىلىپ ساقلاڭ.",
      },
      { status: 413 },
    );
  }

  try {
    const extractor = new WordExtractor();
    const document = await extractor.extract(Buffer.from(await file.arrayBuffer()));
    const text = document.getBody() ?? "";
    if (!text.trim()) {
      return NextResponse.json(
        { ok: false, error: "بۇ ھۆججەتتىن تېكىست چىقمىدى." },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true, text });
  } catch {
    return NextResponse.json(
      { ok: false, error: "DOC ھۆججەتنى ئوقۇغىلى بولمىدى. كومپيۇتېر نۇسخىسىدا ئېچىپ كۆرۈڭ." },
      { status: 422 },
    );
  }
}
