/**
 * The author and title a .docx already knows about itself.
 *
 * A batch import is only worth having if the admin corrects fields rather than
 * types them, and Word writes both of these into `docProps/core.xml` on every
 * save. mammoth reads the document body and nothing else, so this reads the
 * one small part of the archive that carries the metadata.
 *
 * WHY THERE IS A ZIP READER HERE. A .docx is a zip, and the obvious answer is
 * a zip library — but the two already in the tree (JSZip under `docx`, and the
 * one mammoth bundles) are transitive dependencies with no public path to
 * them, and adding a third for one 1 KB file would be paid for by every
 * admin's browser. The whole reader is below: find the central directory, find
 * one entry, inflate it with the platform's own DecompressionStream. Nothing
 * else in the archive is touched, and a file that turns out not to be a zip at
 * all simply yields nothing.
 *
 * Nothing here can fail loudly. A missing, damaged or unreadable core.xml
 * means "this file does not say who wrote it", and an empty author field is
 * exactly right for that — never a guess.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** A zip comment can be 64 KB; the record itself is 22 bytes. */
const MAX_EOCD_SEARCH = 22 + 0xffff;

export type DocxProperties = { title: string; author: string };

export const NO_PROPERTIES: DocxProperties = { title: "", author: "" };

/** Offset of the end-of-central-directory record, or -1. */
function findEndOfCentralDirectory(view: DataView): number {
  const from = Math.max(0, view.byteLength - MAX_EOCD_SEARCH);
  for (let at = view.byteLength - 22; at >= from; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  return -1;
}

/** Raw bytes of one named entry, still compressed, plus how it was stored. */
function locateEntry(
  bytes: Uint8Array,
  name: string,
): { method: number; body: Uint8Array } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) return null;

  const entries = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();

  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== CENTRAL_SIGNATURE) return null;

    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const entryName = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

    if (entryName === name) {
      if (localOffset + 30 > bytes.byteLength) return null;
      if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) return null;
      // The local header repeats the name and carries its OWN extra field,
      // which is routinely a different length from the central one.
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const end = start + compressedSize;
      if (end > bytes.byteLength) return null;
      return { method, body: bytes.subarray(start, end) };
    }

    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** Inflate a stored or deflated entry. Anything else is refused. */
async function inflate(entry: { method: number; body: Uint8Array }): Promise<string | null> {
  if (entry.method === 0) return new TextDecoder().decode(entry.body);
  if (entry.method !== 8) return null;
  if (typeof DecompressionStream !== "function") return null;

  // Response rather than Blob: it takes a typed-array view directly, which
  // keeps this working the same way in a browser and in a test runner.
  const body = new Response(entry.body as BodyInit).body;
  if (!body) return null;
  const stream = body.pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

/** The text of one element, whatever namespace prefix the producer used. */
function textOf(document_: Document, local: string): string {
  const direct = document_.getElementsByTagName(`dc:${local}`)[0];
  if (direct?.textContent) return direct.textContent.trim();
  const namespaced = document_.getElementsByTagNameNS("*", local)[0];
  return namespaced?.textContent?.trim() ?? "";
}

/**
 * Read `docProps/core.xml` out of a .docx.
 *
 * Returns empty strings for anything the file does not actually state — a
 * batch import must never invent an author.
 */
export async function readDocxProperties(buffer: ArrayBuffer): Promise<DocxProperties> {
  try {
    const entry = locateEntry(new Uint8Array(buffer), "docProps/core.xml");
    if (!entry) return NO_PROPERTIES;
    const xml = await inflate(entry);
    if (!xml) return NO_PROPERTIES;

    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    if (parsed.getElementsByTagName("parsererror").length > 0) return NO_PROPERTIES;

    return { title: textOf(parsed, "title"), author: textOf(parsed, "creator") };
  } catch {
    // Not a zip, a zip64 archive, a truncated download — all of them mean the
    // same thing here: the file did not tell us anything.
    return NO_PROPERTIES;
  }
}
