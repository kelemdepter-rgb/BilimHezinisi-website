/**
 * The only place in this site that talks to Google.
 *
 * The request leaves the reader's own browser and goes straight to
 * generativelanguage.googleapis.com with the reader's own key in the
 * `x-goog-api-key` header. It does not pass through our server, so the owner
 * pays nothing for it and we are never the custodian of anyone's secret.
 * Verified on 2026-08-26 that the endpoint answers cross-origin browser
 * requests, streaming endpoint included; the host is the one entry AI added to
 * connect-src in lib/security/csp.ts.
 *
 * Two rules run through everything below:
 *
 *   1. STRICT MODEL SELECTION. The model the reader picked is the model that
 *      is called. Failover changes the KEY and never the MODEL — a silent
 *      substitution would run something they did not choose, at a quality and
 *      a price they did not agree to.
 *   2. NOTHING IS LOGGED. No key, no prompt, no answer, anywhere, ever. There
 *      is deliberately not one console call in this file.
 *
 * The callback shape is the desktop's (ai.js askStream), so the reader panel
 * and the notebook can port across without being rewritten.
 */

import {
  GeminiError,
  canFailOver,
  describeFailure,
  emptyAnswerMessage,
  isPaidOnlyModelError,
  paidOnlyMessage,
  retryDelayMsOf,
  scrubKey,
  DISABLED_MESSAGE,
  NO_KEY_MESSAGE,
  type AiFailure,
} from "./errors";
import { GEMINI_API_BASE, type ModelId } from "./models";
import { CHAT_SYSTEM, buildContinuePrompt } from "./prompts";
import {
  bumpUsage,
  readEnabled,
  readKeySlots,
  readLastGoodSlot,
  readModel,
  writeLastGoodSlot,
} from "./storage";

/**
 * fetch() has no timeout of its own, so a wedged connection would hang a
 * question forever. Sixty seconds is generous on a slow phone connection and
 * short enough that a dead request cannot pin the screen. The same budget
 * guards silence mid-stream: a stream that stops sending is as stuck as one
 * that never started.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/** Retry budget for the last key standing; earlier keys fail over instead. */
const MAX_TRIES = 3;
const BACKOFF_MS = [400, 1200, 3000];

/** A response that arrived with no readable body — some proxies strip SSE. */
const NO_STREAM = "no stream";
/** The watchdog fired: no bytes at all, or none for a whole minute. */
const TIMED_OUT = `no response within ${REQUEST_TIMEOUT_MS}ms`;

/**
 * Room for the answer, and for the thinking that is drawn from the same budget.
 *
 * Every model this library offers has an output limit of 65,536 tokens
 * (Google's model pages, checked 2026-08-28). The old ceiling of 4,096 was
 * reached far sooner than it looked — Uyghur in Arabic script is
 * token-expensive, and thinking now runs at each model's own default rather
 * than at "low", so it takes a larger share. A ceiling costs nothing until it
 * is used: only the tokens actually generated are counted.
 */
export const DEFAULT_OUTPUT_TOKENS = 16_384;

/**
 * Gemini 3 thinking control.
 *
 * A NORMAL REQUEST SENDS NO `thinkingLevel` AT ALL, so each model applies its
 * own documented default — which is what AI Studio does, and is half of why
 * the same model answered better there. Google's defaults (docs/thinking,
 * checked 2026-08-28): gemini-3.7-flash `medium`, gemini-3.5-flash-lite
 * `minimal`, gemini-3.1-pro-preview `high`. Sending "low" the way this used to
 * pushed two of the three BELOW their default.
 *
 * «چوڭقۇر مۇلاھىزە» asks for `high` explicitly. It is only offered for models
 * whose default is lower — see deepThinkChangesAnything() in models.ts.
 *
 * `thinkingBudget: 0` stays out of this file: it is rejected outright by
 * gemini-3.5-flash-lite and gemini-3.1-pro-preview ("This model only works in
 * thinking mode").
 */
function thinkingConfigFor(deep: boolean) {
  return deep ? { thinkingConfig: { thinkingLevel: "high" } } : {};
}

const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
] as const;

