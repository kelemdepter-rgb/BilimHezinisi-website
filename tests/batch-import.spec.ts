import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { BATCH_PREFIX, hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Importing a folder of books, each with its own details.
 *
 * This spec writes REAL books into the owner's library, because that is the
 * only honest way to prove an import worked: the metadata is read back out of
 * the database afterwards and compared with what was typed, field by field.
 * Everything it creates carries BATCH_PREFIX in its title and is removed again.
 */

/** Long enough to chunk into more than one page, so page counts mean something. */
const PARAGRAPH =
  "بۇ كىتاب ئۇيغۇر تىلىنىڭ تارىخى، ئىملاسى ۋە ئەدەبىياتى ھەققىدە يېزىلغان بولۇپ، " +
  "ئوقۇرمەنلەرگە تىل بىلىمى بويىچە كەڭ چۈشەنچە بېرىدۇ. ";

const body = (times: number) => PARAGRAPH.repeat(times);

const MARKDOWN_TITLE = `${BATCH_PREFIX} قۇتادغۇ بىلىك`;
const DOCX_TITLE = `${BATCH_PREFIX} تارىخ`;
const DOCX_AUTHOR = "مەھمۇد كاشغەرى";

/** The content whose hash is seeded as an existing book, so a row is a duplicate. */
const DUPLICATE_TEXT = `${BATCH_PREFIX} ئوخشاش مەزمۇن.\n\n${body(4)}`;

/** Same normalisation lib/books/chunk.ts applies before hashing. */
function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * A real .docx — four parts is the minimum Word and mammoth both accept. Built
 * here rather than checked in so the author it carries is visible in the test
 * that asserts the author was pre-filled from it.
 */
async function buildDocx(title: string, author: string, text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`,
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>${title}</dc:title><dc:creator>${author}</dc:creator></cp:coreProperties>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${title}</w:t></w:r></w:p>
<w:p><w:r><w:t>${text}</w:t></w:r></w:p>
</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** Everything this spec ever wrote, gone again. */
async function removeSpecBooks(admin: SupabaseClient) {
  await admin.from("books").delete().like("title", `${BATCH_PREFIX}%`);
  await admin.from("books").delete().eq("file_hash", sha256Hex(normalizeText(DUPLICATE_TEXT)));
}

type Payload = { name: string; mimeType: string; buffer: Buffer };

async function batchFiles(): Promise<Payload[]> {
  return [
    {
      name: "01_qutadghu.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(`# ${MARKDOWN_TITLE}\n\n${body(6)}`, "utf8"),
    },
    {
      // No heading and no author anywhere in it: the title has to come from the
      // filename and the author has to stay empty.
      name: `02_${BATCH_PREFIX}-دىۋان.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(body(6), "utf8"),
    },
    {
      name: "03_tarix.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: await buildDocx(DOCX_TITLE, DOCX_AUTHOR, body(6)),
    },
    // Rejected at the door, with the message telling the admin what to do.
    { name: "04_kitab.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n") },
    // Already in the library.
    { name: "05_oxshash.txt", mimeType: "text/plain", buffer: Buffer.from(DUPLICATE_TEXT, "utf8") },
    // Nothing to extract.
    { name: "06_bosh.txt", mimeType: "text/plain", buffer: Buffer.from("   \n\n  \n", "utf8") },
  ];
}

/** Pick the file input and read every file, landing on the review stage. */
async function pickAndRead(page: Page, files: Payload[]) {
  await page.goto("/admin/books/batch");
  await page.getByTestId("batch-file-input").setInputFiles(files);
  await page.getByTestId("batch-read").click();
  await expect(page.getByTestId("batch-stage-1")).toHaveAttribute("aria-current", "step", {
    timeout: 60_000,
  });
}

const rowFor = (page: Page, fileName: string) =>
  page.locator(`[data-testid="batch-row"][data-file="${fileName}"]`);

test.describe("importing many books at once", () => {
  test.beforeEach(async () => {
    const admin = serviceClient();
    await removeSpecBooks(admin);
    // Seed the book that makes one of the files a duplicate. The hash is over
    // the extracted text, exactly as lib/books/hash.ts computes it.
    const { error } = await admin.from("books").insert({
      title: `${BATCH_PREFIX} ئاللىبۇرۇن بار كىتاب`,
      author: "سىناق",
      status: "published",
      format: "TXT",
      language: "ug",
      page_count: 1,
      file_hash: sha256Hex(normalizeText(DUPLICATE_TEXT)),
    });
    if (error) throw new Error(`could not seed the duplicate: ${error.message}`);
  });

  test.afterEach(async () => {
    await removeSpecBooks(serviceClient());
  });

  test("rejects a PDF, marks the suggestions, and never invents an author", async ({ page }) => {
    const files = await batchFiles();
    await pickAndRead(page, files);

    // The PDF never becomes a row, and it is listed as rejected rather than
    // quietly disappearing.
    await expect(page.getByTestId("batch-row")).toHaveCount(5);
    const rejected = page.getByTestId("batch-rejected");
    await expect(rejected).toContainText("04_kitab.pdf");
    await expect(rejected).toContainText("PDF");

    // The Markdown file's own heading became the title, marked as a suggestion.
    const markdown = rowFor(page, "01_qutadghu.md");
    await expect(markdown.getByTestId("batch-title")).toHaveValue(MARKDOWN_TITLE);
    await expect(markdown.getByTestId("batch-title")).toHaveAttribute("data-suggested", "true");
    await expect(markdown.getByTestId("batch-description")).toHaveAttribute(
      "data-suggested",
      "true",
    );
    await expect(markdown).toContainText("تەكلىپ");

    // It names no author, so the field is empty AND is not marked as a
    // suggestion — nothing was suggested, because nothing was known.
    await expect(markdown.getByTestId("batch-author")).toHaveValue("");
    await expect(markdown.getByTestId("batch-author")).toHaveAttribute("data-suggested", "false");

    // The DOCX does name one, and it is taken from the file itself.
    const docx = rowFor(page, "03_tarix.docx");
    await expect(docx.getByTestId("batch-author")).toHaveValue(DOCX_AUTHOR);
    await expect(docx.getByTestId("batch-author")).toHaveAttribute("data-suggested", "true");

    // The empty file failed, with a reason, and did not stop the others.
    const broken = rowFor(page, "06_bosh.txt");
    await expect(broken).toHaveAttribute("data-status", "failed");
    await expect(broken.getByTestId("batch-row-error")).toContainText("تېكىست");

    // The duplicate is named before anything is written.
    const duplicate = rowFor(page, "05_oxshash.txt");
    await expect(duplicate.getByTestId("batch-duplicate")).toContainText(
      `${BATCH_PREFIX} ئاللىبۇرۇن بار كىتاب`,
    );
    await expect(duplicate.getByTestId("batch-skip-duplicate")).toBeChecked();

    // Nothing may be written until every importable row has a category.
    await expect(page.getByTestId("batch-import")).toBeDisabled();
  });

  test("«ھەممىسىگە قوللىنىش» applies to the checked rows, not to every row", async ({ page }) => {
    const files = await batchFiles();
    await pickAndRead(page, files);

    const markdown = rowFor(page, "01_qutadghu.md");
    const text = rowFor(page, `02_${BATCH_PREFIX}-دىۋان.txt`);

    await text.getByTestId("batch-row-select").check();
    await page.getByTestId("batch-bulk-author").fill("تاللانغان ئاپتور");
    await page.getByTestId("batch-apply-author").click();

    await expect(text.getByTestId("batch-author")).toHaveValue("تاللانغان ئاپتور");
    await expect(markdown.getByTestId("batch-author")).toHaveValue("");

    // With nothing checked it means everything, which is the other half of the
    // promise — and the one that would be dangerous if it were the only half.
    await text.getByTestId("batch-row-select").uncheck();
    await page.getByTestId("batch-bulk-author").fill("ھەممىسىنىڭ ئاپتورى");
    await page.getByTestId("batch-apply-author").click();
    await expect(markdown.getByTestId("batch-author")).toHaveValue("ھەممىسىنىڭ ئاپتورى");
    await expect(text.getByTestId("batch-author")).toHaveValue("ھەممىسىنىڭ ئاپتورى");
  });

  test("shows what the batch will cost before a single row is written", async ({ page }) => {
    const files = await batchFiles();
    await pickAndRead(page, files);

    const panel = page.getByTestId("batch-headroom");
    await expect(panel).toBeVisible();
    // A real measurement of the real database, not a placeholder.
    await expect(panel).toContainText("500.0 MB");
    await expect(page.getByTestId("batch-estimate")).toHaveText(/^\d+\.\d MB$/);

    // This library is nowhere near the wall, so no warning is invented.
    await expect(page.getByTestId("batch-over-budget")).toHaveCount(0);
  });

  test("imports three books with three different sets of details", async ({ page }, testInfo) => {
    const files = await batchFiles();
    await pickAndRead(page, files);

    const admin = serviceClient();
    const { data: categoryRows } = await admin
      .from("categories")
      .select("id, name")
      .order("sort_order", { ascending: true })
      .limit(3);
    const categories = (categoryRows as { id: number; name: string }[] | null) ?? [];
    expect(categories.length, "the seeded category tree must exist").toBeGreaterThanOrEqual(3);

    // Three books, three different everything. The viewport is in each title so
    // three parallel projects cannot read each other's rows.
    const tag = testInfo.project.name;
    const wanted = [
      {
        file: "01_qutadghu.md",
        title: `${BATCH_PREFIX} بىرىنچى ${tag}`,
        author: "بىرىنچى ئاپتور",
        description: "بىرىنچى كىتابنىڭ چۈشەندۈرۈشى.",
        category: categories[0],
        status: "published" as const,
      },
      {
        file: `02_${BATCH_PREFIX}-دىۋان.txt`,
        title: `${BATCH_PREFIX} ئىككىنچى ${tag}`,
        author: "ئىككىنچى ئاپتور",
        description: "ئىككىنچى كىتابنىڭ چۈشەندۈرۈشى.",
        category: categories[1],
        status: "draft" as const,
      },
      {
        file: "03_tarix.docx",
        title: `${BATCH_PREFIX} ئۈچىنچى ${tag}`,
        author: "ئۈچىنچى ئاپتور",
        description: "ئۈچىنچى كىتابنىڭ چۈشەندۈرۈشى.",
        category: categories[2],
        status: "published" as const,
      },
    ];

    for (const item of wanted) {
      const row = rowFor(page, item.file);
      await row.getByTestId("batch-title").fill(item.title);
      await row.getByTestId("batch-author").fill(item.author);
      await row.getByTestId("batch-description").fill(item.description);
      await row.getByTestId("batch-category").selectOption(String(item.category.id));
      await row.getByTestId("batch-status").selectOption(item.status);
    }

    await expect(page.getByTestId("batch-import")).toBeEnabled();
    await page.getByTestId("batch-import").click();

    await expect(page.getByTestId("batch-summary")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("batch-summary")).toContainText("3");
    await expect(page.getByTestId("batch-growth")).toBeVisible();

    // Three links out to the new books, and the skipped and failed rows said so.
    await expect(page.getByTestId("batch-result-link")).toHaveCount(3);
    await expect(
      page.locator('[data-testid="batch-result"][data-status="skipped"]'),
    ).toHaveCount(1);
    await expect(page.locator('[data-testid="batch-result"][data-status="failed"]')).toHaveCount(1);

    // ── And now the part that matters: what actually landed in the database ──
    for (const item of wanted) {
      const { data } = await admin
        .from("books")
        .select("id, title, author, description, category_id, status, page_count, format")
        .eq("title", item.title)
        .maybeSingle();
      const book = data as {
        id: number;
        title: string;
        author: string;
        description: string;
        category_id: number;
        status: string;
        page_count: number;
        format: string;
      } | null;

      expect(book, `«${item.title}» must exist`).not.toBeNull();
      expect(book!.author).toBe(item.author);
      expect(book!.description).toBe(item.description);
      expect(book!.category_id).toBe(item.category.id);
      expect(book!.status).toBe(item.status);
      expect(book!.page_count).toBeGreaterThan(0);

      // Every page it claims is really there — no half-imported book.
      const { count } = await admin
        .from("book_pages")
        .select("book_id", { count: "exact", head: true })
        .eq("book_id", book!.id);
      expect(count, `«${item.title}» must have all its pages`).toBe(book!.page_count);

      if (item.status === "published") {
        // And it is readable, which is the whole point of importing it.
        await page.goto(`/books/${book!.id}/read`);
        await expect(page.getByTestId("reader-page").first()).toBeVisible({ timeout: 30_000 });
      }
    }

    // The duplicate was skipped, so the library still holds exactly one of it.
    const { count: duplicates } = await admin
      .from("books")
      .select("id", { count: "exact", head: true })
      .eq("file_hash", sha256Hex(normalizeText(DUPLICATE_TEXT)));
    expect(duplicates).toBe(1);

    // Nothing anywhere in the library is published with no pages behind it.
    const { data: empties } = await admin
      .from("books")
      .select("id, title")
      .eq("status", "published")
      .eq("page_count", 0)
      .like("title", `${BATCH_PREFIX}%`);
    expect(empties ?? []).toHaveLength(0);
  });

  test("keeps what was typed when the tab is closed and reopened", async ({ page }) => {
    const files = await batchFiles();
    await pickAndRead(page, files);

    const typed = `${BATCH_PREFIX} ئەستە قالغان ماۋزۇ`;
    const row = rowFor(page, "01_qutadghu.md");
    await row.getByTestId("batch-title").fill(typed);
    await row.getByTestId("batch-author").fill("ئەستە قالغان ئاپتور");
    // The metadata is written shortly after typing stops.
    await page.waitForTimeout(1200);

    // As if the tab had been closed: everything in memory is gone, and the
    // same files are picked again.
    await page.goto("about:blank");
    await page.goto("/admin/books/batch");
    await expect(page.getByTestId("batch-saved-notice")).toBeVisible();

    await page.getByTestId("batch-file-input").setInputFiles(files);
    await page.getByTestId("batch-read").click();
    await expect(page.getByTestId("batch-stage-1")).toHaveAttribute("aria-current", "step", {
      timeout: 60_000,
    });

    const restored = rowFor(page, "01_qutadghu.md");
    await expect(restored.getByTestId("batch-title")).toHaveValue(typed);
    await expect(restored.getByTestId("batch-author")).toHaveValue("ئەستە قالغان ئاپتور");

    // And it can be thrown away deliberately.
    await page.getByTestId("batch-back").click();
    await page.getByTestId("batch-discard-saved").click();
    await expect(page.getByTestId("batch-notice")).toBeVisible();
    await expect(page.getByTestId("batch-saved-notice")).toHaveCount(0);
  });
});

test.describe("on every screen", () => {
  test("the review list is usable at this width", async ({ page }, testInfo) => {
    const admin = serviceClient();
    await removeSpecBooks(admin);
    const files = await batchFiles();
    await pickAndRead(page, files);

    const width = testInfo.project.use.viewport!.width;
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `no horizontal scroll at ${width}px`).toBeLessThanOrEqual(1);

    // Every field of a row is reachable and typeable, however narrow it is.
    const row = rowFor(page, "01_qutadghu.md");
    await row.getByTestId("batch-title").fill(`${BATCH_PREFIX} تېلېفوندا`);
    await row.getByTestId("batch-category").selectOption({ index: 1 });
    await expect(row.getByTestId("batch-title")).toHaveValue(`${BATCH_PREFIX} تېلېفوندا`);

    // Down to the bottom of a long list and back: the action bar is still
    // there, still tappable, and has not swallowed the last row.
    await page.mouse.wheel(0, 6000);
    await page.waitForTimeout(200);
    await expect(page.getByTestId("batch-import")).toBeVisible();
    await page.mouse.wheel(0, -8000);
    await page.waitForTimeout(200);
    for (const id of ["batch-import", "batch-back", "batch-sort", "batch-select-all"]) {
      await expect(page.getByTestId(id), id).toBeVisible();
    }
    await page.getByTestId("batch-sort").selectOption("name");
    await expect(page.getByTestId("batch-row").first()).toHaveAttribute(
      "data-file",
      "01_qutadghu.md",
    );
  });
});

test.describe("after an interrupted import", () => {
  test("finds the draft that was left short of its pages, and removes it", async ({ page }) => {
    const admin = serviceClient();
    const title = `${BATCH_PREFIX} چالا قالغان`;
    await admin.from("books").delete().like("title", `${BATCH_PREFIX}%`);

    // Exactly what a tab closed mid-run leaves behind: a DRAFT claiming pages
    // it does not have. Never a published book.
    const { data, error } = await admin
      .from("books")
      .insert({
        title,
        author: "سىناق",
        status: "draft",
        format: "TXT",
        language: "ug",
        page_count: 9,
        file_hash: `${BATCH_PREFIX}-incomplete`,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`could not seed the wreck: ${error?.message}`);
    const bookId = (data as { id: number }).id;

    await page.goto("/admin/books/batch");
    // The recovery panel lives on the last stage, where an interrupted import
    // would have left the admin.
    await page.getByTestId("batch-file-input").setInputFiles([
      { name: "01_qutadghu.md", mimeType: "text/markdown", buffer: Buffer.from(`# ${BATCH_PREFIX} x\n\n${body(2)}`, "utf8") },
    ]);
    await page.getByTestId("batch-read").click();
    await expect(page.getByTestId("batch-stage-1")).toHaveAttribute("aria-current", "step", {
      timeout: 60_000,
    });

    // Reach stage 3 without importing anything: the panel is what is under test.
    await page.evaluate(() => window.scrollTo(0, 0));
    const row = page.locator('[data-testid="batch-row"]').first();
    await row.getByTestId("batch-category").selectOption({ index: 1 });
    await page.getByTestId("batch-import").click();
    await expect(page.getByTestId("batch-summary")).toBeVisible({ timeout: 120_000 });

    await page.getByTestId("batch-find-incomplete").click();
    const list = page.getByTestId("batch-incomplete");
    await expect(list).toContainText(title, { timeout: 30_000 });
    await expect(list).toContainText("0/9");

    await list
      .locator("li")
      .filter({ hasText: title })
      .getByTestId("batch-remove-incomplete")
      .click();
    await expect(page.getByTestId("batch-notice")).toContainText("ئۆچۈرۈلدى");

    const { data: gone } = await admin.from("books").select("id").eq("id", bookId).maybeSingle();
    expect(gone).toBeNull();

    await admin.from("books").delete().like("title", `${BATCH_PREFIX}%`);
  });
});
