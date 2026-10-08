import type { DraftRecord } from "@/lib/notes/drafts";
import { compareVersions, normalizeTitle } from "@/lib/notes/save-protocol";
import type { NoteContent } from "@/lib/notes/save-loop";

/**
 * What a note opens on (PROMPT-43, part E).
 *
 * Three things may know a version of the note: the server, this device's copy
 * of unsaved work, and a save loop still running in this tab from a moment
 * ago. This decides which one the editor shows — and when two of them
 * disagree in a way only the writer can settle, says so instead of picking.
 * Pure, so every branch is a unit test.
 */

export type ServerVersion = NoteContent & { updatedAt: string };

/** What this tab's save loop for the note, if any, reports about itself. */
export type LiveLoop = {
  /** Unsaved text, a save in flight, or a state waiting on the writer. */
  busy: boolean;
  base: string | null;
};

export type Opening =
  /** The server's version, clean. `adopt` when a live loop must catch up. */
  | { kind: "server"; adopt: boolean }
  /** The live loop's text — newer than the page, or the same. */
  | { kind: "resume" }
  /** This device's copy of the same version: show it and save it now. */
  | { kind: "restore"; content: NoteContent }
  /** A copy written on another version, or on an unknown one. */
  | { kind: "conflict"; content: NoteContent; base: string | null; fromLegacy: boolean };

export type OpeningInput = {
  server: ServerVersion;
  loop: LiveLoop | null;
  draft: DraftRecord | null;
  /** The pre-PROMPT-43 copy: raw HTML, no base, no title. */
  legacyHtml: string | null;
  /**
   * The same text, as far as the writer could tell? Both sides go through
   * the editor's sanitizer first: the server stored a sanitized copy of what
   * was sent, so the raw strings may differ by nothing anyone could see.
   */
  sameHtml(a: string, b: string): boolean;
};

export type OpeningResult = {
  opening: Opening;
  /** The v2 copy is redundant and can go now. */
  dropDraft: boolean;
  /** The legacy copy is redundant and can go now. */
  dropLegacy: boolean;
};

export function decideOpening(input: OpeningInput): OpeningResult {
  const { server, loop, draft, legacyHtml, sameHtml } = input;

  if (loop) {
    // The loop joined from earlier in this tab knows more than the page did
    // when it rendered, unless the server moved on and nothing here is unsaved.
    const serverNewer = loop.base !== null && compareVersions(server.updatedAt, loop.base) > 0;
    return {
      opening: serverNewer && !loop.busy ? { kind: "server", adopt: true } : { kind: "resume" },
      dropDraft: false,
      dropLegacy: false,
    };
  }

  const sameAsServer = (content: NoteContent) =>
    normalizeTitle(content.title) === normalizeTitle(server.title) && sameHtml(content.html, server.html);

  if (draft) {
    const content = { title: draft.title, html: draft.html };
    const legacyRedundant =
      legacyHtml !== null && (sameHtml(legacyHtml, server.html) || sameHtml(legacyHtml, draft.html));
    if (draft.baseUpdatedAt !== null && compareVersions(draft.baseUpdatedAt, server.updatedAt) === 0) {
      return { opening: { kind: "restore", content }, dropDraft: false, dropLegacy: legacyRedundant };
    }
    // A save that landed while its answer was lost (the tab closed) leaves a
    // copy of exactly what the server now holds. Nothing to ask about.
    if (sameAsServer(content)) {
      return { opening: { kind: "server", adopt: false }, dropDraft: true, dropLegacy: legacyRedundant };
    }
    return {
      opening: { kind: "conflict", content, base: draft.baseUpdatedAt, fromLegacy: false },
      dropDraft: false,
      dropLegacy: legacyRedundant,
    };
  }

  if (legacyHtml !== null) {
    if (sameHtml(legacyHtml, server.html)) {
      return { opening: { kind: "server", adopt: false }, dropDraft: false, dropLegacy: true };
    }
    // No base and no title were ever recorded: the writer has to look.
    return {
      opening: {
        kind: "conflict",
        content: { title: server.title, html: legacyHtml },
        base: null,
        fromLegacy: true,
      },
      dropDraft: false,
      // Only once its text is safely in a v2 copy.
      dropLegacy: false,
    };
  }

  return { opening: { kind: "server", adopt: false }, dropDraft: false, dropLegacy: false };
}