export type AskOptions = {
  /** The user turn, already framed by whoever is asking. */
  prompt: string;
  /** Gemini systemInstruction, when the caller has one. */
  system?: string;
  /** Prior turns, oldest first. */
  history?: readonly { role: "user" | "model"; text: string }[];
  /**
   * How many prior turns to send. Six is right for a one-shot question about
   * a passage; a conversation needs the thread, so the notebook's chat raises
   * it to the desktop's twenty.
   */
  historyLimit?: number;
  maxOutputTokens?: number;
  /** Deep reasoning. Off by default so the budget goes to visible output. */
  deepThink?: boolean;
};

/** Gemini's own usageMetadata field names, kept as they arrive. */
export type GeminiUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

export type AskDoneMeta = {
  /** Which key slot answered, for the quiet "key 2 is in use" line. */
  slot: number;
  /** The last key died mid-answer with nothing left to fail over to. */
  partial?: boolean;
  /**
   * Gemini's finishReason for the answer as a whole. "STOP" means it finished;
   * anything else means the text is real but incomplete, and the reader has to
   * be told — see describeCutAnswer in errors.ts.
   */
  stopReason?: string;
  /**
   * The model Google says answered, verbatim. Shown under the answer, and
   * checked against the model that was asked for — a disagreement is reported
   * to the reader rather than swallowed.
   */
  modelVersion?: string;
};

export type StreamHandle = { abort: () => void };

type GeminiCandidate = {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: GeminiUsage;
  /**
   * The model Google actually ran. Strict model selection is only a claim
   * until something checks it, and this is the only evidence there is — so it
   * is read, carried to the panel, and shown under the answer.
   */
  modelVersion?: string;
};

/* ── request building ─────────────────────────────────────────────────── */

function buildContents(options: AskOptions) {
  const contents: { role: string; parts: { text: string }[] }[] = [];
  for (const turn of (options.history ?? []).slice(-(options.historyLimit ?? 6))) {
    if (!turn?.text) continue;
    contents.push({
      role: turn.role === "model" ? "model" : "user",
      // A long earlier answer must not eat the whole free-tier budget.
      parts: [{ text: turn.text.slice(0, 4000) }],
    });
  }
  contents.push({ role: "user", parts: [{ text: options.prompt }] });
  return contents;
}

/**
 * NOTHING HERE SETS `temperature` OR `topP`, AND THAT IS DELIBERATE.
 *
 * Google's Gemini 3 guide (re-read 2026-08-28) says: "For all Gemini 3 models,
 * we strongly recommend keeping the temperature parameter at its default value
 * of 1.0", and warns that going below 1.0 "may lead to unexpected behavior,
 * such as looping or degraded performance". All three models this library
 * offers are Gemini 3.
 *
 * This code used to send 0.2–0.7 on every path. Narrow sampling costs a
 * low-resource language the most: the model is least confident in Uyghur to
 * begin with, and clamping it to the safest token is what produced answers
 * that read plausibly word by word and did not hold together across sentences.
 * AI Studio sends the defaults, which is why the same model answered better
 * there. If determinism is ever wanted again it comes from the instruction
 * text, not from the sampler.
 */
function buildBody(options: AskOptions) {
  return {
    contents: buildContents(options),
    ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
    generationConfig: {
      ...thinkingConfigFor(!!options.deepThink),
      maxOutputTokens: options.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS,
    },
    safetySettings: SAFETY_SETTINGS,
  };
}

function endpoint(model: ModelId, streaming: boolean): string {
  const method = streaming ? "streamGenerateContent?alt=sse" : "generateContent";
  return `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:${method}`;
}

/**
 * The headers every call carries. The key rides in a header, never in the URL
 * — a URL ends up in history, in a referrer and in a devtools list, and this
 * one belongs to the reader. `cache: "no-store"` is set on the request itself
 * for the same reason the service worker ignores it: an answer to somebody's
 * question is not a cacheable asset.
 */
function requestInit(key: string, body: unknown, signal: AbortSignal): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
    // Nothing about this request is ours to authenticate.
    credentials: "omit",
    referrerPolicy: "no-referrer",
  };
}

