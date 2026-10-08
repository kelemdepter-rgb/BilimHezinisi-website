import { noteVersionAction, saveNoteAction } from "@/app/notes/actions";
import type { NoteDocument } from "@/lib/notes/data";
import {
  browserStorage,
  readDraft,
  readLegacyDraft,
  removeDraft,
  removeLegacyDraft,
  writeDraft,
} from "@/lib/notes/drafts";
import { decideOpening } from "@/lib/notes/opening";
import {
  SaveLoop,
  findSaveLoop,
  keepSaveLoop,
  realClock,
  releaseSaveLoop,
  type NoteContent,
} from "@/lib/notes/save-loop";
import { sanitizeNoteHtml } from "@/lib/notes/sanitize";

/**
 * Opening a note in the editor: which text goes on screen, and the save loop
 * that will look after it (PROMPT-43).
 *
 * The browser half of lib/notes/opening.ts and lib/notes/save-loop.ts — the
 * one place that knows about localStorage, the Server Actions and DOMPurify,
 * so those two can stay plain logic with unit tests.
 */

/** Which open copy of a note wrote a device copy. One per tab. */
const TAB = Math.random().toString(36).slice(2);

export type NoteSession = {
  key: string;
  loop: SaveLoop;
  /** What the editor shows first. */
  content: NoteContent;
  /** This device's copy was put back — say so. */
  restored: boolean;
  /** The step that needs the editor attached first; runs once. */
  begin(): void;
};

function sameHtml(a: string, b: string): boolean {
  return a === b || sanitizeNoteHtml(a) === sanitizeNoteHtml(b);
}

export function openNoteSession(note: NoteDocument): NoteSession {
  const storage = browserStorage();
  const userId = note.user_id;
  const noteId = note.id;
  const key = `${userId}:${noteId}`;
  const server = { title: note.title, html: note.content_html, updatedAt: note.updated_at };

  const createLoop = (baseUpdatedAt: string | null) =>
    new SaveLoop({
      baseUpdatedAt,
      clock: realClock,
      send: (input) => saveNoteAction({ id: noteId, ...input }),
      writeDraft: (draft) =>
        writeDraft(storage, { v: 2, userId, noteId, ...draft, writtenAt: Date.now(), tab: TAB }),
      removeDraft: () => removeDraft(storage, userId, noteId, TAB),
      isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
      isVisible: () => document.visibilityState !== "hidden",
      checkVersion: async () => {
        const result = await noteVersionAction(noteId);
        return result.ok ? result.updatedAt : null;
      },
    });

  // A loop still running from earlier in this tab — joined, not raced.
  const live = findSaveLoop(key);
  const draft = live ? null : readDraft(storage, userId, noteId);
  const legacyHtml = live ? null : readLegacyDraft(storage, noteId);
  const { opening, dropDraft, dropLegacy } = decideOpening({
    server,
    loop: live ? { busy: live.isBusy(), base: live.baseVersion() } : null,
    draft,
    legacyHtml,
    sameHtml,
  });

  if (dropDraft) removeDraft(storage, userId, noteId);
  if (dropLegacy) removeLegacyDraft(storage, noteId);

  // A conflict keeps the text's own base, not the server's: until the writer
  // chooses, a later open must ask again rather than quietly send it.
  const loop = live ?? createLoop(opening.kind === "conflict" ? opening.base : server.updatedAt);
  if (!live) keepSaveLoop(key, loop);

  let pending: (() => void) | null = null;
  let content: NoteContent = { title: server.title, html: server.html };
  switch (opening.kind) {
    case "server":
      if (opening.adopt) loop.adopt(server.updatedAt);
      break;
    case "resume":
      content = loop.content();
      break;
    case "restore":
      content = { title: opening.content.title, html: sanitizeNoteHtml(opening.content.html) };
      pending = () => loop.restore();
      break;
    case "conflict": {
      content = { title: opening.content.title, html: sanitizeNoteHtml(opening.content.html) };
      const fromLegacy = opening.fromLegacy;
      pending = () => {
        const kept = loop.conflictOnOpen(server.updatedAt);
        // The old key goes only once its text is safe under the new one.
        if (kept && fromLegacy) removeLegacyDraft(storage, noteId);
      };
      break;
    }
  }

  return {
    key,
    loop,
    content,
    restored: opening.kind === "restore",
    begin: () => {
      const step = pending;
      pending = null;
      step?.();
    },
  };
}

/** The note was abandoned for a new one: nothing of its loop is wanted. */
export function forgetNoteSession(session: NoteSession): void {
  releaseSaveLoop(session.key);
}
