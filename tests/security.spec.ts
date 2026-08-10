import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * These do not go through the site. They talk to Supabase with the PUBLIC anon
 * key — exactly what anyone can extract from the browser bundle — and try to
 * read things they must not be able to read. A UI test could only prove the UI
 * does not show drafts; this proves the database refuses to hand them over.
 */
function anonClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

test.describe("row level security", () => {
  test("an anonymous reader cannot see draft books", async () => {
    const anon = anonClient();

    const { data: drafts } = await anon.from("books").select("id, title").eq("status", "draft");
    expect(drafts ?? [], "drafts must never come back for anon").toEqual([]);

    // Even asking for everything returns only published rows.
    const { data: all } = await anon.from("books").select("id, status");
    for (const book of all ?? []) {
      expect(book.status, `book ${book.id} must be published`).toBe("published");
    }
  });

  test("an anonymous reader cannot read a draft book's pages", async () => {
    const service = serviceClient();
    const { data: draft } = await service
      .from("books")
      .select("id")
      .eq("status", "draft")
      .limit(1)
      .maybeSingle();
    test.skip(!draft, "no draft book in the library to test against");

    const anon = anonClient();
    const { data: pages } = await anon.from("book_pages").select("page_no").eq("book_id", draft!.id);
    expect(pages ?? [], "a draft's pages must not be readable").toEqual([]);

    // ...and its detail page is a 404 rather than a peek at the title.
    const { data: book } = await anon.from("books").select("id").eq("id", draft!.id).maybeSingle();
    expect(book).toBeNull();
  });

  test("an anonymous reader cannot read anyone's personal rows", async () => {
    const anon = anonClient();
    for (const table of [
      "bookmarks",
      "book_notes",
      "reading_progress",
      "recent_reads",
      "note_documents",
      "quran_bookmarks",
      "profiles",
    ]) {
      const { data } = await anon.from(table).select("*").limit(5);
      expect(data ?? [], `${table} must be empty for anon`).toEqual([]);
    }
  });

  test("an anonymous visitor cannot write", async () => {
    const anon = anonClient();

    const { error: bookError } = await anon
      .from("books")
      .insert({ title: "__rls_probe__", status: "published" });
    expect(bookError, "inserting a book must be refused").not.toBeNull();

    const { error: categoryError } = await anon.from("categories").insert({ name: "__rls_probe__" });
    expect(categoryError, "inserting a category must be refused").not.toBeNull();

    const { error: quranError } = await anon
      .from("quran_ayas")
      .insert({ sura: 1, aya: 1, text_ar: "x", text_ar_simple: "x" });
    expect(quranError, "writing to the Quran must be refused").not.toBeNull();

    // Nothing landed.
    const service = serviceClient();
    const { count } = await service
      .from("books")
      .select("id", { count: "exact", head: true })
      .eq("title", "__rls_probe__");
    expect(count ?? 0, "no probe row may exist").toBe(0);
  });

  test("published books and the Quran stay readable without an account", async () => {
    // The mirror image: the lockdown must not have broken public reading.
    const anon = anonClient();

    const { data: published } = await anon.from("books").select("id").eq("status", "published").limit(1);
    expect((published ?? []).length, "published books must be readable").toBeGreaterThan(0);

    const { data: suras } = await anon.from("quran_suras").select("number").limit(200);
    expect((suras ?? []).length, "the Quran must be readable").toBe(114);

    const { data: hits, error } = await anon.rpc("search_quran", { q: "الله", lim: 5, off: 0 });
    expect(error).toBeNull();
    expect((hits ?? []).length, "anonymous search must work").toBeGreaterThan(0);
  });

  test("one anonymous request cannot drain a public table", async () => {
    // quran_ayas is the honest table to test this on: 6,236 rows that anyone
    // is genuinely allowed to read, so nothing but the row cap can hold the
    // answer down. (book_pages would pass for the wrong reason — RLS already
    // reduces it to the published books.) Migration 0009 pins the cap on the
    // anon role inside PostgREST, so it holds however the request is made.
    const anon = anonClient();
    const { data: unbounded } = await anon.from("quran_ayas").select("sura, aya");
    expect((unbounded ?? []).length, "an unbounded anon read is capped").toBeLessThanOrEqual(1000);

    // Asking for a huge explicit range does not get around it either.
    const { data: ranged } = await anon.from("quran_ayas").select("sura, aya").range(0, 9999);
    expect((ranged ?? []).length, "a wide range is capped too").toBeLessThanOrEqual(1000);
  });
});

test.describe("crawler rules", () => {
  test("robots.txt keeps crawlers out of the admin area and personal pages", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();
    expect(body).toContain("User-Agent: *");
    for (const path of ["/admin", "/my/", "/api/"]) {
      expect(body, `${path} must be disallowed`).toContain(`Disallow: ${path}`);
    }
    expect(body).toMatch(/Sitemap: https?:\/\/\S+\/sitemap\.xml/);
  });

  test("the sitemap lists published books and no drafts", async ({ request }) => {
    const service = serviceClient();
    const [{ data: published }, { data: drafts }] = await Promise.all([
      service.from("books").select("id").eq("status", "published").limit(5),
      service.from("books").select("id").eq("status", "draft").limit(5),
    ]);

    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain("<urlset");
    expect(xml, "the Quran belongs in the sitemap").toContain("/quran/114");

    for (const book of published ?? []) {
      expect(xml, `published book ${book.id} must be listed`).toContain(`/books/${book.id}<`);
    }
    for (const book of drafts ?? []) {
      expect(xml, `draft ${book.id} must NOT be listed`).not.toContain(`/books/${book.id}<`);
    }
  });

  test("a draft book page tells crawlers to stay away", async ({ request }) => {
    const service = serviceClient();
    const { data: draft } = await service
      .from("books")
      .select("id")
      .eq("status", "draft")
      .limit(1)
      .maybeSingle();
    test.skip(!draft, "no draft book in the library to test against");

    // Anonymous: the page is simply not there.
    const response = await request.get(`/books/${draft!.id}`);
    expect(response.status(), "a draft must 404 for anonymous visitors").toBe(404);
  });
});

test.describe("share cards", () => {
  test("a published book exposes Open Graph tags with its title", async ({ request }) => {
    const service = serviceClient();
    const { data: book } = await service
      .from("books")
      .select("id, title")
      .eq("status", "published")
      .limit(1)
      .maybeSingle();
    test.skip(!book, "no published book to test against");

    const html = await (await request.get(`/books/${book!.id}`)).text();
    expect(html).toContain('property="og:title"');
    expect(html, "the share card must carry the real title").toContain(book!.title);
    expect(html).toContain('property="og:type" content="book"');
    expect(html).toContain('name="twitter:card"');
    expect(html).toMatch(/<link rel="canonical" href="https?:\/\/[^"]+\/books\/\d+"/);
    expect(html, "structured data must describe a Book").toContain('"@type":"Book"');
  });

  test("the home page describes the site and its search to crawlers", async ({ request }) => {
    const html = await (await request.get("/")).text();
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain('"@type":"SearchAction"');
    expect(html).toContain('property="og:site_name"');
  });
});