/** Turn a non-OK response into an error carrying whatever Google explained. */
async function errorFromResponse(response: Response): Promise<GeminiError> {
  let detail = "";
  let retryDelayMs: number | null = null;
  try {
    const json = (await response.json()) as {
      error?: { message?: string; details?: { retryDelay?: string }[] };
    };
    detail = json.error?.message ?? "";
    for (const entry of json.error?.details ?? []) {
      const seconds = Number.parseFloat(String(entry?.retryDelay ?? ""));
      if (Number.isFinite(seconds) && seconds > 0) retryDelayMs = Math.round(seconds * 1000);
    }
  } catch {
    // A body that is not JSON tells us nothing extra; the status still does.
  }
  return new GeminiError(`HTTP ${response.status}${detail ? ` — ${scrubKey(detail)}` : ""}`, {
    status: response.status,
    retryDelayMs,
    notFound: response.status === 404,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch with the watchdog fetch does not have. The caller's own signal is
 * honoured too, so cancelling a question aborts the connection immediately.
 */
async function fetchWithTimeout(
  url: string,
  key: string,
  body: unknown,
  outerSignal: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  outerSignal.addEventListener("abort", onOuterAbort);
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, requestInit(key, body, controller.signal));
  } catch (error) {
    if (outerSignal.aborted) throw error;
    // An abort that was not the caller's is the watchdog firing. Reported as a
    // network-level failure (no HTTP status), which is what it is.
    throw new GeminiError(
      controller.signal.aborted
        ? TIMED_OUT
        : scrubKey(error instanceof Error ? error.message : "fetch failed"),
    );
  } finally {
    clearTimeout(timer);
    outerSignal.removeEventListener("abort", onOuterAbort);
  }
}

function textOf(json: GeminiResponse): string {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part.text ?? "").join("");
}

function stopReasonOf(json: GeminiResponse): string {
  return json.candidates?.[0]?.finishReason ?? json.promptFeedback?.blockReason ?? "";
}

/* ── one non-streaming call ───────────────────────────────────────────── */

/**
 * A single round trip on one key. Used by the connection test, and as the last
 * resort when a stream fails before producing any text at all.
 */
async function generateOnce(
  model: ModelId,
  key: string,
  body: unknown,
  signal: AbortSignal,
): Promise<GeminiResponse> {
  const response = await fetchWithTimeout(endpoint(model, false), key, body, signal);
  if (!response.ok) throw await errorFromResponse(response);
  return (await response.json()) as GeminiResponse;
}

/* ── which key to try, and in what order ──────────────────────────────── */

/**
 * The slot that last worked first, then the rest in the order the reader sees
 * them. Starting on a remembered slot is what stops a reader whose primary key
 * is permanently exhausted from paying a failed round trip before every answer.
 */
function orderedSlots(): { slot: number; key: string }[] {
  const slots = readKeySlots();
  const last = readLastGoodSlot();
  if (last === null) return slots;
  const head = slots.filter((entry) => entry.slot === last);
  return head.length ? [...head, ...slots.filter((entry) => entry.slot !== last)] : slots;
}

/** The slot currently serving requests — "right now", not a saved preference. */
let activeSlot: number | null = null;

export function getActiveSlot(): number | null {
  return activeSlot;
}

function markSlotGood(slot: number): void {
  activeSlot = slot;
  writeLastGoodSlot(slot);
}

/* ── the streaming call ───────────────────────────────────────────────── */

/**
 * Ask, and receive the answer as it is written.
 *
 *   onChunk(delta)                    each piece of text as it arrives
 *   onDone(fullText, model, usage, meta)  once, when the answer is complete
 *   onError(failure)                  once, when it is not
 *   onReset(textSoFar)                throw away what is on screen and start
 *                                     again — a mid-stream failure moved to
 *                                     the next key, and splicing two half
 *                                     answers together would be gibberish
 *
 * Returns { abort } so a reader can always stop a running answer. After abort
 * no callback fires again, which is what leaves no half-rendered answer behind.
 */
