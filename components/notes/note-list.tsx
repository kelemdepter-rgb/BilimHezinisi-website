"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import {
  createNoteAction,
  pinNoteAction,
  restoreNoteAction,
  searchMyNotesAction,
  trashNoteAction,
  type SearchNotesResult,
} from "@/app/notes/actions";
import { LocalTime } from "@/components/notes/local-time";
import { NOTES_USAGE_ID } from "@/components/notes/notes-usage";
import {
  MOVED_TO_TRASH,
  SEARCH_DEBOUNCE_MS,
  SEARCH_EMPTY,
  SEARCH_MAX_CHARS,
  SEARCH_MIN_CHARS,
  TRASH_UNDO_MS,
  listFailure,
} from "@/lib/notes/list-protocol";
import { NOTE_SORTS, NOTE_SORT_LABELS, isNoteSort, sortNotes, titleComparer } from "@/lib/notes/list-sort";
import {
  getNoteSortServerSnapshot,
  getNoteSortSnapshot,
  setNoteSort,
  subscribeNoteSort,
} from "@/lib/notes/list-sort-store";
import type { NoteSummary } from "@/lib/notes/data";

/** A change the list shows at once, before the server has answered. */
type Change =
  | { kind: "pin"; id: number; pinnedAt: string | null }
  | { kind: "trash"; id: number }
  | { kind: "restore"; note: NoteSummary };

function applyChange(notes: NoteSummary[], change: Change): NoteSummary[] {
  switch (change.kind) {
    case "pin":
      return notes.map((note) => (note.id === change.id ? { ...note, pinned_at: change.pinnedAt } : note));
    case "trash":
      return notes.filter((note) => note.id !== change.id);
    case "restore":
      return [...notes.filter((note) => note.id !== change.note.id), change.note];
  }
}

/** Results for a search that finished, and the words they are for. */
type Search = { query: string; notes: NoteSummary[] };

/**
 * The notebook's list (PROMPT-47): search, sort, pin and the trash.
 *
 * The notes come from the server and stay the server's: pinning and moving
 * to the trash show at once through useOptimistic, and the action's own
 * response brings the list as the server now has it (revalidatePath). Search
 * results are this component's, because they exist nowhere else.
 *
 * `countFull`: the account holds as many notes as it may. «يېڭى خاتىرە» still
 * asks — the server is the judge, and a note deleted in another tab may have
 * made room — and its refusal says what to do (SAVE_MESSAGES.quota_count).
 */
