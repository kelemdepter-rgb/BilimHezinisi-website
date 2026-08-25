import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { compressCover, uploadFile, type Bucket } from "@/lib/storage";
import type { BookMetadataInput } from "@/lib/books/types";

export { storagePath } from "@/lib/storage";

/**
 * CLAUDE.md caps a page insert at 500 rows per request. Uyghur text is
 * multi-byte, so 200 keeps each request comfortably small while still
 * finishing a large book in a handful of round trips.
 */
export const PAGE_BATCH_SIZE = 200;

export type DuplicateHit = { id: number; title: string; status: string };

/** Look for an existing book with the same content hash, before anything is written. */
export async function findDuplicate(fileHash: string): Promise<DuplicateHit | null> {
  if (!fileHash) return null;
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase
    .from("books")
    .select("id, title, status")
    .eq("file_hash", fileHash)
    .maybeSingle();
  return (data as DuplicateHit | null) ?? null;
}

export async function createBookRow(
  metadata: BookMetadataInput,
  extras: { format: string; fileHash: string; pageCount: number; contentFormat: string },
): Promise<number> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("books")
    .insert({
      title: metadata.title,
      author: metadata.author,
      category_id: metadata.categoryId,
      format: extras.format,
      date: metadata.date,
      description: metadata.description,
      language: metadata.language,
      status: metadata.status,
      file_hash: extras.fileHash,
      page_count: extras.pageCount,
      content_format: extras.contentFormat,
      uploaded_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return (data as { id: number }).id;
}

/**
 * Insert pages in batches, reporting progress. Resumable: on failure the
 * caller can retry from `failedAtBatch` without re-sending earlier pages.
 */
export async function insertPages(
  bookId: number,
  pages: string[],
  onProgress?: (done: number, total: number) => void,
  startIndex = 0,
): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  for (let index = startIndex; index < pages.length; index += PAGE_BATCH_SIZE) {
    const slice = pages.slice(index, index + PAGE_BATCH_SIZE).map((content, offset) => ({
      book_id: bookId,
      page_no: index + offset + 1,
      content,
    }));
    const { error } = await supabase.from("book_pages").upsert(slice, {
      onConflict: "book_id,page_no",
    });
    if (error) {
      const failure = new Error(error.message) as Error & { failedAtIndex?: number };
      failure.failedAtIndex = index;
      throw failure;
    }
    onProgress?.(Math.min(index + PAGE_BATCH_SIZE, pages.length), pages.length);
  }
}

/**
 * Upload straight to Storage from the browser; returns the stored object path.
 * Covers are re-encoded to a small WebP first — they are the main egress cost.
 */
export async function uploadToBucket(
  bucket: Bucket,
  path: string,
  body: Blob | File,
): Promise<string> {
  const supabase = createSupabaseBrowserClient();
  if (bucket === "covers") {
    const compressed = await compressCover(body);
    if (compressed) {
      return uploadFile(supabase, bucket, path.replace(/\.[^.]+$/, ".webp"), compressed);
    }
  }
  return uploadFile(supabase, bucket, path, body);
}

/**
 * How many pages the database actually holds for a book.
 *
 * The batch importer writes every book as a draft, then asks this, and only
 * publishes when the answer matches what it extracted. Without the check a
 * dropped connection halfway through a 300-page book would publish a third of
 * it, and nobody would notice until a reader hit the missing part.
 */
export async function countStoredPages(bookId: number): Promise<number> {
  const supabase = createSupabaseBrowserClient();
  const { count, error } = await supabase
    .from("book_pages")
    .select("book_id", { count: "exact", head: true })
    .eq("book_id", bookId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Flip a verified draft to the status the admin chose for it. */
export async function setBookStatus(bookId: number, status: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.from("books").update({ status }).eq("id", bookId);
  if (error) throw new Error(error.message);
}

export async function setBookPaths(
  bookId: number,
  paths: { cover_path?: string | null; original_file_path?: string | null },
): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.from("books").update(paths).eq("id", bookId);
  if (error) throw new Error(error.message);
}

/** Clean rollback when the admin cancels or a save fails unrecoverably. */
export async function deletePartialBook(bookId: number): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  await supabase.from("book_pages").delete().eq("book_id", bookId);
  await supabase.from("books").delete().eq("id", bookId);
}
