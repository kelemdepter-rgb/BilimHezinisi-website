/**
 * Generates the PWA icon set from the desktop app's own icon.
 *
 * The logo is NOT redrawn for the web: the desktop app, the Android build and
 * the site all have to be recognisably the same thing on a home screen, so
 * `assets/icon.png` in the read-only desktop repo is the single source and
 * this script only resizes and pads it.
 *
 * Runs on demand, not as part of `build` — the source changes about once a
 * year, and the desktop repo is not present on the Vercel builder:
 *
 *   node scripts/build-icons.mjs ["<path to desktop app folder>"]
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const DEFAULT_DESKTOP = resolve(process.cwd(), "..", "bilim hezinisi", "bilim hezinisi pc");

/**
 * The icon's own field colour, sampled from the source's border.
 *
 * Padding has to be this rather than the site's paper `--bg`: the mark is a
 * finished dark tile, and setting it on ivory would read as a sticker on a
 * card instead of one icon. It is also what iOS needs — a transparent touch
 * icon is composited onto black there.
 */
const FIELD = "#01131A";

/**
 * A maskable icon is cropped by the platform to whatever shape it likes, and
 * only the middle 80% is guaranteed to survive. Keeping the tile at 72% of the
 * canvas leaves the gold frame whole under a circle, a squircle and a rounded
 * square alike.
 */
const MASKABLE_SCALE = 0.72;

const desktopRoot = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_DESKTOP;
const source = resolve(desktopRoot, "assets", "icon.png");
const outDir = resolve(process.cwd(), "public", "icons");

try {
  await stat(source);
} catch {
  console.error(`Source icon not found: ${source}`);
  console.error("Pass the desktop app folder as the first argument.");
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

/**
 * Palette PNG at the highest effort setting. These files are downloaded once
 * per install and then cached forever, but "once" still costs the visitor's
 * mobile data — quantising a flat two-colour mark is invisible and roughly
 * quarters the bytes.
 */
function encode(pipeline) {
  return pipeline.png({ palette: true, quality: 90, effort: 10 }).toBuffer();
}

async function write(name, buffer) {
  await writeFile(resolve(outDir, name), buffer);
  return [`icons/${name}`, buffer.length];
}

/** The tile at one size, edge to edge — manifest `purpose: "any"`. */
async function writeAny(size) {
  return write(`icon-${size}.png`, await encode(sharp(source).resize(size, size, { fit: "contain" })));
}

/** The tile inside the safe zone, padded with its own field — `maskable`. */
async function writeMaskable(size) {
  const inner = Math.round(size * MASKABLE_SCALE);
  const tile = await sharp(source).resize(inner, inner, { fit: "contain" }).toBuffer();
  const padded = sharp({
    create: { width: size, height: size, channels: 4, background: FIELD },
  }).composite([{ input: tile, gravity: "centre" }]);
  return write(`icon-maskable-${size}.png`, await encode(padded));
}

/** iOS home screen: fixed size, and never transparent. */
async function writeAppleTouchIcon() {
  return write(
    "apple-touch-icon.png",
    await encode(sharp(source).resize(180, 180, { fit: "contain" }).flatten({ background: FIELD })),
  );
}

const written = [
  await writeAny(192),
  await writeAny(512),
  await writeMaskable(512),
  await writeAppleTouchIcon(),
];

for (const [name, bytes] of written) {
  console.log(`${name.padEnd(32)} ${(bytes / 1024).toFixed(1)} KB`);
}