export function NoteList({
  notes,
  trashCount,
  countFull = false,
}: {
  notes: NoteSummary[];
  trashCount: number;
  countFull?: boolean;
}) {
  const router = useRouter();
  const [creating, startCreate] = useTransition();
  const [, startChange] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [shownNotes, change] = useOptimistic(notes, applyChange);

  const sort = useSyncExternalStore(subscribeNoteSort, getNoteSortSnapshot, getNoteSortServerSnapshot);
  const compareTitles = useMemo(() => titleComparer(), []);

  /* ── Searching ──────────────────────────────────────────────────────── */

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Only the newest search may answer; an older one arriving late is dropped. */
  const searchTicket = useRef(0);
  const searchActive = query.trim().length >= SEARCH_MIN_CHARS;

  async function runSearch(words: string) {
    const ticket = ++searchTicket.current;
    let result: SearchNotesResult;
    try {
      result = await searchMyNotesAction(words);
    } catch {
      result = listFailure("failed");
    }
    if (ticket !== searchTicket.current) return;
    setSearching(false);
    if (result.ok) {
      setSearch({ query: words, notes: result.notes });
      setSearchError(null);
    } else {
      setSearchError(result.error);
    }
  }

  function changeQuery(value: string) {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const words = value.trim();
    if (words.length < SEARCH_MIN_CHARS) {
      searchTicket.current++;
      setSearch(null);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(() => void runSearch(words), SEARCH_DEBOUNCE_MS);
  }

  /* ── Moved to the trash, with ten seconds to change one's mind ─────── */

  /** Notes just moved to the trash, shown in their place with «قايتۇرۇش». */
  const [trashed, setTrashed] = useState<NoteSummary[]>([]);
  const undoTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  function forgetTrashed(id: number) {
    const timer = undoTimers.current.get(id);
    if (timer) clearTimeout(timer);
    undoTimers.current.delete(id);
    setTrashed((list) => list.filter((note) => note.id !== id));
  }

  useEffect(() => {
    const timers = undoTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  /** Search results follow what the list does, without searching again. */
  function editResults(edit: (results: NoteSummary[]) => NoteSummary[]) {
    setSearch((current) => current && { ...current, notes: edit(current.notes) });
  }

  /* ── Actions ────────────────────────────────────────────────────────── */

  function create() {
    startCreate(async () => {
      const result = await createNoteAction();
      if (result.ok) router.push(`/notes/${result.id}`);
      else setError(result.error);
    });
  }

  function togglePin(note: NoteSummary) {
    const pinnedAt = note.pinned_at ? null : new Date().toISOString();
    setError(null);
    editResults((results) => results.map((item) => (item.id === note.id ? { ...item, pinned_at: pinnedAt } : item)));
    startChange(async () => {
      change({ kind: "pin", id: note.id, pinnedAt });
      const result = await pinNoteAction(note.id, pinnedAt !== null);
      if (!result.ok) {
        setError(result.error);
        editResults((results) => results.map((item) => (item.id === note.id ? note : item)));
      }
    });
  }

  /**
   * «ئۆچۈرۈش»: into the trash at once, no question asked — it is not final.
   * The row turns into «ئەخلەت ساندۇقىغا يۆتكەلدى.» with «قايتۇرۇش» for ten
   * seconds, right where the writer's finger is, rather than a toast that
   * could sit over the list on a phone.
   */
  function moveToTrash(note: NoteSummary) {
    setError(null);
    setTrashed((list) => [...list.filter((item) => item.id !== note.id), note]);
    const previous = undoTimers.current.get(note.id);
    if (previous) clearTimeout(previous);
    undoTimers.current.set(
      note.id,
      setTimeout(() => forgetTrashed(note.id), TRASH_UNDO_MS),
    );
    editResults((results) => results.filter((item) => item.id !== note.id));
    startChange(async () => {
      change({ kind: "trash", id: note.id });
      const result = await trashNoteAction(note.id);
      if (!result.ok) {
        setError(result.error);
        forgetTrashed(note.id);
        if (result.code !== "not_found") editResults((results) => [...results, note]);
      }
    });
  }

  function restore(note: NoteSummary) {
    setError(null);
    editResults((results) => [...results.filter((item) => item.id !== note.id), note]);
    startChange(async () => {
      change({ kind: "restore", note });
      const timer = undoTimers.current.get(note.id);
      if (timer) clearTimeout(timer);
      undoTimers.current.delete(note.id);
      setTrashed((list) => list.filter((item) => item.id !== note.id));
      const result = await restoreNoteAction(note.id);
      if (!result.ok) {
        setError(result.error);
        editResults((results) => results.filter((item) => item.id !== note.id));
      }
    });
  }

  /* ── What is on screen ──────────────────────────────────────────────── */

  const base = searchActive ? (search?.notes ?? null) : shownNotes;
  const groups = useMemo(() => {
    if (base === null) return null;
    // A note in the trash for its ten seconds keeps its place among the rest
    // — until it is back among them, restored.
    const visible = new Set(base.map((note) => note.id));
    const undoable = trashed.filter((note) => !visible.has(note.id));
    return {
      ...sortNotes([...base, ...undoable], sort, compareTitles),
      undoable: new Set(undoable.map((note) => note.id)),
    };
  }, [base, trashed, sort, compareTitles]);
  const hasNotes = notes.length > 0 || trashed.length > 0 || searchActive;

  function renderRow(note: NoteSummary) {
    return groups?.undoable.has(note.id) ? (
      <TrashedRow key={note.id} note={note} onRestore={() => restore(note)} />
    ) : (
      <NoteRow
        key={note.id}
        note={note}
        onPin={() => togglePin(note)}
        onTrash={() => moveToTrash(note)}
      />
    );
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="btn-am"
          data-testid="new-note"
          disabled={creating}
          aria-describedby={countFull ? NOTES_USAGE_ID : undefined}
          onClick={create}
        >
          <Icon name="plus" />
          يېڭى خاتىرە
        </button>
        {trashCount > 0 && (
          <Link href="/notes/trash" className="hbtn" data-testid="trash-link">
            <Icon name="trash" />
            ئەخلەت ساندۇقى ({trashCount})
          </Link>
        )}
      </div>

      {hasNotes && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-[1_1_14rem]" role="search" aria-label="خاتىرىلەردىن ئىزدەش">
            <Icon
              name="search"
              className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink3"
            />
            <input
              type="search"
              autoComplete="off"
              // The clear button below is the one way to empty it; the
              // browser's own would be a second one beside it.
              className="field ps-10 pe-12 [&::-webkit-search-cancel-button]:appearance-none"
              data-testid="notes-search"
              aria-label="خاتىرىلىرىمدىن ئىزدەش"
              placeholder="خاتىرىلىرىمدىن ئىزدەش"
              maxLength={SEARCH_MAX_CHARS * 2}
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  changeQuery("");
                }
              }}
            />
            {query && (
              <button
                type="button"
                className="ibtn absolute end-0 top-1/2 -translate-y-1/2"
                data-testid="notes-search-clear"
                aria-label="ئىزدەشنى تازىلاش"
                onClick={() => changeQuery("")}
              >
                <Icon name="x" />
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-ink2">
            تەرتىپ
            <select
              className="field w-auto"
              data-testid="notes-sort"
              value={sort}
              onChange={(event) => {
                if (isNoteSort(event.target.value)) setNoteSort(event.target.value);
              }}
            >
              {NOTE_SORTS.map((option) => (
                <option key={option} value={option}>
                  {NOTE_SORT_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-[var(--radius)] bg-ab2 px-3.5 py-3 text-[13px]" data-testid="notes-error">
          {error}
        </p>
      )}
      {searchActive && searchError && (
        <p role="alert" className="mt-3 rounded-[var(--radius)] bg-ab2 px-3.5 py-3 text-[13px]" data-testid="notes-search-error">
          {searchError}
        </p>
      )}
      {searchActive && searching && (
        <p role="status" className="mt-3 text-[12.5px] text-ink3" data-testid="notes-searching">
          ئىزدەۋاتىدۇ…
        </p>
      )}

      {!hasNotes ? (
        <p className="paper mt-5 p-6 text-center text-[13.5px] leading-7 text-ink2" data-testid="notes-empty">
          تېخى خاتىرە يوق. «يېڭى خاتىرە» نى بېسىپ يېزىشنى باشلاڭ — خاتىرىلىرىڭىزنى
          پەقەت سىزلا كۆرەلەيسىز.
        </p>
      ) : groups === null ? null : groups.pinned.length + groups.others.length === 0 ? (
        searchActive && search && !searching ? (
          <p
            className="paper mt-5 p-6 text-center text-[13.5px] leading-7 text-ink2"
            role="status"
            data-testid="notes-search-empty"
          >
            {SEARCH_EMPTY}
          </p>
        ) : null
      ) : (
        <div className="mt-4" data-testid="note-list">
          {groups.pinned.length > 0 && (
            <section aria-labelledby="notes-pinned-heading" className="mb-4">
              <h2 id="notes-pinned-heading" className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-ink2">
                <Icon name="pin" className="text-am" />
                مىقلانغانلار
              </h2>
              <ul className="space-y-2" data-testid="notes-pinned">
                {groups.pinned.map(renderRow)}
              </ul>
            </section>
          )}
          {groups.others.length > 0 && (
            <section aria-labelledby={groups.pinned.length > 0 ? "notes-others-heading" : undefined}>
              {groups.pinned.length > 0 && (
                <h2 id="notes-others-heading" className="mb-2 text-[13px] font-bold text-ink2">
                  باشقا خاتىرىلەر
                </h2>
              )}
              <ul className="space-y-2" data-testid="notes-others">
                {groups.others.map(renderRow)}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function NoteRow({ note, onPin, onTrash }: { note: NoteSummary; onPin: () => void; onTrash: () => void }) {
  const pinned = note.pinned_at !== null;
  return (
    <li
      className="paper flex items-start gap-1 p-3 sm:p-3.5"
      data-testid="note-row"
      data-note-id={note.id}
      data-pinned={pinned ? "true" : "false"}
    >
      <Link href={`/notes/${note.id}`} className="min-w-0 flex-1 py-0.5" data-testid="note-link">
        <span className="block truncate text-[15px] font-bold text-ink">{note.title}</span>
        {note.preview && (
          <span className="mt-0.5 line-clamp-2 text-[13px] leading-6 text-ink2" data-testid="note-preview">
            {note.preview}
          </span>
        )}
        <span className="mt-1 block text-[12px] text-ink3" data-testid="note-meta">
          <LocalTime stamp={note.updated_at} /> · {note.length.toLocaleString("en-US")} ھەرپ
        </span>
      </Link>
      <button
        type="button"
        className={pinned ? "ibtn shrink-0 bg-ab text-am" : "ibtn shrink-0"}
        aria-pressed={pinned}
        aria-label={`${note.title} — ${pinned ? "مىقلاشنى بىكار قىلىش" : "مىقلاش"}`}
        title={pinned ? "مىقلاشنى بىكار قىلىش" : "مىقلاش"}
        data-testid="pin-note"
        onClick={onPin}
      >
        <Icon name="pin" />
      </button>
      <button
        type="button"
        className="ibtn shrink-0"
        aria-label={`${note.title} — ئۆچۈرۈش`}
        title="ئۆچۈرۈش"
        data-testid="delete-note"
        onClick={onTrash}
      >
        <Icon name="trash" />
      </button>
    </li>
  );
}

/** A note moved to the trash a moment ago, in its own place, with ten seconds to undo. */
function TrashedRow({ note, onRestore }: { note: NoteSummary; onRestore: () => void }) {
  return (
    <li
      className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-dashed border-bd2 bg-ab px-3.5 py-2.5 text-[13px] leading-6"
      role="status"
      data-testid="note-trashed"
      data-note-id={note.id}
    >
      <span className="min-w-0 flex-1">
        <span className="font-semibold">«{note.title}»</span> {MOVED_TO_TRASH}
      </span>
      <button
        type="button"
        className="hbtn shrink-0"
        data-testid="note-trash-undo"
        // The button that was pressed has gone with its row; the way back
        // takes the focus, so a keyboard is not left nowhere.
        autoFocus
        onClick={onRestore}
      >
        <Icon name="undo" />
        قايتۇرۇش
      </button>
    </li>
  );
}
