"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { askStream, chatStream, type StreamHandle } from "@/lib/ai/client";
import type { AiFailure } from "@/lib/ai/errors";
import { TRANSLATION_DIRECTIONS, buildPrompt, type LangCode } from "@/lib/ai/prompts";
import {
  BATCH_CHARS,
  buildBatches,
  buildDiff,
  checkBatch,
  describeChars,
  formatBatch,
  malformedMessage,
  type Change,
  type Segment,
} from "@/lib/ai/proofread";
import {
  applyUnitLines,
  collectUnits,
  countQuoted,
  sendableLines,
  type NoteUnit,
  type UnitLine,
} from "@/lib/ai/note-blocks";
import { useDockedLayout } from "@/lib/ai/use-docked-layout";
import { renderMarkdown } from "@/lib/books/render-markdown";

/**
 * The notebook's AI workspace.
 *
 * Four things, ported from the desktop's notes.js: a free-form chat, a
 * proofreader, a summariser and a translator. Two rules run through all of
 * them and are the reason this file is as careful as it is:
 *
 *   1. NOTHING ENTERS THE NOTE WITHOUT THE WRITER SAYING SO. Every result
 *      lands in the panel; inserting, replacing or applying is always a
 *      separate, deliberate tap.
 *   2. THE WRITER CAN ALWAYS SEE WHAT IS ABOUT TO BE SENT. A note is the most
 *      private thing on this site, and sending a whole private notebook to
 *      Google by accident is the failure this design exists to prevent — so
 *      the scope is stated, in characters, before anything leaves.
 */

/** Shown once per session, before the first thing is sent. */
const NOTICE_KEY = "bh-ai-notes-notice";

