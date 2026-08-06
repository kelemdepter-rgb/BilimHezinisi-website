/**
 * Copy the pdf.js worker, cMaps and standard fonts out of node_modules into
 * public/pdfjs so they are served from our own origin (CLAUDE.md forbids
 * third-party CDNs at runtime).
 *
 * The cMaps matter specifically for this library: without them pdf.js cannot
 * map CID-keyed Arabic/Uyghur fonts back to Unicode and getTextContent()
 * returns garbage — the same reason the desktop app ships them.
 *
 * Runs automatically via `predev` / `prebuild`; the output is gitignored.
 */
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(src))) {
  console.warn("[copy-pdfjs-assets] pdfjs-dist not installed — skipping.");
  process.exit(0);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

await cp(join(src, "build", "pdf.worker.min.mjs"), join(dest, "pdf.worker.min.mjs"));
await cp(join(src, "cmaps"), join(dest, "cmaps"), { recursive: true });
await cp(join(src, "standard_fonts"), join(dest, "standard_fonts"), { recursive: true });

console.log("[copy-pdfjs-assets] worker, cmaps and standard_fonts copied to public/pdfjs");
