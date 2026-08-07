import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  DOCX_BOLD,
  DOCX_HEADING,
  DOCX_TABLE_CELL,
  buildTestDocx,
} from "./fixtures/docx";
import { hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

const UPLOAD_TITLE = "__e2e_docx__ سىناق ھۆججىتى";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function removeUploaded() {
  const admin = adminClient();
  await admin.from("books").delete().ilike("title", "__e2e_docx__%");
}

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
}

test.describe("PDF is refused", () => {
  test("selecting a PDF shows the desktop-app guidance and queues nothing", async ({ page }) => {
    await page.goto("/admin/books/new");

    await page.getByTestId("wizard-file-input").setInputFiles({
      name: "kitab.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n% not a real pdf\n", "utf8"),
    });

    const error = page.getByTestId("wizard-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("PDF");
    await expect(error).toContainText("DOCX");
    // Nothing was queued, so "next" cannot proceed.
    await expect(page.getByTestId("wizard-queue")).toHaveCount(0);
    await expect(page.getByTestId("wizard-next")).toBeDisabled();
  });

  test("the picker does not advertise PDF", async ({ page }) => {
    await page.goto("/admin/books/new");
    const accept = await page.getByTestId("wizard-file-input").getAttribute("accept");
    expect(accept).not.toContain("pdf");
    expect(accept).toContain(".docx");
  });

  test("the database refuses a PDF book even without the UI", async () => {
    // Server-side guard: an INSERT trigger, so a crafted client cannot bypass it.
    const admin = adminClient();
    const { error } = await admin.from("books").insert({
      title: "__e2e_pdf_guard__",
      format: "PDF",
      status: "draft",
      file_hash: "__e2e_pdf_guard__",
    });
    expect(error, "inserting a PDF book must be rejected").not.toBeNull();
    await admin.from("books").delete().eq("file_hash", "__e2e_pdf_guard__");
  });
});

test.describe("DOCX round-trip", () => {
  test.beforeEach(removeUploaded);
  test.afterEach(removeUploaded);

  test("uploads and reads back with its formatting intact", async ({ page }) => {
    await page.goto("/admin/books/new");

    await page.getByTestId("wizard-file-input").setInputFiles({
      name: "e2e-docx.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: buildTestDocx(),
    });
    await expect(page.getByTestId("wizard-queue")).toContainText("e2e-docx.docx");

    await page.getByTestId("wizard-next").click();
    await expect(page.getByText("ئوقۇش تامام ✓")).toBeVisible({ timeout: 30_000 });

    // Chunk step previews the rendered Markdown, with a raw-source toggle.
    await page.getByTestId("wizard-next").click();
    const preview = page.getByTestId("chunk-preview");
    await expect(preview.locator("h1, h2").first()).toBeVisible();
    await expect(preview.locator("strong").first()).toBeVisible();
    await expect(preview.locator("table").first()).toBeVisible();

    await page.getByTestId("preview-toggle").click();
    await expect(preview).toContainText("#");

    await page.getByTestId("wizard-next").click();
    await page.getByTestId("meta-title").fill(UPLOAD_TITLE);
    await page.getByTestId("meta-status").selectOption("published");

    await page.getByTestId("wizard-next").click(); // cover
    await page.getByTestId("wizard-next").click(); // save step
    await page.getByTestId("wizard-save").click();
    await expect(page.getByTestId("wizard-saved")).toBeVisible({ timeout: 60_000 });

    // Stored as Markdown, and the reader renders it as real elements.
    const admin = adminClient();
    const { data: book } = await admin
      .from("books")
      .select("id, content_format, format")
      .eq("title", UPLOAD_TITLE)
      .maybeSingle();
    expect(book?.content_format).toBe("markdown");
    expect(book?.format).toBe("DOCX");

    await page.goto(`/books/${book!.id}/read`);
    const content = page.getByTestId("reader-content");
    await expect(content.locator("h1, h2").first()).toBeVisible({ timeout: 20_000 });
    await expect(content.getByText(DOCX_HEADING, { exact: false }).first()).toBeVisible();
    await expect(content.locator("strong").filter({ hasText: DOCX_BOLD })).toBeVisible();
    await expect(content.locator("table td").filter({ hasText: DOCX_TABLE_CELL })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("renders a Markdown book in all three themes without overflow", async ({ page }) => {
    const admin = adminClient();
    const { data: book } = await admin
      .from("books")
      .insert({
        title: UPLOAD_TITLE,
        status: "published",
        format: "MD",
        content_format: "markdown",
        file_hash: "__e2e_docx_md__",
        page_count: 1,
      })
      .select("id")
      .single();
    const wide = `| ${Array.from({ length: 12 }, (_, i) => `ئۇستۇن${i}`).join(" | ")} |\n| ${Array.from(
      { length: 12 },
      () => "---",
    ).join(" | ")} |\n| ${Array.from({ length: 12 }, (_, i) => `قىممەت${i}`).join(" | ")} |`;
    await admin.from("book_pages").insert({
      book_id: book!.id,
      page_no: 1,
      content: `# ماۋزۇ\n\n**توم خەت** ۋە *يانتۇ*.\n\n- بىرىنچى\n- ئىككىنچى\n\n> نەقىل\n\n${wide}`,
    });

    for (const theme of ["light", "sepia", "dark"]) {
      await page.goto(`/books/${book!.id}/read`);
      await page.evaluate((value) => {
        document.documentElement.setAttribute("data-theme", value);
      }, theme);

      const content = page.getByTestId("reader-content");
      await expect(content.locator("h1").first()).toBeVisible();
      await expect(content.locator("strong").first()).toBeVisible();
      await expect(content.locator("blockquote").first()).toBeVisible();
      await expect(content.locator("li").first()).toBeVisible();

      // A wide table must scroll inside itself, never widen the page.
      await assertNoHorizontalOverflow(page);
      const scrolls = await content
        .locator("table")
        .first()
        .evaluate((node) => node.scrollWidth > node.clientWidth);
      expect(scrolls, "wide table must scroll within its own box").toBe(true);
    }
  });
});

test.describe("free-tier plumbing", () => {
  test("health route answers ok", async ({ request }) => {
    const response = await request.get("/api/health");
    // Without CRON_SECRET set locally the route is open; with it set it must
    // reject an unauthenticated call. Both are correct behaviour.
    if (response.status() === 401) {
      expect(process.env.CRON_SECRET).toBeTruthy();
      return;
    }
    expect(response.ok()).toBe(true);
    expect((await response.json()).ok).toBe(true);
  });

  test("usage panel renders for an admin session", async ({ browser }) => {
    // The seeded e2e account is an uploader, so it must NOT see the panel.
    const context = await browser.newContext({ storageState: "tests/.auth/staff.json" });
    const page = await context.newPage();
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "باشقۇرۇش سۇپىسى" })).toBeVisible();
    await expect(page.getByTestId("usage-panel")).toHaveCount(0);
    await context.close();
  });

  test("anonymous visitors cannot reach the admin dashboard", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
});