function noticeAlreadySeen(): boolean {
  try {
    return sessionStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The ceiling for a one-shot translation.
 *
 * A translation's output is as long as its input, so the limit that bites is
 * the model's output budget rather than its context window. The desktop splits
 * long translations into 6,000-character segments; rather than stitch a
 * document back together from pieces — where a dropped piece would be
 * invisible — this refuses and offers the selection instead.
 */
const TRANSLATE_MAX_CHARS = BATCH_CHARS;

/** Reconstruction tasks need room to return the whole text, as on the desktop. */
const LONG_OUTPUT_TOKENS = 12288;

type Mode = "chat" | "proofread" | "summary" | "translate";

type ChatTurn = { role: "user" | "model"; text: string };

type Scope = { text: string; fromSelection: boolean };

export function NotesAiPanel({
  open,
  openToken,
  onClose,
  editorRef,
  selectionText,
  noteText,
  onRescope,
  onInsert,
  onReplaceSelection,
  onDocumentChanged,
}: {
  open: boolean;
  /** Bumped on every open, so the panel resets without an effect. */
  openToken: number;
  onClose: () => void;
  editorRef: React.RefObject<HTMLDivElement | null>;
  /** What was selected in the note when the scope was last captured. */
  selectionText: string;
  /** The whole note as plain text, captured at the same moment. */
  noteText: string;
  /** Re-read both from the editor — for a writer who edits while docked. */
  onRescope: () => void;
  /** Put text at the caret — the editor owns this, so autosave sees it. */
  onInsert: (text: string) => void;
  /** Replace what is selected, as one undoable step. */
  onReplaceSelection: (text: string) => void;
  /** The panel changed the document itself (proofread apply / undo). */
  onDocumentChanged: () => void;
}) {
  const docked = useDockedLayout();

  const [mode, setMode] = useState<Mode>("chat");
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AiFailure | null>(null);
  const [status, setStatus] = useState("");

  // chat
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [streamingText, setStreamingText] = useState("");

  // summary / translate
  const [result, setResult] = useState("");
  const [resultFromSelection, setResultFromSelection] = useState(false);

  // proofread
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [applied, setApplied] = useState(false);
  /** The document as it was before applying, so undo is one tap. */
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    units: NoteUnit[];
    lines: UnitLine[];
    corrected: Map<number, string>;
  } | null>(null);

  const stream = useRef<StreamHandle | null>(null);
  const cancelled = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  /** A fresh panel on every open, adjusted during the render that notices. */
  const [seenToken, setSeenToken] = useState(openToken);
  if (seenToken !== openToken) {
    setSeenToken(openToken);
    setMode("chat");
    setFailure(null);
    setStatus("");
    setResult("");
    setChanges(null);
    setApplied(false);
    setProgress(null);
    setStreamingText("");
    setNotice(!noticeAlreadySeen());
    setSnapshot(null);
    setPending(null);
  }

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    if (docked) return () => window.removeEventListener("keydown", onKeyDown);

    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, docked, onClose]);

  useEffect(
    () => () => {
      cancelled.current = true;
      stream.current?.abort();
    },
    [],
  );

  function dismissNotice() {
    setNotice(false);
    try {
      sessionStorage.setItem(NOTICE_KEY, "1");
    } catch {
      // Shown again next session; nothing breaks.
    }
  }

  /** The selection if there is one, otherwise the whole note. */
  function scope(): Scope {
    if (selectionText.trim()) return { text: selectionText.trim(), fromSelection: true };
    return { text: noteText.trim(), fromSelection: false };
  }

  function stop() {
    cancelled.current = true;
    stream.current?.abort();
    stream.current = null;
    setBusy(false);
    setProgress(null);
    setStreamingText("");
    setStatus("توختىتىلدى");
  }

  function begin() {
    cancelled.current = false;
    setFailure(null);
    setStatus("");
    setBusy(true);
  }

  /* ── summary and translation ───────────────────────────────────────── */

  function runOnScope(kind: "summary" | "translate", from?: LangCode, to?: LangCode) {
    const target = scope();
    if (!target.text) {
      setFailure({ ok: false, error: "خاتىرە بوش — ئەۋەتىدىغان تېكىست يوق." });
      return;
    }
    if (kind === "translate" && target.text.length > TRANSLATE_MAX_CHARS) {
      // Never truncate someone's document and hand back a piece of it as if it
      // were the whole thing.
      setFailure({
        ok: false,
        error:
          `بۇ خاتىرە بىر قېتىملىق تەرجىمىگە بەك ئۇزۇن (${describeChars(target.text.length)}؛ ` +
          `چېكى ${describeChars(TRANSLATE_MAX_CHARS)}). خاتىرىڭىز ئۆزگەرتىلمىدى. ` +
          `تەرجىمە قىلماقچى بولغان بۆلەكنى تاللاپ، ئاندىن قايتا سىناڭ.`,
      });
      return;
    }

    begin();
    setResult("");
    setResultFromSelection(target.fromSelection);
    stream.current = askStream(
      {
        prompt:
          kind === "translate"
            ? buildPrompt({ type: "translation", translateFrom: from, translateTo: to, context: target.text })
            : buildPrompt({ type: "summary", context: target.text }),
        // A translation must be able to return the whole text.
        ...(kind === "translate" ? { maxOutputTokens: LONG_OUTPUT_TOKENS, temperature: 0.3 } : {}),
      },
      (delta) => setResult((current) => current + delta),
      (full) => {
        setResult(full);
        setBusy(false);
        stream.current = null;
      },
      (error) => {
        setFailure(error);
        setResult("");
        setBusy(false);
        stream.current = null;
      },
      () => setResult(""),
    );
  }

  /* ── chat ──────────────────────────────────────────────────────────── */

  function sendChat() {
    const question = draft.trim();
    if (!question || busy) return;
    const next: ChatTurn[] = [...turns, { role: "user", text: question }];
    setTurns(next);
    setDraft("");
    setStreamingText("");
    begin();

    stream.current = chatStream(
      next,
      (delta) => setStreamingText((current) => current + delta),
      (full) => {
        setTurns([...next, { role: "model", text: full }]);
        setStreamingText("");
        setBusy(false);
        stream.current = null;
      },
      (error) => {
        setFailure(error);
        setStreamingText("");
        setBusy(false);
        stream.current = null;
      },
      () => setStreamingText(""),
    );
  }

  /* ── proofreading ──────────────────────────────────────────────────── */

  async function runProofread() {
    const editor = editorRef.current;
    if (!editor) return;

    const units = collectUnits(editor);
    const lines = sendableLines(units);
    setSkipped(countQuoted(units));
    if (!lines.length) {
      setFailure({ ok: false, error: "تۈزىتىدىغان تېكىست تېپىلمىدى." });
      return;
    }

    // One segment per visual LINE, so a <br> the writer typed cannot be
    // merged away by a correction.
    const segments: Segment[] = lines.map((line, index) => ({ num: index + 1, text: line.text }));
    const batches = buildBatches(segments);
    begin();
    setChanges(null);
    setApplied(false);
    setProgress({ done: 0, total: batches.length });

    const corrected = new Map<number, string>();
    for (const [index, batch] of batches.entries()) {
      if (cancelled.current) return;
      const reply = await streamOnce(formatBatch(batch));
      if (reply === null) return; // an error was already shown
      const checked = checkBatch(batch, reply);
      if (!checked.ok) {
        // Applied whole or not at all: a malformed reply changes nothing.
        setFailure({ ok: false, error: malformedMessage(checked.reason) });
        setBusy(false);
        setProgress(null);
        return;
      }
      for (const segment of checked.segments) corrected.set(segment.num - 1, segment.text);
      setProgress({ done: index + 1, total: batches.length });
    }

    if (cancelled.current) return;
    setPending({ units, lines, corrected });
    setChanges(
      buildDiff(
        lines.map((line) => line.text),
        corrected,
        (index) => units[lines[index].unit].formatted,
      ),
    );
    setBusy(false);
    setProgress(null);
  }

  /** One batch, as a promise, so the loop above reads in order. */
  function streamOnce(segmented: string): Promise<string | null> {
    return new Promise((resolve) => {
      stream.current = askStream(
        {
          prompt: buildPrompt({ type: "uy_proofread", context: segmented }),
          // The reply is as long as the input, so it needs the long budget.
          maxOutputTokens: LONG_OUTPUT_TOKENS,
          temperature: 0.2,
        },
        // The reply is checked whole, so there is nothing useful to show
        // while it arrives — the batch counter is the progress.
        () => {},
        (full) => {
          stream.current = null;
          resolve(full);
        },
        (error) => {
          stream.current = null;
          setFailure(error);
          setBusy(false);
          setProgress(null);
          resolve(null);
        },
      );
    });
  }

  function applyProofread() {
    const editor = editorRef.current;
    if (!editor || !pending || !changes?.length) return;
    // One snapshot, one undo. A programmatic rewrite of several blocks cannot
    // be undone reliably through the browser's own stack, so the panel keeps
    // the document as it was and offers to put it back in a single tap.
    setSnapshot(editor.innerHTML);

    /**
     * Rebuild only the units that actually changed, and rebuild each one
     * WHOLE — its unchanged lines carried over as they were. Writing back line
     * by line would leave a half-corrected unit if anything went wrong
     * partway, and touching an unchanged unit at all would flatten formatting
     * for no reason.
     */
    const touched = new Map<number, string[]>();
    for (const change of changes) {
      const line = pending.lines[change.index];
      const corrected = pending.corrected.get(change.index);
      if (!line || typeof corrected !== "string") continue;
      const unit = pending.units[line.unit];
      const next = touched.get(line.unit) ?? [...unit.lines];
      next[line.line] = corrected;
      touched.set(line.unit, next);
    }
    for (const [unitIndex, nextLines] of touched) {
      applyUnitLines(pending.units[unitIndex], nextLines);
    }
    setApplied(true);
    onDocumentChanged();
  }

  function undoProofread() {
    const editor = editorRef.current;
    if (!editor || snapshot === null) return;
    editor.innerHTML = snapshot;
    setSnapshot(null);
    setApplied(false);
    setChanges(null);
    setPending(null);
    onDocumentChanged();
  }

  const target = scope();
  const canInsert = Boolean(result) && !busy;

  return (
    <>
      {!docked && (
        <div
          data-testid="notes-ai-overlay"
          aria-hidden="true"
          onClick={onClose}
          className={`fixed inset-0 z-40 bg-black/45 transition-[opacity,visibility] duration-200 print:hidden ${
            open ? "visible opacity-100" : "invisible opacity-0"
          }`}
        />
      )}

      <aside
        data-testid="notes-ai-panel"
        data-docked={docked ? "1" : "0"}
        role="dialog"
        aria-modal={docked ? undefined : true}
        aria-label="سۈنئىي ئىدراك ياردەمچىسى"
        inert={!open}
        className={`grain fixed z-50 flex flex-col border-bd bg-bg shadow-[var(--shadow-2)] transition-[transform,visibility] duration-200 print:hidden ${
          docked
            ? `safe-top inset-y-0 end-0 h-dvh w-[26rem] border-s ${
                open ? "visible translate-x-0" : "invisible -translate-x-full"
              }`
            : /**
               * Stops below the editor's sticky toolbar, so the toolbar stays
               * visible and tappable even with the keyboard up — it is the bar
               * a writer needs while typing, which is why it is at the top in
               * the first place. 11rem clears both of its rows at 375 px;
               * tests/notes-ai.spec.ts measures the real thing rather than
               * trusting the number.
               */
              `inset-x-0 bottom-0 max-h-[calc(100dvh-11rem)] rounded-t-2xl border-t ${
                open ? "visible translate-y-0" : "invisible translate-y-full"
              }`
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-bd px-3">
          <span className="flex items-center gap-2 text-[14px] font-bold">
            <Icon name="sparkles" className="text-am" />
            سۈنئىي ئىدراك
          </span>
          <button
            type="button"
            ref={closeRef}
            className="ibtn"
            data-testid="notes-ai-close"
            aria-label="تاقاش"
            onClick={onClose}
          >
            <Icon name="x" className="ic-lg" />
          </button>
        </div>

        <div className="safe-bottom safe-x flex-1 overflow-y-auto overscroll-contain p-3">
          {notice && (
            <div
              role="status"
              data-testid="notes-ai-notice"
              className="mb-3 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3 py-2.5 text-[12.5px] leading-6"
            >
              ئەۋەتىلگەن تېكىست <b>Google غا</b> بارىدۇ. ھەقسىز دەرىجىدە Google ئۇنى ئۆز
              مەھسۇلاتلىرىنى ياخشىلاشقا ئىشلىتىدۇ ۋە <b>ئادەم</b> ئوقۇشى مۇمكىن. بۇ
              كۇتۇپخانا خاتىرىڭىزنى كۆرمەيدۇ.{" "}
              <a href="/my/ai" className="text-am underline underline-offset-4">
                تولۇق چۈشەندۈرۈش
              </a>
              <button
                type="button"
                className="hbtn mt-2 w-full"
                data-testid="notes-ai-notice-dismiss"
                onClick={dismissNotice}
              >
                چۈشەندىم
              </button>
            </div>
          )}

          {/* What is about to be sent — stated before anything leaves. */}
          <p
            className="rounded-[var(--radius)] bg-ab px-3 py-2 text-[12px] leading-6"
            data-testid="notes-ai-scope"
          >
            <b>ئەۋەتىلىدىغىنى:</b>{" "}
            {target.text
              ? `${target.fromSelection ? "تاللانغان بۆلەك" : "پۈتۈن خاتىرە"} · ${describeChars(target.text.length)}`
              : "خاتىرە بوش"}
            <button
              type="button"
              className="ms-2 underline underline-offset-4"
              data-testid="notes-ai-rescope"
              onClick={onRescope}
            >
              يېڭىلاش
            </button>
          </p>

          <div className="mt-3 flex gap-1 rounded-[var(--radius)] bg-bg3 p-1" role="tablist">
            {(
              [
                ["chat", "سوئال"],
                ["proofread", "ئىملا"],
                ["summary", "خۇلاسە"],
                ["translate", "تەرجىمە"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                data-testid={`notes-ai-tab-${id}`}
                className={`min-h-11 flex-1 rounded-[var(--radius2)] px-1 text-[12px] ${
                  mode === id ? "bg-bg font-bold text-am shadow-sm" : "text-ink2"
                }`}
                onClick={() => {
                  setMode(id);
                  setFailure(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── chat ──────────────────────────────────────────────────── */}
          {mode === "chat" && (
            <div className="mt-3">
              <div className="space-y-2" data-testid="notes-ai-chat">
                {turns.length === 0 && !streamingText && (
                  <p className="py-3 text-center text-[12.5px] text-ink3">
                    سوئالىڭىزنى يېزىپ باشلاڭ.
                  </p>
                )}
                {turns.map((turn, index) => (
                  <div key={index}>
                    {turn.role === "user" ? (
                      <div
                        className="rounded-[var(--radius)] bg-bg2 px-3 py-2 text-[13px] leading-7 text-ink"
                        data-testid="notes-ai-ask"
                      >
                        {turn.text}
                      </div>
                    ) : (
                      <div
                        className="md-body rounded-[var(--radius)] border border-bd2 bg-ab px-3 py-2 text-[13px] leading-7 text-ink"
                        data-testid="notes-ai-reply"
                        // markdown-it with html:false — the same guarantee the
                        // book pages rely on.
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.text) }}
                      />
                    )}
                    {turn.role === "model" && (
                      <div className="mt-1 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="hbtn text-[11.5px]"
                          data-testid="notes-ai-chat-insert"
                          onClick={() => onInsert(turn.text)}
                        >
                          <Icon name="plus" />
                          خاتىرىگە قىستۇرۇش
                        </button>
                        <button
                          type="button"
                          className="hbtn text-[11.5px]"
                          onClick={() => void navigator.clipboard.writeText(turn.text)}
                        >
                          <Icon name="copy" />
                          كۆچۈرۈش
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {streamingText && (
                  <div
                    className="md-body rounded-[var(--radius)] border border-bd2 bg-ab px-3 py-2 text-[13px] leading-7"
                    data-testid="notes-ai-streaming-reply"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingText) }}
                  />
                )}
              </div>

              <label className="mt-3 block">
                <span className="mb-1 block text-[12px] font-semibold text-ink2">سوئالىڭىز</span>
                <textarea
                  ref={chatInputRef}
                  className="field min-h-20 resize-y"
                  rows={2}
                  data-testid="notes-ai-input"
                  placeholder="مەسىلەن: بۇ تېمىنى قانداق باشلىسام بولىدۇ؟"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onFocus={(event) => event.currentTarget.scrollIntoView({ block: "center" })}
                />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-am"
                  data-testid="notes-ai-send"
                  disabled={busy || !draft.trim()}
                  onClick={sendChat}
                >
                  <Icon name="sparkles" />
                  ئەۋەتىش
                </button>
                {turns.length > 0 && !busy && (
                  <button
                    type="button"
                    className="hbtn"
                    data-testid="notes-ai-chat-clear"
                    onClick={() => setTurns([])}
                  >
                    <Icon name="trash" />
                    سۆھبەتنى تازىلاش
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── proofread ─────────────────────────────────────────────── */}
          {mode === "proofread" && (
            <div className="mt-3">
              <p className="text-[12.5px] leading-7 text-ink2">
                بۇ <b>تور ئارقىلىق</b> ئىملا ۋە تىنىش بەلگىسى توغرىلاش. قورال بالدىقىدىكى
                «ئىملا» كۇنۇپكىسى بولسا <b>تورسىز</b> ئىشلەيدىغان باشقا بىر ئىقتىدار —
                ئىككىسى بىر-بىرىنى ئالماشتۇرمايدۇ.
              </p>
              <p className="mt-2 text-[12.5px] leading-7 text-ink3">
                نەقىل قىلىنغان بۆلەكلەر (كىتاب نەقىلى، قۇرئان ئايىتى) <b>ئەۋەتىلمەيدۇ</b> ۋە
                ئۆزگەرتىلمەيدۇ.
              </p>

              {!changes && (
                <button
                  type="button"
                  className="btn-am mt-3"
                  data-testid="notes-ai-proofread-run"
                  disabled={busy}
                  onClick={() => void runProofread()}
                >
                  <Icon name="check" />
                  خاتىرىنى تەكشۈرۈش
                </button>
              )}

              {progress && (
                <p className="mt-2 text-[12px] text-ink3" data-testid="notes-ai-progress">
                  تەكشۈرۈلۈۋاتىدۇ… <span dir="ltr">{progress.done}/{progress.total}</span>
                </p>
              )}

              {skipped > 0 && changes && (
                <p className="mt-2 text-[12px] text-ink3" data-testid="notes-ai-skipped">
                  <span dir="ltr">{skipped}</span> نەقىل بۆلىكى ئەۋەتىلمىدى.
                </p>
              )}

              {changes && changes.length === 0 && (
                <p className="mt-3 text-[13px]" data-testid="notes-ai-no-changes">
                  خاتالىق تېپىلمىدى — خاتىرىڭىز ئۆزگەرتىلمىدى.
                </p>
              )}

              {changes && changes.length > 0 && !applied && (
                <div className="mt-3" data-testid="notes-ai-diff">
                  <p className="text-[12px] font-semibold text-ink2">
                    ئۆزگىرىدىغىنى: <span dir="ltr">{changes.length}</span> ئورۇن
                  </p>
                  <ul className="mt-2 space-y-2">
                    {changes.map((change) => (
                      <li
                        key={change.index}
                        className="rounded-[var(--radius)] border border-bd p-2 text-[12.5px] leading-7"
                      >
                        <span className="block text-danger line-through">{change.before}</span>
                        <span className="mt-1 block text-ink">{change.after}</span>
                        {change.flattensFormatting && (
                          <span className="mt-1 block text-[11px] text-ink3">
                            بۇ ئابزاسنىڭ ئىچكى فورماتى ئاددىيلىشىدۇ.
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-am"
                      data-testid="notes-ai-proofread-apply"
                      onClick={applyProofread}
                    >
                      <Icon name="check" />
                      قوللىنىش
                    </button>
                    <button
                      type="button"
                      className="hbtn"
                      data-testid="notes-ai-proofread-reject"
                      onClick={() => {
                        setChanges(null);
                        setPending(null);
                      }}
                    >
                      <Icon name="x" />
                      ۋاز كېچىش
                    </button>
                  </div>
                </div>
              )}

              {applied && (
                <div className="mt-3" data-testid="notes-ai-applied">
                  <p className="text-[13px]">تۈزىتىش قوللىنىلدى.</p>
                  <button
                    type="button"
                    className="hbtn mt-2"
                    data-testid="notes-ai-proofread-undo"
                    onClick={undoProofread}
                  >
                    <Icon name="undo" />
                    ئەسلىگە قايتۇرۇش
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── summary ───────────────────────────────────────────────── */}
          {mode === "summary" && (
            <div className="mt-3">
              <button
                type="button"
                className="btn-am"
                data-testid="notes-ai-summary-run"
                disabled={busy || !target.text}
                onClick={() => runOnScope("summary")}
              >
                <Icon name="key-points" />
                خۇلاسىلەش
              </button>
            </div>
          )}

          {/* ── translate ─────────────────────────────────────────────── */}
          {mode === "translate" && (
            <div className="mt-3 flex flex-wrap gap-1.5" data-testid="notes-ai-translate-menu">
              {TRANSLATION_DIRECTIONS.map((direction) => (
                <button
                  key={`${direction.from}-${direction.to}`}
                  type="button"
                  className="hbtn text-[11.5px]"
                  data-testid={`notes-ai-translate-${direction.from}-${direction.to}`}
                  disabled={busy || !target.text}
                  onClick={() => runOnScope("translate", direction.from, direction.to)}
                >
                  {direction.label}
                </button>
              ))}
            </div>
          )}

          {/* ── shared status, errors and results ─────────────────────── */}
          {busy && (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-ink2">
              <span role="status" data-testid="notes-ai-busy">
                ئىشلەۋاتىدۇ…
              </span>
              <button type="button" className="hbtn" data-testid="notes-ai-stop" onClick={stop}>
                توختىتىش
              </button>
            </div>
          )}

          {status && !busy && (
            <p className="mt-2 text-[12px] text-ink3" data-testid="notes-ai-status">
              {status}
            </p>
          )}

          {failure && (
            <div
              role="alert"
              data-testid="notes-ai-error"
              className="mt-3 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3 py-2.5 text-[12.5px] leading-7"
            >
              {failure.error}
              {(failure.quotaExhausted || failure.keyInvalid || failure.busy || failure.paidOnlyModel) && (
                <a href="/my/ai" className="hbtn mt-2" data-testid="notes-ai-settings-link">
                  <Icon name="key" />
                  ئاچقۇچ تەڭشىكى
                </a>
              )}
            </div>
          )}

          {(mode === "summary" || mode === "translate") && result && (
            <div className="mt-3">
              <div
                className="md-body max-h-[40dvh] overflow-y-auto overscroll-contain rounded-[var(--radius)] border border-bd2 bg-ab px-3 py-2.5 text-[13px] leading-7"
                data-testid="notes-ai-result"
                dir="rtl"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(result) }}
              />
              {canInsert && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="hbtn"
                    data-testid="notes-ai-insert"
                    onClick={() => onInsert(result)}
                  >
                    <Icon name="plus" />
                    نۇقتىغا قىستۇرۇش
                  </button>
                  {resultFromSelection && (
                    <button
                      type="button"
                      className="hbtn"
                      data-testid="notes-ai-replace"
                      onClick={() => onReplaceSelection(result)}
                    >
                      <Icon name="refresh" />
                      تاللانغاننى ئالماشتۇرۇش
                    </button>
                  )}
                  <button
                    type="button"
                    className="hbtn"
                    onClick={() => void navigator.clipboard.writeText(result)}
                  >
                    <Icon name="copy" />
                    كۆچۈرۈش
                  </button>
                </div>
              )}
            </div>
          )}

          <p
            className="mt-4 border-t border-bd pt-3 text-[11.5px] leading-6 text-ink3"
            data-testid="notes-ai-disclaimer"
          >
            سۈنئىي ئىدراكنىڭ جاۋابى خاتا بولۇشى مۇمكىن — قوللىنىشتىن بۇرۇن ئۆزىڭىز
            تەكشۈرۈڭ.
          </p>
        </div>
      </aside>
    </>
  );
}
