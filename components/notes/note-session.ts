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
 * one place that knows about localStorage, Web Locks, the Server Actions and
 * DOMPurify, so those two can stay plain logic with unit tests.
 */

/** Which open copy of a note wrote a device copy. One per tab. */
const TAB = Math.random().toString(36).slice(2);

/**
 * "This note is open in this tab", held for as long as its editor is.
 *
 * Two tabs share one device copy per note. A tab that opens a note while
 * another still has it open and is typing would otherwise find that tab's
 * copy, take it for one left behind by a closed tab, put it back and save it
 * — and the writer in the first tab would be told the note had changed
 * elsewhere. The browser releases a lock the moment its tab closes or
 * crashes, so a copy whose writer holds none was really left behind.
 */
const OPEN_LOCK = "bh-note-open:";

function openLockName(key: string, tab: string): string {
  return `${OPEN_LOCK}${key}:${tab}`;
}

/** Hold the lock until the returned function is called. */
export function holdNoteOpen(session: NoteSession): () => void {
  let release = () => {};
  try {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (locks) {
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      void locks.request(openLockName(session.key, TAB), () => held).catch(() => {});
    }
  } catch {
    // No Web Locks: other tabs cannot tell, and fall back to restoring.
  }
  return () => release();
}

/** Does `tab` still have this note open? False when nobody can tell. */
async function openElsewhere(key: string, tab: string): Promise<boolean> {
  try {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks) return false;
    const { held = [] } = await locks.query();
    return held.some((lock) => lock.name === openLockName(key, tab));
  } catch {
    return false;
  }
}

export type NoteSession = {
  key: string;
  loop: SaveLoop;
  /** What the editor shows first. */
  content: NoteContent;
  /**
   * False while it is being asked whether another tab still has this note
   * open; the editor takes no keystrokes until `start` has answered.
   */
  settled: boolean;
  /**
   * The step that needs the editor attached: put this device's copy on
   * screen (through `show`) when it should be, and hand it to the loop. Runs
   * once; resolves true when a copy was put back, so the editor can say so.
   */
  start(show: (content: NoteContent) => void): Promise<boolean>;
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

  const loop =
    live ??
    new SaveLoop({
      baseUpdatedAt: server.updatedAt,
      clock: realClock,
      send: (input) => saveNoteAction({ id: noteId, ...input }),
      writeDraft: (copy) =>
        writeDraft(storage, { v: 2, userId, noteId, ...copy, writtenAt: Date.now(), tab: TAB }),
      removeDraft: () => removeDraft(storage, userId, noteId, TAB),
      isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
      isVisible: () => document.visibilityState !== "hidden",
      checkVersion: async () => {
        const result = await noteVersionAction(noteId);
        return result.ok ? result.updatedAt : null;
      },
    });
  if (!live) keepSaveLoop(key, loop);

  let content: NoteContent = { title: server.title, html: server.html };
  /** This device's copy, when it goes on screen only after the check. */
  let deferred: NoteContent | null = null;
  /** The tab that wrote the copy, when it might still have the note open. */
  let writer: string | null = null;
  let step: (() => void) | null = null;

  switch (opening.kind) {
    case "server":
      if (opening.adopt) loop.adopt(server.updatedAt);
      break;
    case "resume":
      content = loop.content();
      break;
    case "restore":
    case "conflict": {
      const copy = { title: opening.content.title, html: sanitizeNoteHtml(opening.content.html) };
      // A legacy copy names no tab, and a copy this tab wrote has no other
      // writer: only a copy from another tab needs the question asked.
      writer = draft && draft.tab !== TAB ? draft.tab : null;
      if (writer) deferred = copy;
      else content = copy;
      if (opening.kind === "restore") {
        step = () => loop.restore();
      } else {
        const { base, fromLegacy } = opening;
        step = () => {
          // The copy's own base, not the server's: until the writer chooses,
          // a later open must ask again rather than quietly send it.
          const kept = loop.conflictOnOpen(server.updatedAt, base);
          // The old key goes only once its text is safe under the new one.
          if (kept && fromLegacy) removeLegacyDraft(storage, noteId);
        };
      }
      break;
    }
  }

  let started: Promise<boolean> | null = null;
  return {
    key,
    loop,
    content,
    settled: writer === null,
    start: (show) =>
      (started ??= (async () => {
        // That tab owns its copy and saves it itself; this one stays on the
        // server's version, clean, and a later edit here is a real conflict.
        if (writer && (await openElsewhere(key, writer))) return false;
        if (deferred) show(deferred);
        step?.();
        return opening.kind === "restore";
      })()),
  };
}

/** The note was abandoned for a new one: nothing of its loop is wanted. */
export function forgetNoteSession(session: NoteSession): void {
  releaseSaveLoop(session.key);
}