export function askStream(
  options: AskOptions,
  onChunk: (delta: string) => void,
  onDone: (fullText: string, model: ModelId, usage: GeminiUsage | null, meta: AskDoneMeta) => void,
  onError: (failure: AiFailure) => void,
  onReset: (textSoFar: string) => void = () => {},
): StreamHandle {
  const controller = new AbortController();
  let aborted = false;

  const abort = () => {
    aborted = true;
    controller.abort();
  };

  void (async () => {
    if (!readEnabled()) {
      onError({ ok: false, disabled: true, error: DISABLED_MESSAGE });
      return;
    }
    const slots = orderedSlots();
    if (!slots.length) {
      onError({ ok: false, noKey: true, error: NO_KEY_MESSAGE });
      return;
    }

    const model = readModel();
    const body = buildBody(options);

    let lastError: unknown = null;
    let emittedAny = false;
    let streamed = "";
    let attempts = 0;
    let paidOnlyFailures = 0;

    for (let index = 0; index < slots.length; index += 1) {
      const { slot, key } = slots[index];
      const isLastSlot = index === slots.length - 1;
      // Only the last key standing spends the retry budget. Earlier keys fail
      // over instead: a backup from a different project very often gets
      // straight through, and making the reader wait out a backoff first would
      // be slower than simply asking someone else.
      const tries = isLastSlot ? MAX_TRIES : 1;

      for (let attempt = 0; attempt < tries; attempt += 1) {
        if (aborted) return;
        streamed = "";
        try {
          const response = await fetchWithTimeout(endpoint(model, true), key, body, controller.signal);
          if (aborted) return;
          if (!response.ok) throw await errorFromResponse(response);
          if (!response.body) throw new GeminiError(NO_STREAM);

          const result = await readSseStream(response.body, controller.signal, (delta) => {
            streamed += delta;
            emittedAny = true;
            if (!aborted) onChunk(delta);
          });
          if (aborted) return;

          if (!streamed) {
            // A completed stream that said nothing: the finishReason is the
            // only explanation there is, and it is not a key problem.
            onError({ ok: false, error: emptyAnswerMessage(result.stopReason) });
            return;
          }

          markSlotGood(slot);
          bumpUsage({
            in: result.usage?.promptTokenCount ?? null,
            out: result.usage?.candidatesTokenCount ?? null,
          });
          // The finish reason travels with the answer even when there IS text:
          // an answer that ran into the ceiling stops mid-sentence, and
          // handing that over as finished is exactly the failure this carries.
          onDone(streamed, model, result.usage, {
            slot,
            stopReason: result.stopReason,
            modelVersion: result.modelVersion,
          });
          return;
        } catch (error) {
          if (aborted) return;
          lastError = error;
          attempts += 1;
          if (isPaidOnlyModelError(error)) paidOnlyFailures += 1;

          const transient = canFailOver(error);
          // A paid-only model can never succeed on THIS key no matter how long
          // we wait, so it skips the backoff — but a DIFFERENT key may have
          // billing, so it still fails over.
          const retryHere = transient && !isPaidOnlyModelError(error) && attempt < tries - 1;
          const failOver = transient && !isLastSlot;
          if (!retryHere && !failOver) break;

          // Text was already on screen when this died. Tell the caller to drop
          // it and let the answer start over cleanly rather than stitching two
          // different halves together.
          if (emittedAny) {
            emittedAny = false;
            streamed = "";
            onReset("");
          }
          if (retryHere) {
            await sleep(BACKOFF_MS[attempt] ?? 3000);
            continue;
          }
          break;
        }
      }

      if (aborted) return;
      // A failure no other key could fix stops the walk here.
      if (!canFailOver(lastError)) break;
    }

    if (aborted) return;

    // The last key died mid-answer with nothing left to try. One answer cut
    // short beats throwing away text the reader was already reading.
    if (emittedAny && streamed) {
      onDone(streamed, model, null, { slot: activeSlot ?? slots[slots.length - 1].slot, partial: true });
      return;
    }

    // Every configured key answered "this model has no free tier for you", so
    // the problem is the model, not the keys — say that instead of showing
    // four identical quota complaints.
    if (attempts > 0 && paidOnlyFailures === attempts) {
      onError({ ok: false, paidOnlyModel: true, model, error: paidOnlyMessage(model) });
      return;
    }

    // The response arrived with no readable stream at all — some proxies
    // strip streaming. One plain round trip on the SAME model is a fair last
    // try before giving up on the question.
    if (lastError instanceof GeminiError && lastError.message === NO_STREAM) {
      try {
        const json = await generateOnce(model, slots[0].key, body, controller.signal);
        if (aborted) return;
        const text = textOf(json).trim();
        if (text) {
          markSlotGood(slots[0].slot);
          bumpUsage({
            in: json.usageMetadata?.promptTokenCount ?? null,
            out: json.usageMetadata?.candidatesTokenCount ?? null,
          });
          onChunk(text);
          onDone(text, model, json.usageMetadata ?? null, {
            slot: slots[0].slot,
            stopReason: stopReasonOf(json),
            modelVersion: json.modelVersion,
          });
          return;
        }
      } catch (error) {
        if (aborted) return;
        lastError = error;
      }
    }

    if (aborted) return;
    onError(describeFailure(lastError, model));
  })();

  return { abort };
}

