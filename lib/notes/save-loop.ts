import {
  CODE_STATE,
  MAX_SAVE_BYTES,
  compareVersions,
  saveBytes,
  type SaveCode,
  type SaveResult,
  type SaveState,
} from "@/lib/notes/save-protocol";

/**
 * The notebook's one save loop (PROMPT-43).
 *
 * Everything that decides WHEN a note is sent, and what the label says about
 * it, lives here — no React, no DOM, no network of its own. The editor feeds
 * it changes and page events; the clock, the request and the device copy are
 * handed in, so a unit test can run a whole afternoon of writing on fake
 * timers. Stage 3 (quotas, a server-side rate limit) adds result codes in
 * lib/notes/save-protocol.ts; stage 5 (local history) calls `adopt` through
 * the editor's one replace-the-document helper.
 *
 * The rules, each with the bug it closes:
 *  - The title and body are read at the moment of sending, never captured
 *    when the timer was set (N4: the last letter of a title was lost).
 *  - A save confirms only the revision it carried. An edit made while it was
 *    in flight keeps the label at «ئۆزگەردى…» and is sent next (N2b).
 *  - Leaving — a link in the app, the tab hidden, the page closed — writes
 *    the device copy at once and starts the save; the copy stays until the
 *    server has confirmed that exact content (N2, N3).
 *  - A failure says so and really tries again: 5 s, 15 s, 45 s, then every
 *    minute while the page is visible, and at once when the connection comes
 *    back (N3).
 *  - A note too large for a Server Action is never sent (N23).
 *  - Every save names the version it was written on; the server refuses one
 *    that is out of date, and the writer chooses (N5).
 */

export const SAVE_DEBOUNCE_MS = 1200;
/** Between two saves of one note — far below what stage 3 will enforce. */
export const MIN_SAVE_GAP_MS = 3000;
/** The device copy is never more than this far behind the screen. */
export const DRAFT_DELAY_MS = 300;
/** Then every minute: the last delay repeats. */
export const RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 60_000] as const;
/** A tab hidden this long asks whether the note changed elsewhere meanwhile. */
export const VERSION_CHECK_AFTER_MS = 60_000;

export type NoteContent = { title: string; html: string };

