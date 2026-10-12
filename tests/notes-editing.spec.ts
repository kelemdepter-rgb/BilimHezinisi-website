import { expect, test } from "@playwright/test";
import { hasStaffTestEnv, loadEnvLocal } from "./env";
import { dropNote, newNote } from "./fixtures/notes";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Editing that does what it says (PROMPT-45, notebook stage 4).
 *
 * Every note here is made straight in the database with the shape under test
 * already in it — a note that starts with a heading, a citation, a list — so
 * what is asserted is the editor's own HTML, byte for byte, in each engine.
 * All the text is invented.
 */

test.describe("undo in reach", () => {
  test("the back link and undo look different, and both work", async ({ page }) => {
    const path = await newNote(page);
    try {
      const icon = (testId: string) => page.getByTestId(testId).locator("use").getAttribute("href");
      const back = await icon("notes-back");
      const undo = await icon("format-undo");
      expect(back).toBeTruthy();
      expect(undo).toBeTruthy();
      expect(back, "back must not wear the undo icon").not.toBe(undo);
      await expect(page.getByTestId("notes-back")).toHaveAttribute("aria-label", "خاتىرىلەر تىزىملىكى");

      const body = page.getByTestId("note-body");
      await body.click();
      await page.keyboard.type("سىناق");
      await expect(body).toContainText("سىناق");
      await page.getByTestId("format-undo").click();
      await expect(body).not.toContainText("سىناق");
      await page.getByTestId("format-redo").click();
      await expect(body).toContainText("سىناق");

      await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });
      await page.getByTestId("notes-back").click();
      await expect(page).toHaveURL(/\/notes$/);
    } finally {
      await dropNote(path);
    }
  });
});
