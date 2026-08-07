import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { BookMetadataInput } from "@/lib/books/types";

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

/** Upload straight to Storage from the browser; returns the stored object path. */
export async function uploadToBucket(
  bucket: "covers" | "book-files",
  path: string,
  body: Blob | File,
): Promise<string> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.storage.from(bucket).upload(path, body, {
    upsert: true,
    contentType: body.type || undefined,
  });
  if (error) throw new Error(error.message);
  return path;
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

/** Storage object path for a book's cover / original file. */
export function storagePath(bookId: number, fileName: string, kind: "cover" | "file"): string {
  const ext = (fileName.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  return kind === "cover" ? `${bookId}/cover.${ext}` : `${bookId}/original.${ext}`;
}