/**
 * Read Gemini's SSE frames off the wire.
 *
 * Frames are newline-delimited and a `data:` line carries one complete
 * response chunk, so only whole lines are parsed — a JSON object split across
 * two reads must never be half-read. The delta is NOT trimmed: each piece is a
 * fragment of one sentence, and trimming would glue words together.
 */
async function readSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onDelta: (delta: string) => void,
): Promise<{ usage: GeminiUsage | null; stopReason: string; modelVersion: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let usage: GeminiUsage | null = null;
  let stopReason = "";
  let modelVersion = "";

  /**
    * A stream that has gone silent is as stuck as one that never opened.
    * Cancelling makes the next read report "done", which would otherwise look
    * exactly like a model that finished with nothing to say — so the fact that
    * the watchdog fired is recorded and thrown, which fails over to the next
    * key instead of blaming the model for an empty answer.
    */
  let timedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      void reader.cancel();
    }, REQUEST_TIMEOUT_MS);
  };

  try {
    resetIdleTimer();
    for (;;) {
      if (signal.aborted) {
        await reader.cancel();
        return { usage, stopReason, modelVersion };
      }
      const { done, value } = await reader.read();
      if (done) break;
      resetIdleTimer();
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "").trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        // Comments are keepalives; anything that is not a data frame is noise.
        if (!line || line.startsWith(":") || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let json: GeminiResponse;
        try {
          json = JSON.parse(payload) as GeminiResponse;
        } catch {
          continue;
        }
        const delta = textOf(json);
        if (delta) onDelta(delta);
        if (json.usageMetadata) usage = json.usageMetadata;
        const reason = stopReasonOf(json);
        if (reason) stopReason = reason;
        if (json.modelVersion) modelVersion = json.modelVersion;
      }
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    reader.releaseLock();
  }

  if (timedOut) throw new GeminiError(TIMED_OUT);
  return { usage, stopReason, modelVersion };
}

/**
 * The free-form chat, in the desktop's shape (ai.js chatStream).
 *
 * NOT a second transport: it builds AskOptions and hands them to askStream
 * above, so failover, the watchdogs, strict model selection and the Uyghur
 * errors are all the same code. What differs is the input — a thread of turns
 * rather than one framed question — and the system instruction, which is the
 * chatbot's rather than the library's per-content-type framing.
 */
export function chatStream(
  messages: readonly { role: "user" | "model"; text: string }[],
  onChunk: (delta: string) => void,
  onDone: (fullText: string, model: ModelId, usage: GeminiUsage | null, meta: AskDoneMeta) => void,
  onError: (failure: AiFailure) => void,
  onReset: (textSoFar: string) => void = () => {},
  /**
   * The unfinished answer to carry on from, when the last reply stopped at the
   * output ceiling. `messages` then ends with the QUESTION it answered, and
   * the whole tail is put in the prompt rather than in the history — a history
   * turn is capped at 4,000 characters from its start, which would point the
   * model at the wrong place in a long answer.
   */
  continueFrom = "",
): StreamHandle {
  const turns = messages.filter((turn) => turn?.text?.trim());
  const last = turns[turns.length - 1];
  if (!last) {
    onError({ ok: false, error: "سوئال يوق." });
    return { abort: () => {} };
  }
  return askStream(
    {
      prompt: continueFrom ? buildContinuePrompt(last.text, continueFrom) : last.text,
      system: CHAT_SYSTEM,
      history: turns.slice(0, -1),
      historyLimit: 20,
    },
    onChunk,
    onDone,
    onError,
    onReset,
  );
}

