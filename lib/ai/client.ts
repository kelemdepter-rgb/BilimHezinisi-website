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
 * Gemini 3.x thinking control. `thinkingBudget: 0` is rejected outright by
 * gemini-3.5-flash-lite and gemini-3.1-pro-preview ("This model only works in
 * thinking mode"); `thinkingLevel` is accepted by all three models we offer.
 * Thinking tokens are billed as output AND drawn from maxOutputTokens, which
 * is why the budget below carries headroom.
 */
function thinkingConfigFor(deep: boolean) {
  return { thinkingLevel: deep ? "high" : "low" };
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
  /** Prior turns, oldest first. Only the last six are sent. */
  history?: readonly { role: "user" | "model"; text: string }[];
  temperature?: number;
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
};

/* ── request building ─────────────────────────────────────────────────── */

function buildContents(options: AskOptions) {
  const contents: { role: string; parts: { text: string }[] }[] = [];
  for (const turn of (options.history ?? []).slice(-6)) {
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

function buildBody(options: AskOptions) {
  return {
    contents: buildContents(options),
    ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
    generationConfig: {
      temperature: options.temperature ?? 0.4,
      topP: 0.9,
      thinkingConfig: thinkingConfigFor(!!options.deepThink),
      maxOutputTokens: options.maxOutputTokens ?? 4096,
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
          onDone(streamed, model, result.usage, { slot });
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
          onDone(text, model, json.usageMetadata ?? null, { slot: slots[0].slot });
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
): Promise<{ usage: GeminiUsage | null; stopReason: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let usage: GeminiUsage | null = null;
  let stopReason = "";

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
        return { usage, stopReason };
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
      }
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    reader.releaseLock();
  }

  if (timedOut) throw new GeminiError(TIMED_OUT);
  return { usage, stopReason };
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
  const body = buildBody({
    prompt: "سالام دەپ بىر ئېغىز جاۋاب بەر.",
    temperature: 0.2,
    // Thinking tokens come out of this budget, so a probe sized for the
    // one-word answer alone would come back empty on a thinking model.
    maxOutputTokens: 1024,
  });

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
