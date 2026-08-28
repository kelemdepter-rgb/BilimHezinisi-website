"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { askStream, type StreamHandle } from "@/lib/ai/client";
import type { AiFailure } from "@/lib/ai/errors";
import {
  EXAMPLE_QUESTIONS,
  READER_TYPES,
  TRANSLATION_DIRECTIONS,
  buildPrompt,
  type LangCode,
  type ReaderType,
} from "@/lib/ai/prompts";
import { detectType } from "@/lib/ai/content-type";
import {
  capContext,
  describeSize,
  fetchWholeBook,
  readSelection,
  type AiScope,
  type BookContext,
} from "@/lib/ai/book-context";
import { renderMarkdown } from "@/lib/books/render-markdown";
import { saveAnswerToNotebook } from "@/lib/ai/save-answer";
import { DEFAULT_THINKING_LEVEL, deepThinkChangesAnything } from "@/lib/ai/models";
import { useAiState } from "@/lib/ai/use-ai-state";
import { useDockedLayout } from "@/lib/ai/use-docked-layout";
import type { BookPage } from "@/lib/reader/pages";

export { useDockedLayout };

/** Shown once per session, the first time the panel is opened. */
const NOTICE_KEY = "bh-ai-reader-notice";

function noticeAlreadySeen(): boolean {
  try {
    return sessionStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

type Request = {
  type: string;
  context: string;
  question: string;
  deepThink: boolean;
  translateFrom?: LangCode;
  translateTo?: LangCode;
};

const EMPTY_CONTEXT: BookContext = { text: "", chars: 0, truncated: false };

export function AiPanel({
  open,
  openToken,
  docked,
  onClose,
  bookId,
  title,
  author,
  pageCount,
  published,
  loadedPages,
  currentPage,
  containerRef,
  initialSelection,
  initialPageText,
}: {
  open: boolean;
  /** Bumped on every open, so the panel starts clean without an effect. */
  openToken: number;
  docked: boolean;
  onClose: () => void;
  bookId: number;
  title: string;
  author: string;
  pageCount: number;
  published: boolean;
  loadedPages: BookPage[];
  currentPage: () => number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Captured when the reader tapped «سۈنئىي ئىدراك» on a selection. */
  initialSelection: string;
  /** The page under the viewport when the panel was opened. */
  initialPageText: string;
}) {
  const [scope, setScope] = useState<AiScope>("page");
  const [context, setContext] = useState<BookContext>(EMPTY_CONTEXT);
  const [needsSelection, setNeedsSelection] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [type, setType] = useState<ReaderType>("general");
  const [typeUserSet, setTypeUserSet] = useState(false);
  const [question, setQuestion] = useState("");
  const [deep, setDeep] = useState(false);
  const [menu, setMenu] = useState<"none" | "translate" | "term">("none");
  const [answer, setAnswer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [failure, setFailure] = useState<AiFailure | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [savedNoteId, setSavedNoteId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState(false);

  const [lastRequest, setLastRequest] = useState<Request | null>(null);

  /**
   * Whether «چوڭقۇر مۇلاھىزە» is worth offering at all.
   *
   * The toggle asks for `thinkingLevel: "high"`. gemini-3.1-pro-preview
   * already runs at `high` by default, so for that model the control would
   * change precisely nothing — and it is not shown rather than shown as a lie.
   */
  const { model } = useAiState();
  const deepAvailable = deepThinkChangesAnything(model);

  const stream = useRef<StreamHandle | null>(null);
  const gather = useRef<AbortController | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Everything resets on each open, adjusted during the render that notices
   * rather than in an effect — the same shape the app shell uses for its
   * drawer. The starting scope is what the reader has already told us: a
   * selection if they made one, otherwise the page they are looking at.
   */
  const [seenToken, setSeenToken] = useState(openToken);
  if (seenToken !== openToken) {
    setSeenToken(openToken);
    const startScope: AiScope = initialSelection ? "selection" : "page";
    const text = initialSelection || initialPageText;
    setScope(startScope);
    setContext(capContext(text));
    setNeedsSelection(startScope === "selection" && !initialSelection);
    setType(detectType(text));
    setTypeUserSet(false);
    setProgress(null);
    setMenu("none");
    setAnswer("");
    setFailure(null);
    setSlot(null);
    setLastRequest(null);
    setSaveState("idle");
    setSavedNoteId(null);
    setCopied(false);
    setNotice(!noticeAlreadySeen());
  }

  /** The page under the viewport, as text. */
  function pageText(): string {
    const pageNo = currentPage();
    return loadedPages.find((page) => page.page_no === pageNo)?.content ?? "";
  }

  /**
   * Body scroll is locked only while the sheet covers the screen. Docked, the
   * reader must keep scrolling the book — that is the entire point of docking
   * it. The scroll position is captured on open and put back on close, so
   * opening the panel can never cost a reader their place.
   */
  useEffect(() => {
    if (!open) return;
    const restoreTo = window.scrollY;
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
      // Only when it actually moved: an unconditional scroll would fight the
      // browser's own restoration and produce a visible jump.
      if (Math.abs(window.scrollY - restoreTo) > 2) window.scrollTo(0, restoreTo);
    };
  }, [open, docked, onClose]);

  /** A request still running when this unmounts would leak its callbacks. */
  useEffect(
    () => () => {
      stream.current?.abort();
      gather.current?.abort();
    },
    [],
  );

  function dismissNotice() {
    setNotice(false);
    try {
      sessionStorage.setItem(NOTICE_KEY, "1");
    } catch {
      // A browser with no session storage simply shows it again next time.
    }
  }

  function applyContext(text: string, detected = true) {
    const next = capContext(text);
    setContext(next);
    if (detected && !typeUserSet && text) setType(detectType(text));
  }

  async function chooseScope(next: AiScope) {
    gather.current?.abort();
    setMenu("none");
    setScope(next);
    setProgress(null);
    setNeedsSelection(false);

    if (next === "selection") {
      const selected = initialSelection || readSelection(containerRef.current);
      setNeedsSelection(!selected);
      applyContext(selected);
      return;
    }
    if (next === "page") {
      applyContext(pageText());
      return;
    }

    // The whole book: a real download, so it is shown and can be stopped.
    const controller = new AbortController();
    gather.current = controller;
    setContext(EMPTY_CONTEXT);
    setProgress({ loaded: 0, total: 1 });
    try {
      const whole = await fetchWholeBook({
        bookId,
        pageCount,
        published,
        known: loadedPages,
        signal: controller.signal,
        onProgress: (loaded, total) => setProgress({ loaded, total }),
      });
      if (controller.signal.aborted) return;
      setContext(whole);
      if (!typeUserSet && whole.text) setType(detectType(whole.text));
    } catch {
      if (!controller.signal.aborted) {
        setContext(EMPTY_CONTEXT);
        setFailure({ ok: false, error: "كىتاب مەزمۇنىنى ئوقۇغىلى بولمىدى. قايتا سىناڭ." });
      }
    } finally {
      if (gather.current === controller) gather.current = null;
      setProgress(null);
    }
  }

  function run(request: Request) {
    stream.current?.abort();
    setLastRequest(request);
    setAnswer("");
    setFailure(null);
    setSlot(null);
    setSaveState("idle");
    setSavedNoteId(null);
    setCopied(false);
    setStreaming(true);

    stream.current = askStream(
      {
        prompt: buildPrompt({
          type: request.type,
          context: request.context,
          question: request.question,
          translateFrom: request.translateFrom,
          translateTo: request.translateTo,
        }),
        deepThink: request.deepThink,
      },
      (delta) => setAnswer((current) => current + delta),
      (full, _model, _usage, meta) => {
        setAnswer(full);
        setSlot(meta.slot);
        setStreaming(false);
        stream.current = null;
      },
      (error) => {
        setFailure(error);
        setAnswer("");
        setStreaming(false);
        stream.current = null;
      },
      // A mid-stream failover restarts on the next key; what is on screen
      // belongs to the attempt that just died.
      () => setAnswer(""),
    );
  }

  /** Refuse politely rather than send a request with nothing in it. */
  function contextMissing(): boolean {
    if (context.text) return false;
    setFailure({
      ok: false,
      error:
        scope === "selection"
          ? "ئالدى بىلەن ئوقۇغۇچتىكى تېكىستنى تاللاڭ."
          : "تېكىست تېپىلمىدى.",
    });
    return true;
  }

  function quick(kind: "summary" | "central_idea" | "term_explain_auto") {
    setMenu("none");
    if (contextMissing()) return;
    run({
      type: kind === "term_explain_auto" ? "term_explain" : kind,
      context: context.text,
      question: "",
      deepThink: deep && deepAvailable,
    });
  }

  function translate(from: LangCode, to: LangCode) {
    setMenu("none");
    if (contextMissing()) return;
    run({
      type: "translation",
      translateFrom: from,
      translateTo: to,
      context: context.text,
      question: "",
      deepThink: false,
    });
  }

  /** «ئاتالغۇنى يېزىڭ» — switch the type and let the reader type the term. */
  function termManual() {
    setMenu("none");
    setType("term_explain");
    setTypeUserSet(true);
    setQuestion("");
    questionRef.current?.focus();
  }

  function ask() {
    setMenu("none");
    const text = question.trim();
    if (!context.text && !text) {
      setFailure({ ok: false, error: "تېكىست ياكى سوئال يوق." });
      return;
    }
    if (scope === "selection" && !context.text) {
      setFailure({ ok: false, error: "ئالدى بىلەن ئوقۇغۇچتىكى تېكىستنى تاللاڭ." });
      return;
    }
    run({ type, context: context.text, question: text, deepThink: deep && deepAvailable });
  }

  function stop() {
    stream.current?.abort();
    stream.current = null;
    setStreaming(false);
    setAnswer("");
  }

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  /**
   * Save into the notebook.
   *
   * This is the ONE path on which an answer reaches our server, and it does so
   * only because the reader pressed a button asking for exactly that. What is
   * stored is an ordinary note in their own notebook, under the same RLS as
   * every other note. Nothing about AI is written anywhere without this tap.
   */
  async function saveToNotebook() {
    if (!answer || saveState === "saving") return;
    setSaveState("saving");
    const result = await saveAnswerToNotebook({
      bookId,
      title,
      author,
      pageNo: currentPage(),
      question: lastRequest?.question ?? "",
      typeLabelText: labelFor(lastRequest?.type ?? type),
      answerHtml: renderMarkdown(answer),
    });
    if (result.ok) {
      setSavedNoteId(result.id);
      setSaveState("saved");
    } else {
      setSaveState("failed");
    }
  }

  const chips = (EXAMPLE_QUESTIONS[type] ?? EXAMPLE_QUESTIONS.general ?? []).slice(0, 2);
  const busyGathering = progress !== null;

  return (
    <>
      {/* No overlay when docked: the book behind stays readable and clickable,
          which is the whole reason for docking rather than covering. */}
      {!docked && (
        <div
          data-testid="ai-overlay"
          aria-hidden="true"
          onClick={onClose}
          className={`fixed inset-0 z-40 bg-black/45 transition-[opacity,visibility] duration-200 print:hidden ${
            open ? "visible opacity-100" : "invisible opacity-0"
          }`}
        />
      )}

      <aside
        data-testid="ai-panel"
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
            : `inset-x-0 bottom-0 max-h-[calc(100dvh-7rem)] rounded-t-2xl border-t ${
                open ? "visible translate-y-0" : "invisible translate-y-full"
              }`
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-bd px-3">
          <span className="flex items-center gap-2 text-[14px] font-bold">
            <Icon name="sparkles" className="text-am" />
            سۈنئىي ئىدراك ياردەمچىسى
          </span>
          <button
            type="button"
            ref={closeRef}
            className="ibtn"
            data-testid="ai-panel-close"
            aria-label="تاقاش"
            onClick={onClose}
          >
            <Icon name="x" className="ic-lg" />
          </button>
        </div>

        {/* The composer and the answer share one scroll container, so focusing
            the question box lets the browser scroll the send button into view
            when the on-screen keyboard takes half the screen. */}
        <div className="safe-bottom safe-x flex-1 overflow-y-auto overscroll-contain p-3">
          {notice && (
            <div
              role="status"
              data-testid="ai-first-notice"
              className="mb-3 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3 py-2.5 text-[12.5px] leading-6"
            >
              سىز تاللىغان تېكىست ۋە سوئالىڭىز <b>Google غا</b> ئەۋەتىلىدۇ. بۇ كۇتۇپخانا
              ئۇنى كۆرمەيدۇ ۋە ساقلىمايدۇ.{" "}
              <a href="/my/ai" className="text-am underline underline-offset-4">
                تولۇق چۈشەندۈرۈش
              </a>
              <button
                type="button"
                className="hbtn mt-2 w-full"
                data-testid="ai-notice-dismiss"
                onClick={dismissNotice}
              >
                چۈشەندىم
              </button>
            </div>
          )}

          {/* ── scope ─────────────────────────────────────────────────── */}
          <div className="flex gap-1 rounded-[var(--radius)] bg-bg3 p-1" role="group" aria-label="دائىرە">
            {(
              [
                ["selection", "تاللانغان"],
                ["page", "بۇ بەت"],
                ["all", "پۈتۈن كىتاب"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                data-testid={`ai-scope-${id}`}
                aria-pressed={scope === id}
                disabled={busyGathering}
                className={`min-h-11 flex-1 rounded-[var(--radius2)] px-1 text-[12px] ${
                  scope === id ? "bg-bg font-bold text-am shadow-sm" : "text-ink2"
                }`}
                onClick={() => void chooseScope(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <p className="mt-1.5 min-h-5 text-[11.5px] text-ink3" data-testid="ai-scope-meta">
            {busyGathering ? (
              <>
                كىتاب ئوقۇلۇۋاتىدۇ… <span dir="ltr">{progress.loaded}/{progress.total}</span>
              </>
            ) : needsSelection ? (
              "ئالدى بىلەن ئوقۇغۇچتىكى تېكىستنى تاللاڭ"
            ) : context.chars > 0 ? (
              describeSize(context.chars)
            ) : (
              "(تېكىست تېپىلمىدى)"
            )}
          </p>

          {busyGathering && (
            <button
              type="button"
              className="hbtn mt-1.5 w-full"
              data-testid="ai-gather-cancel"
              onClick={() => {
                gather.current?.abort();
                gather.current = null;
                setProgress(null);
                setScope("page");
                applyContext(pageText());
              }}
            >
              <Icon name="x" />
              توختىتىش
            </button>
          )}

          {context.truncated && (
            <p
              role="status"
              data-testid="ai-truncated"
              className="mt-1.5 rounded-[var(--radius)] bg-ab2 px-2.5 py-2 text-[11.5px] leading-6"
            >
              بۇ كىتاب بىر قېتىملىق سوئالغا بەك چوڭ. باشلىنىش قىسمى ئەۋەتىلىدۇ — ئېنىقراق
              جاۋاب ئۈچۈن «بۇ بەت» ياكى تاللانغان بۆلەكنى ئىشلىتىڭ.
            </p>
          )}

          {/* ── text type ──────────────────────────────────────────────── */}
          <label className="mt-3 block">
            <span className="mb-1 block text-[12px] font-semibold text-ink2">تېكىست تۈرى</span>
            <select
              className="field"
              data-testid="ai-type"
              value={type}
              onChange={(event) => {
                setType(event.target.value as ReaderType);
                setTypeUserSet(true);
              }}
            >
              {READER_TYPES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          {/* ── quick actions ──────────────────────────────────────────── */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <QuickButton testId="ai-quick-summary" onClick={() => quick("summary")}>
              خۇلاسىلەش
            </QuickButton>
            <QuickButton
              testId="ai-quick-translate"
              expanded={menu === "translate"}
              onClick={() => setMenu((current) => (current === "translate" ? "none" : "translate"))}
            >
              تەرجىمە ▾
            </QuickButton>
            <QuickButton testId="ai-quick-central" onClick={() => quick("central_idea")}>
              مەركىزىي ئىدىيەسى
            </QuickButton>
            <QuickButton
              testId="ai-quick-term"
              expanded={menu === "term"}
              onClick={() => setMenu((current) => (current === "term" ? "none" : "term"))}
            >
              ئاتالغۇ چۈشەندۈرۈش ▾
            </QuickButton>
          </div>

          {menu === "translate" && (
            <div
              className="mt-2 flex flex-wrap gap-1.5 rounded-[var(--radius)] border border-bd p-2"
              data-testid="ai-translate-menu"
            >
              {TRANSLATION_DIRECTIONS.map((direction) => (
                <button
                  key={`${direction.from}-${direction.to}`}
                  type="button"
                  className="hbtn text-[11.5px]"
                  data-testid={`ai-translate-${direction.from}-${direction.to}`}
                  onClick={() => translate(direction.from, direction.to)}
                >
                  {direction.label}
                </button>
              ))}
            </div>
          )}

          {menu === "term" && (
            <div
              className="mt-2 flex flex-wrap gap-1.5 rounded-[var(--radius)] border border-bd p-2"
              data-testid="ai-term-menu"
            >
              <button type="button" className="hbtn text-[11.5px]" data-testid="ai-term-manual" onClick={termManual}>
                ئاتالغۇنى يېزىڭ
              </button>
              <button
                type="button"
                className="hbtn text-[11.5px]"
                data-testid="ai-term-auto"
                onClick={() => quick("term_explain_auto")}
              >
                ئاپتوماتىك
              </button>
            </div>
          )}

          {/* ── free question ──────────────────────────────────────────── */}
          <label className="mt-3 block">
            <span className="mb-1 block text-[12px] font-semibold text-ink2">سوئالىڭىز</span>
            <textarea
              ref={questionRef}
              className="field min-h-20 resize-y"
              rows={3}
              data-testid="ai-question"
              placeholder={
                type === "term_explain"
                  ? "چۈشەندۈرمەكچى بولغان ئاتالغۇنى يېزىڭ"
                  : "تېكىست مەزمۇنى ھەققىدە سۈنئىي ئىدراكتىن سوراڭ"
              }
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              // The keyboard covers the lower half of a phone; bringing the
              // composer to the middle keeps the send button on screen.
              onFocus={(event) => event.currentTarget.scrollIntoView({ block: "center" })}
            />
          </label>

          {chips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="ai-chips">
              {chips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="hbtn text-[11.5px]"
                  onClick={() => {
                    setQuestion(chip);
                    questionRef.current?.focus();
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-am"
              data-testid="ai-ask"
              disabled={streaming || busyGathering}
              onClick={ask}
            >
              <Icon name="sparkles" />
              سوراش
            </button>
            {deepAvailable ? (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[11.5px] text-ink2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--am)]"
                  data-testid="ai-deep"
                  checked={deep}
                  onChange={(event) => setDeep(event.target.checked)}
                />
                چوڭقۇر مۇلاھىزە <span className="text-ink3">(سۈپەتلىك، ئاستىراق)</span>
              </label>
            ) : (
              // Not a disabled checkbox: there is nothing to switch on, because
              // this model already reasons at the deepest level Google offers.
              <span className="text-[11.5px] text-ink3" data-testid="ai-deep-always">
                بۇ مودېل ھەمىشە چوڭقۇر مۇلاھىزە قىلىدۇ ({DEFAULT_THINKING_LEVEL[model]})
              </span>
            )}
          </div>

          {/* ── status ─────────────────────────────────────────────────── */}
          {streaming && (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-ink2">
              <span role="status" data-testid="ai-streaming">
                جاۋاب يېزىلىۋاتىدۇ…
              </span>
              <button type="button" className="hbtn" data-testid="ai-stop" onClick={stop}>
                توختىتىش
              </button>
            </div>
          )}

          {failure && (
            <div
              role="alert"
              data-testid="ai-error"
              className="mt-3 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3 py-2.5 text-[12.5px] leading-7"
            >
              {failure.error}
              <div className="mt-2 flex flex-wrap gap-2">
                {lastRequest && (
                  <button
                    type="button"
                    className="hbtn"
                    data-testid="ai-retry"
                    onClick={() => run(lastRequest)}
                  >
                    <Icon name="refresh" />
                    قايتا سىناش
                  </button>
                )}
                {(failure.quotaExhausted ||
                  failure.keyInvalid ||
                  failure.busy ||
                  failure.paidOnlyModel ||
                  failure.noKey) && (
                  <a href="/my/ai" className="hbtn" data-testid="ai-settings-link">
                    <Icon name="key" />
                    ئاچقۇچ تەڭشىكى
                  </a>
                )}
              </div>
            </div>
          )}

          {/* ── the answer ─────────────────────────────────────────────── */}
          {answer && (
            <div className="mt-3">
              {/* Deliberately unlike the reading surface: a labelled, bordered
                  card on the accent wash, so an answer can never be mistaken
                  for a sentence of the book. */}
              <div
                className="rounded-[var(--radius)] border border-bd2 bg-ab"
                data-testid="ai-answer-card"
              >
                <p className="flex items-center gap-1.5 border-b border-bd2 px-3 py-1.5 text-[11px] font-bold text-am">
                  <Icon name="sparkles" />
                  سۈنئىي ئىدراكنىڭ جاۋابى
                </p>
                <div
                  ref={answerRef}
                  data-testid="ai-answer"
                  dir="rtl"
                  className="md-body max-h-[46dvh] overflow-y-auto overscroll-contain px-3 py-2.5 text-[13.5px] leading-8"
                  // renderMarkdown runs markdown-it with html:false, so the
                  // only tags here are ones it generated — the same guarantee
                  // the book pages themselves rely on.
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }}
                />
              </div>

              {!streaming && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" className="hbtn" data-testid="ai-copy" onClick={() => void copyAnswer()}>
                    <Icon name="copy" />
                    {copied ? "كۆچۈرۈلدى" : "كۆچۈرۈش"}
                  </button>
                  <button
                    type="button"
                    className="hbtn"
                    data-testid="ai-save-note"
                    disabled={saveState === "saving"}
                    onClick={() => void saveToNotebook()}
                  >
                    <Icon name="notebook-pen" />
                    {saveState === "saving" ? "ساقلىنىۋاتىدۇ…" : "خاتىرىگە ساقلاش"}
                  </button>
                  {saveState === "saved" && savedNoteId !== null && (
                    <a
                      href={`/notes/${savedNoteId}`}
                      className="text-[12px] text-am underline underline-offset-4"
                      data-testid="ai-saved-link"
                    >
                      خاتىرىنى ئېچىش
                    </a>
                  )}
                  {saveState === "failed" && (
                    <span role="alert" className="text-[12px] text-danger" data-testid="ai-save-failed">
                      ساقلانمىدى. قايتا سىناڭ.
                    </span>
                  )}
                  {slot !== null && slot > 0 && (
                    <span className="text-[11px] text-ink3" data-testid="ai-slot">
                      <span dir="ltr">{slot + 1}</span>-ئاچقۇچ
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Permanent, quiet, and never dismissible — readers here are asking
              about religious and historical texts, where a confident wrong
              answer does real damage. */}
          <p className="mt-4 border-t border-bd pt-3 text-[11.5px] leading-6 text-ink3" data-testid="ai-disclaimer">
            سۈنئىي ئىدراكنىڭ جاۋابى خاتا بولۇشى مۇمكىن. مۇھىم مەسىلىلەردە جاۋابنى كىتابنىڭ
            ئۆزىدىن ۋە ئىشەنچلىك مەنبەدىن تەكشۈرۈڭ.
          </p>
        </div>
      </aside>
    </>
  );
}

function labelFor(type: string): string {
  return READER_TYPES.find((entry) => entry.id === type)?.label ?? "ئادەتتىكى";
}

function QuickButton({
  children,
  onClick,
  testId,
  expanded,
}: {
  children: React.ReactNode;
  onClick: () => void;
  testId: string;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-expanded={expanded}
      onClick={onClick}
      className="flex min-h-11 items-center justify-center rounded-[var(--radius)] border border-bd2 bg-bg px-2 text-[12px] text-ink hover:border-am hover:bg-ab"
    >
      {children}
    </button>
  );
}
