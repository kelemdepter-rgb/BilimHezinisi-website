import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every object-storage call in the app goes through this module.
 *
 * The implementation is Supabase Storage today and there is no reason to
 * change that — it is free and already in use. The point of funnelling
 * uploads, URLs and deletes through one file is that moving to another
 * provider later (Cloudflare R2, say) becomes a one-file change instead of a
 * hunt through components. The Supabase client is passed in, so this works
 * unchanged from a Server Component, a Server Action or the browser.
 */

export type Bucket = "covers" | "book-files";

/** Deterministic object path for a book's cover or original file. */
export function storagePath(bookId: number, fileName: string, kind: "cover" | "file"): string {
  const ext = (fileName.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  return kind === "cover" ? `${bookId}/cover.${ext}` : `${bookId}/original.${ext}`;
}

export async function uploadFile(
  client: SupabaseClient,
  bucket: Bucket,
  path: string,
  body: Blob | File,
): Promise<string> {
  const { error } = await client.storage.from(bucket).upload(path, body, {
    upsert: true,
    contentType: body.type || undefined,
    // Covers are immutable per path; let the CDN hold them for a year.
    cacheControl: "31536000",
  });
  if (error) throw new Error(error.message);
  return path;
}

export function getPublicUrl(client: SupabaseClient, bucket: Bucket, path: string): string {
  return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export async function removeFiles(
  client: SupabaseClient,
  bucket: Bucket,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  await client.storage.from(bucket).remove(paths);
}

/**
 * Re-encode a cover to WebP, capped at `maxWidth`, to keep egress and storage
 * small. Browser-only (uses canvas). Returns null if the image cannot be read.
 */
export async function compressCover(
  file: Blob,
  maxWidth = 400,
  quality = 0.8,
): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxWidth / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((blob) => resolve(blob), "image/webp", quality),
    );
  } catch {
    return null;
  }
}
