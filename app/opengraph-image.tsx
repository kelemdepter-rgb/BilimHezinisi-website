import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Bilim Hezinisi — Uyghur digital library";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The share card every page falls back to when it has no picture of its own
 * (a book with a cover overrides it from generateMetadata).
 *
 * Deliberately carries NO Uyghur text. ImageResponse renders through satori,
 * which has no complex-script shaper: Arabic-script letters come out
 * unjoined, and Uyghur's vowels (ى ې ۆ ۇ ۈ) are dropped outright, so
 * «بىلىم خەزىنىسى» renders as "بلىم زنسىىەخ". A card with mangled Uyghur on it
 * is worse than none — and nothing is lost, because every platform shows
 * og:title and og:description as real text beside the image.
 *
 * Generated on request and cached by the CDN rather than stored in Storage,
 * whose 1 GB belongs to books.
 */
const brandMark = readFile(join(process.cwd(), "public/brand.png"));

// Design tokens from the Day theme in app/globals.css.
const PAPER = "#FBF6EC";
const GOLD = "#B0832F";
const GOLD_LIGHT = "#C9A24B";
const INK2 = "#6B5840";

export default async function OpengraphImage() {
  const mark = await brandMark;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
          background: PAPER,
          border: `16px solid ${GOLD}`,
          borderRadius: 8,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img>, not next/image */}
        <img
          src={`data:image/png;base64,${mark.toString("base64")}`}
          alt=""
          width={168}
          height={168}
          style={{ borderRadius: 28 }}
        />

        <div
          style={{
            display: "flex",
            fontSize: 76,
            fontWeight: 700,
            letterSpacing: 14,
            color: GOLD,
          }}
        >
          BILIM HEZINISI
        </div>

        <div style={{ display: "flex", width: 320, height: 3, background: GOLD_LIGHT }} />

        <div style={{ display: "flex", fontSize: 30, letterSpacing: 4, color: INK2 }}>
          UYGHUR DIGITAL LIBRARY
        </div>
      </div>
    ),
    size,
  );
}