export type Clock = {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type SaveLoopDeps = {
  /** The version the editor opened on; null when the text's base is unknown. */
  baseUpdatedAt: string | null;
  clock: Clock;
  /** Throws when the request never got an answer. */
  send(input: NoteContent & { baseUpdatedAt: string }): Promise<SaveResult>;
  /** Write this device's copy; false when the browser refused it. */
  writeDraft(draft: NoteContent & { baseUpdatedAt: string | null; revision: number }): boolean;
  removeDraft(): void;
  isOnline(): boolean;
  isVisible(): boolean;
  /** The server's current version, or null when it could not be asked. */
  checkVersion?(): Promise<string | null>;
};

export type SaveSnapshot = Readonly<{
  state: SaveState;
  code: SaveCode | null;
  /** On `conflict`: the version the server holds. */
  serverUpdatedAt: string | null;
  /** This device could not keep a copy — said once, and it stays said. */
  storageFailed: boolean;
}>;

/** What the open editor lends the loop while it is on screen. */
export type Attachment = {
  read(): NoteContent;
  /** The server holds a newer version and nothing here is unsaved. */
  onRemoteNewer?(updatedAt: string): void;
};

export class SaveLoop {
  private revision = 0;
  /** The newest revision the server is known to hold. */
  private confirmed = 0;
  private base: string | null;
  private state: SaveState = "idle";
  private code: SaveCode | null = null;
  private serverUpdatedAt: string | null = null;
  private storageFailed = false;

  private inFlight = false;
  /** Bumped when the document is replaced: an older save's answer is moot. */
  private generation = 0;
  /** Send the newest text the moment the save in flight returns. */
  private flushWanted = false;
  private lastSendAt = Number.NEGATIVE_INFINITY;
  private retryCount = 0;
  private hiddenAt: number | null = null;

  private saveTimer: unknown = null;
  private draftTimer: unknown = null;
  private retryTimer: unknown = null;

  private attachment: Attachment | null = null;
  /** The text as it was when the editor went away. */
  private held: NoteContent = { title: "", html: "" };

  private listeners = new Set<() => void>();
  private snapshot: SaveSnapshot;

  constructor(private readonly deps: SaveLoopDeps) {
    this.base = deps.baseUpdatedAt;
    this.snapshot = this.buildSnapshot();
  }

  /* ── For React (useSyncExternalStore) ─────────────────────────────────── */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SaveSnapshot => this.snapshot;

  /* ── What the editor asks ─────────────────────────────────────────────── */

  /** Something on screen has not reached the server yet. */
  hasUnsent(): boolean {
    return this.revision > this.confirmed;
  }

  /** A save in flight, or text the server does not have yet. */
  isBusy(): boolean {
    return this.inFlight || this.hasUnsent();
  }

  /** Nothing pending, nothing in flight, nothing on screen: safe to forget. */
  isIdle(): boolean {
    return this.attachment === null && !this.inFlight && !this.hasUnsent();
  }

  /** The newest text: the editor's while it is open, the held copy after. */
  content(): NoteContent {
    return this.attachment ? this.attachment.read() : this.held;
  }

  baseVersion(): string | null {
    return this.base;
  }

  /* ── The editor's life ────────────────────────────────────────────────── */

  attach(attachment: Attachment): void {
    this.attachment = attachment;
    if ((this.state === "offline" || this.state === "retrying") && this.retryTimer === null) {
      this.scheduleRetry();
    } else if (this.state === "dirty" && !this.inFlight && this.saveTimer === null) {
      this.scheduleSave(SAVE_DEBOUNCE_MS);
    }
  }

  /**
   * The editor went away — a link inside the app, most often, where no
   * `pagehide` ever fires. Keep its text, write the device copy and start the
   * save now; the answer may well arrive after the page has changed.
   */
  detach(): void {
    if (this.attachment) this.held = this.attachment.read();
    this.flush();
    this.attachment = null;
    this.clearSaveTimer();
    this.clearRetryTimer();
  }

  /** Every edit, of the body or the title, by hand or by a panel. */
  change(): void {
    this.revision++;
    this.scheduleDraft();
    if (this.state === "conflict" || this.state === "offline" || this.state === "retrying") {
      // Paused, or already waiting on a retry that will send the newest text;
      // the device copy keeps up either way.
      return;
    }
    this.code = null;
    this.setState("dirty");
    this.scheduleSave(SAVE_DEBOUNCE_MS);
  }

  /** Write the device copy now, and send now if a save is due. */
  flush(): void {
    this.clearDraftTimer();
    if (!this.hasUnsent()) return;
    this.writeDraftNow();
    if (this.state === "dirty") this.trySend(true);
  }

  /** «ھازىر قايتا سىناش», a connection that came back, a page shown again. */
  retryNow(): void {
    if (this.state !== "offline" && this.state !== "retrying") return;
    this.clearRetryTimer();
    this.trySend();
  }

  online(): void {
    this.retryNow();
  }

  visibility(visible: boolean): void {
    if (!visible) {
      this.hiddenAt ??= this.deps.clock.now();
      this.flush();
      return;
    }
    const hiddenFor = this.hiddenAt === null ? 0 : this.deps.clock.now() - this.hiddenAt;
    this.hiddenAt = null;
    this.retryNow();
    if (hiddenFor >= VERSION_CHECK_AFTER_MS) void this.checkRemote();
  }

  /* ── Opening, conflicts and replacing the document ────────────────────── */

  /** Opened on this device's copy of the same version: send it at once. */
  restore(): void {
    this.revision++;
    this.setState("dirty");
    this.trySend(true);
  }

  /**
   * Opened on a copy written against an older (or unknown) version: show it,
   * keep it, send nothing until the writer chooses. True when the copy is
   * safely on this device.
   */
  conflictOnOpen(serverUpdatedAt: string): boolean {
    this.revision++;
    return this.enterConflict(serverUpdatedAt);
  }

  /** The server holds a newer version and this one has unsent edits. */
  conflict(serverUpdatedAt: string): void {
    if (this.state === "conflict") return;
    this.enterConflict(serverUpdatedAt);
  }

  /** «مېنىڭ نۇسخامنى بۇنىڭ ئورنىغا قويۇش»: the writer chose this version. */
  keepMine(): void {
    if (this.state !== "conflict" || this.serverUpdatedAt === null) return;
    this.base = this.serverUpdatedAt;
    this.serverUpdatedAt = null;
    this.code = null;
    this.setState("dirty");
    this.trySend(true);
  }

  /** A refusal the editor learned about itself (a note deleted elsewhere). */
  block(code: SaveCode): void {
    this.code = code;
    this.clearSaveTimer();
    this.writeDraftNow();
    this.setState("blocked");
  }

  /**
   * The document on screen was replaced by a version the server already
   * holds — the other version, after a conflict, or (stage 5) one from this
   * device's history once it has been saved. Clean from here.
   */
  adopt(updatedAt: string): void {
    this.generation++;
    this.inFlight = false;
    this.flushWanted = false;
    this.clearSaveTimer();
    this.clearDraftTimer();
    this.clearRetryTimer();
    this.revision++;
    this.confirmed = this.revision;
    this.base = updatedAt;
    this.code = null;
    this.serverUpdatedAt = null;
    this.retryCount = 0;
    this.deps.removeDraft();
    this.setState("saved");
  }

  /** The note is gone and its text now lives in a new one. */
  abandon(): void {
    this.generation++;
    this.inFlight = false;
    this.clearSaveTimer();
    this.clearDraftTimer();
    this.clearRetryTimer();
    this.confirmed = this.revision;
    this.deps.removeDraft();
    this.attachment = null;
    this.setState("idle");
  }

  /* ── Inside ───────────────────────────────────────────────────────────── */

  private trySend(force = false): void {
    this.clearSaveTimer();
    if (!this.hasUnsent()) return;
    if (this.state === "conflict" || this.state === "blocked") return;
    if (this.inFlight) {
      // One at a time. Its answer looks again, and goes straight on if asked.
      if (force) this.flushWanted = true;
      return;
    }
    // A closed editor sends only what leaving asked for.
    if (this.attachment === null && !force) return;
    if (!force) {
      const wait = this.lastSendAt + MIN_SAVE_GAP_MS - this.deps.clock.now();
      if (wait > 0) {
        this.scheduleSave(wait);
        return;
      }
    }
    if (this.base === null) return;

    // The copy on this device first, so it always holds at least what is sent.
    this.writeDraftNow();
    const content = this.content();
    if (saveBytes(content) > MAX_SAVE_BYTES) {
      this.block("too_large");
      return;
    }
    if (!this.deps.isOnline()) {
      this.goOffline();
      return;
    }
    void this.send(content, this.revision, this.base);
  }

  private async send(content: NoteContent, revision: number, base: string): Promise<void> {
    const generation = this.generation;
    this.inFlight = true;
    this.flushWanted = false;
    this.lastSendAt = this.deps.clock.now();
    this.setState("saving");

    let result: SaveResult | null;
    try {
      result = await this.deps.send({ ...content, baseUpdatedAt: base });
    } catch {
      result = null;
    }
    if (generation !== this.generation) return;
    this.inFlight = false;
    const flush = this.flushWanted;
    this.flushWanted = false;

    if (result === null) {
      this.goOffline();
      return;
    }

    if (result.ok) {
      this.base = result.updatedAt;
      this.confirmed = Math.max(this.confirmed, revision);
      this.retryCount = 0;
      this.clearRetryTimer();
      this.code = null;
      if (revision === this.revision) {
        // The server holds exactly what is on screen: the copy can go.
        this.clearDraftTimer();
        this.deps.removeDraft();
        this.setState("saved");
      } else {
        // Something was written while this was on its way. It is not saved,
        // the label must not say it is, and the copy here is brought up to it.
        this.writeDraftNow();
        this.setState("dirty");
        this.trySend(flush);
      }
      return;
    }

    const next = CODE_STATE[result.code] ?? "retrying";
    this.code = result.code in CODE_STATE ? result.code : "failed";
    this.clearSaveTimer();
    this.writeDraftNow();
    if (next === "conflict") {
      this.serverUpdatedAt = result.serverUpdatedAt ?? null;
      this.setState("conflict");
    } else if (next === "blocked") {
      this.setState("blocked");
    } else {
      this.setState("retrying");
      this.scheduleRetry();
    }
  }

  private goOffline(): void {
    this.code = null;
    this.clearSaveTimer();
    this.writeDraftNow();
    this.setState("offline");
    this.scheduleRetry();
  }

  private enterConflict(serverUpdatedAt: string): boolean {
    this.code = "conflict";
    this.serverUpdatedAt = serverUpdatedAt;
    this.clearSaveTimer();
    const kept = this.writeDraftNow();
    this.setState("conflict");
    return kept;
  }

  private async checkRemote(): Promise<void> {
    const check = this.deps.checkVersion;
    if (!check || this.inFlight || this.state === "conflict" || this.base === null) return;
    const generation = this.generation;
    let remote: string | null;
    try {
      remote = await check();
    } catch {
      remote = null;
    }
    if (!remote || generation !== this.generation || this.base === null) return;
    // Anything may have happened while the question was out: our own save
    // landing (its answer moved the base), a conflict, a new save in flight.
    if (this.inFlight || this.stateNow() === "conflict" || compareVersions(remote, this.base) <= 0) return;
    if (this.hasUnsent()) this.enterConflict(remote);
    else this.attachment?.onRemoteNewer?.(remote);
  }

  /** True when the copy is on this device (or nothing needed one). */
  private writeDraftNow(): boolean {
    this.clearDraftTimer();
    if (!this.hasUnsent()) return true;
    const kept = this.deps.writeDraft({
      ...this.content(),
      baseUpdatedAt: this.base,
      revision: this.revision,
    });
    if (!kept && !this.storageFailed) {
      this.storageFailed = true;
      this.emit();
    }
    return kept;
  }

  private scheduleDraft(): void {
    if (this.draftTimer !== null) return;
    this.draftTimer = this.deps.clock.setTimeout(() => {
      this.draftTimer = null;
      this.writeDraftNow();
    }, DRAFT_DELAY_MS);
  }

  private scheduleSave(ms: number): void {
    this.clearSaveTimer();
    this.saveTimer = this.deps.clock.setTimeout(() => {
      this.saveTimer = null;
      this.trySend();
    }, ms);
  }

  private scheduleRetry(): void {
    this.clearRetryTimer();
    if (this.attachment === null) return;
    const delay = RETRY_DELAYS_MS[Math.min(this.retryCount, RETRY_DELAYS_MS.length - 1)];
    this.retryCount++;
    this.retryTimer = this.deps.clock.setTimeout(() => {
      this.retryTimer = null;
      // A hidden page waits; showing it again retries at once.
      if (this.deps.isVisible()) this.trySend();
    }, delay);
  }

  private clearSaveTimer(): void {
    if (this.saveTimer !== null) this.deps.clock.clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  private clearDraftTimer(): void {
    if (this.draftTimer !== null) this.deps.clock.clearTimeout(this.draftTimer);
    this.draftTimer = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) this.deps.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Read afresh after an await — TypeScript would keep the narrowed one. */
  private stateNow(): SaveState {
    return this.state;
  }

  private setState(state: SaveState): void {
    this.state = state;
    if (state !== "conflict") this.serverUpdatedAt = null;
    this.emit();
  }

  private buildSnapshot(): SaveSnapshot {
    return {
      state: this.state,
      code: this.code,
      serverUpdatedAt: this.serverUpdatedAt,
      storageFailed: this.storageFailed,
    };
  }

  private emit(): void {
    const next = this.buildSnapshot();
    const previous = this.snapshot;
    if (
      next.state === previous.state &&
      next.code === previous.code &&
      next.serverUpdatedAt === previous.serverUpdatedAt &&
      next.storageFailed === previous.storageFailed
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

/**
 * One loop per note, for as long as this tab runs.
 *
 * Leaving a note and coming back inside the app is a new editor but the same
 * JavaScript, and a save started on the way out may still be in flight. The
 * new editor joins it instead of racing it — two loops sending the same text
 * from the same base would each make the other look like a conflict.
 */
const loops = new Map<string, SaveLoop>();
const KEEP_LOOPS = 8;

/** This tab's loop for a note, if one is still around. */
export function findSaveLoop(key: string): SaveLoop | undefined {
  const found = loops.get(key);
  if (found) {
    // Most recently used last, so the oldest idle ones go first.
    loops.delete(key);
    loops.set(key, found);
  }
  return found;
}

export function keepSaveLoop(key: string, loop: SaveLoop): void {
  loops.set(key, loop);
  for (const [oldKey, old] of loops) {
    if (loops.size <= KEEP_LOOPS) break;
    if (old !== loop && old.isIdle()) loops.delete(oldKey);
  }
}

export function releaseSaveLoop(key: string): void {
  loops.delete(key);
}

/** Tests only: start every case from an empty tab. */
export function resetSaveLoops(): void {
  loops.clear();
}