/* ── testing one key ──────────────────────────────────────────────────── */

export type KeyProbeStatus =
  | "none"
  | "valid"
  | "invalid"
  | "quota"
  | "paid_only"
  | "model_gone"
  | "busy"
  | "offline"
  | "empty"
  | "error";

export type KeyProbe = {
  slot: number;
  status: KeyProbeStatus;
  /** Is the KEY itself good? Quota and paid-only both mean "yes, but…". */
  keyOk: boolean;
  message: string;
  model: ModelId;
};

/**
 * «باغلىنىشنى سىناش» for one slot.
 *
 * The question this answers is "is this KEY good?", so an exhausted quota, an
 * overloaded model and a paid-only model all still count as a working key —
 * each with its own explanation, because the reader's next step differs in
 * every case. It probes the CURRENTLY SELECTED model only: a tick here means
 * this model works, not that some other model answered in its place.
 */
export async function probeKey(slot: number, key: string): Promise<KeyProbe> {
  const model = readModel();
  const trimmed = key.trim();
  if (!trimmed) {
    return { slot, status: "none", keyOk: false, message: "بۇ ئورۇندا ئاچقۇچ يوق.", model };
  }

  const controller = new AbortController();
  // Built exactly like a real request — same sampling defaults, same thinking
  // default, same budget. A probe configured differently from the thing it is
  // testing would report a tick for a path the reader never takes.
  const body = buildBody({ prompt: "سالام دەپ بىر ئېغىز جاۋاب بەر." });

  try {
    const json = await generateOnce(model, trimmed, body, controller.signal);
    const text = textOf(json).trim();
    if (text) {
      return { slot, status: "valid", keyOk: true, message: "ئىشلەۋاتىدۇ ✓", model };
    }
    return {
      slot,
      status: "empty",
      keyOk: true,
      message: emptyAnswerMessage(stopReasonOf(json)),
      model,
    };
  } catch (error) {
    // Order matters: a paid-only model reports as a 429, and a dead key can
    // report as a 400 that also mentions the model.
    if (isPaidOnlyModelError(error)) {
      return {
        slot,
        status: "paid_only",
        keyOk: true,
        message: `ئاچقۇچ توغرا — ئەمما «${model}» پۇللۇق مودېل، بۇ ئاچقۇچتا billing يوق.`,
        model,
      };
    }
    const failure = describeFailure(error, model);
    if (failure.keyInvalid) return { slot, status: "invalid", keyOk: false, message: failure.error, model };
    if (failure.modelUnavailable) {
      return { slot, status: "model_gone", keyOk: true, message: failure.error, model };
    }
    if (failure.busy) {
      return {
        slot,
        status: "busy",
        keyOk: true,
        message: `ئاچقۇچ توغرا — «${model}» مودېلى ھازىر ئالدىراش. بىردەمدىن كېيىن سىناڭ.`,
        model,
      };
    }
    if (failure.quotaExhausted) {
      const seconds = retryDelayMsOf(error);
      const wait = seconds ? ` (${Math.ceil(seconds / 1000)} سېكۇنتتىن كېيىن سىناڭ)` : "";
      return {
        slot,
        status: "quota",
        keyOk: true,
        message: `ئاچقۇچ توغرا — ئەمما ھەققى ھازىرچە توشۇپ تۇرۇپتۇ.${wait}`,
        model,
      };
    }
    if (failure.offline) return { slot, status: "offline", keyOk: false, message: failure.error, model };
    return { slot, status: "error", keyOk: false, message: failure.error, model };
  }
}
