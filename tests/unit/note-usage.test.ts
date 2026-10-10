import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotesUsage, USAGE_FULL_HINT } from "@/components/notes/notes-usage";
import { NOTE_QUOTA_MAX_BYTES, NOTE_QUOTA_MAX_NOTES } from "@/lib/notes/limits";
import { MEGABYTE, formatMegabytes, notebookUsage } from "@/lib/notes/usage";

/**
 * The line under /notes' heading (PROMPT-44): how many notes of 200, how many
 * megabytes of 5, and when it turns into a warning. The numbers come from the
 * list the page already loaded; the real page is tests/notes-quota.spec.ts.
 */

const notes = (count: number, bytesEach = 100) => Array.from({ length: count }, () => ({ bytes: bytesEach }));

function text(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

describe("formatMegabytes", () => {
  it("has one decimal and rounds down, so «5.0» never shows while there is room", () => {
    expect(formatMegabytes(0)).toBe("0.0");
    expect(formatMegabytes(1)).toBe("0.0");
    expect(formatMegabytes(MEGABYTE / 10)).toBe("0.1");
    expect(formatMegabytes(1.26 * MEGABYTE)).toBe("1.2");
    expect(formatMegabytes(NOTE_QUOTA_MAX_BYTES - 1)).toBe("4.9");
    expect(formatMegabytes(NOTE_QUOTA_MAX_BYTES)).toBe("5.0");
    expect(formatMegabytes(NOTE_QUOTA_MAX_BYTES + 1.3 * MEGABYTE)).toBe("6.3");
  });
});

describe("notebookUsage", () => {
  it("adds up the list", () => {
    expect(notebookUsage([{ bytes: 120 }, { bytes: 3_000 }])).toEqual({ count: 2, bytes: 3_120, level: "ok" });
    expect(notebookUsage([])).toEqual({ count: 0, bytes: 0, level: "ok" });
  });

  it("warns from 90 % of either limit", () => {
    expect(notebookUsage(notes(179)).level).toBe("ok");
    expect(notebookUsage(notes(180)).level).toBe("near");
    expect(notebookUsage([{ bytes: NOTE_QUOTA_MAX_BYTES * 0.9 - 1 }]).level).toBe("ok");
    expect(notebookUsage([{ bytes: NOTE_QUOTA_MAX_BYTES * 0.9 }]).level).toBe("near");
  });

  it("is full at either limit, and over it", () => {
    expect(notebookUsage(notes(NOTE_QUOTA_MAX_NOTES - 1)).level).toBe("near");
    expect(notebookUsage(notes(NOTE_QUOTA_MAX_NOTES)).level).toBe("full");
    expect(notebookUsage(notes(NOTE_QUOTA_MAX_NOTES + 30)).level).toBe("full");
    expect(notebookUsage([{ bytes: NOTE_QUOTA_MAX_BYTES - 1 }]).level).toBe("near");
    expect(notebookUsage([{ bytes: NOTE_QUOTA_MAX_BYTES }]).level).toBe("full");
    expect(notebookUsage([{ bytes: 2 * NOTE_QUOTA_MAX_BYTES }]).level).toBe("full");
  });
});

describe("<NotesUsage>", () => {
  const render = (count: number, bytes: number) =>
    renderToStaticMarkup(createElement(NotesUsage, { usage: notebookUsage(notes(count, bytes / Math.max(count, 1))) }));

  it("reads «count / 200 خاتىرە · used MB / 5 MB», plain while there is room", () => {
    const html = render(2, 0.25 * MEGABYTE);
    expect(text(html)).toBe("2 / 200 خاتىرە · 0.2 MB / 5 MB");
    expect(html).toContain('data-testid="notes-usage"');
    expect(html).toContain('data-level="ok"');
    expect(html).not.toMatch(/bg-ab/);
    expect(html).not.toContain(USAGE_FULL_HINT);
  });

  it("keeps each «… MB» together as a left-to-right unit", () => {
    expect(render(1, 100)).toContain("<bdi>0.0 MB</bdi> / <bdi>5 MB</bdi>");
  });

  it("takes the warning colour near a limit, and the strong one with what to do at it", () => {
    const near = render(185, 1000);
    expect(near).toContain('data-level="near"');
    expect(near).toMatch(/\bbg-ab\b/);
    expect(near).not.toContain(USAGE_FULL_HINT);

    const full = render(NOTE_QUOTA_MAX_NOTES, 1000);
    expect(full).toContain('data-level="full"');
    expect(full).toMatch(/\bbg-ab2\b/);
    expect(text(full)).toBe(`200 / 200 خاتىرە · 0.0 MB / 5 MB${USAGE_FULL_HINT}`);

    const fullBytes = render(3, NOTE_QUOTA_MAX_BYTES + MEGABYTE);
    expect(fullBytes).toContain('data-level="full"');
    expect(text(fullBytes)).toContain("6.0 MB / 5 MB");
    expect(fullBytes).toContain(USAGE_FULL_HINT);
  });
});
