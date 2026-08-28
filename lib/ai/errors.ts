/**
 * Telling Gemini's failures apart, and saying what happened in Uyghur.
 *
 * Ported from the desktop's ai.js, where each of these was learned from a real
 * failure. Two distinctions carry the most weight:
 *
 *   - A quota error (429) that says `limit: 0` is NOT a quota error. It means
 *     the chosen model has no free tier and this key has no billing. Waiting
 *     will never fix it, and the same key answers fine on a free model — so it
 *     gets its own named message instead of a generic "you ran out".
 *   - A 503 means the key is VALID and the model was busy. Blaming the key
 *     there sends a reader off to regenerate a key that was never the problem.
 *
 * A raw English API string is never shown to a reader.
 */

import { URL_BILLING, SELECTABLE_MODELS, isPaidOnlyModel } from "./models";

/** An HTTP failure carrying whatever Google told us about it. */
export class GeminiError extends Error {
  /** HTTP status, or null when the request never reached Google at all. */
  readonly status: number | null;
  /** RetryInfo.retryDelay from a 429, in ms, when Google sent one. */
  readonly retryDelayMs: number | null;
  /** A 404 on the model name: no other key can fix it. */
  readonly notFound: boolean;

  constructor(
    message: string,
    options: { status?: number | null; retryDelayMs?: number | null; notFound?: boolean } = {},
  ) {
    super(message);
    this.name = "GeminiError";
    this.status = options.status ?? null;
    this.retryDelayMs = options.retryDelayMs ?? null;
    this.notFound = options.notFound ?? false;
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

function statusOf(error: unknown): number | null {
  return error instanceof GeminiError ? error.status : null;
}

export function retryDelayMsOf(error: unknown): number | null {
  return error instanceof GeminiError ? error.retryDelayMs : null;
}

/**
 * Strip anything key-shaped out of a string before it is shown or stored.
 * Google's suspended-consumer errors echo the key back at us, and that string
 * must not reach the screen — the reader's key is not decoration.
 */
export function scrubKey(text: string): string {
  return text
    .replace(/api_key:[A-Za-z0-9._-]+/g, "api_key:••••")
    .replace(/AIza[A-Za-z0-9_-]{10,}/g, "AIza••••")
    .replace(/AQ\.[A-Za-z0-9._-]{10,}/g, "AQ.••••");
}

/* ── classification ───────────────────────────────────────────────────── */

export function isQuotaError(error: unknown): boolean {
  return (
    statusOf(error) === 429 ||
    /\b429\b|quota|resource has been exhausted|rate.?limit/i.test(messageOf(error))
  );
}

/**
 * The chosen MODEL has no free tier and THIS key has no billing. Google
 * reports it as a 429 whose quota metric reads `limit: 0` — verified against
 * gemini-3.1-pro-preview on a non-billing key. A DIFFERENT key can fix it (one
 * with billing), so failover still walks the slots; only when every slot
 * answers this way is it the model's fault rather than the keys'.
 */
export function isPaidOnlyModelError(error: unknown): boolean {
  if (!isQuotaError(error)) return false;
  const message = messageOf(error);
  return /limit:\s*0\b/.test(message) || /free[_ ]quota[_ ]tier/i.test(message);
}

/** Momentarily overloaded (503/500) — auth succeeded, so the key is fine. */
export function isServerBusyError(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 503 || status === 500) return true;
  return /\bHTTP 50[03]\b|UNAVAILABLE|overloaded|high demand/i.test(messageOf(error));
}

/**
 * THIS key is dead — invalid, expired, revoked, or its Google Cloud project
 * suspended. Checked before the model checks, which otherwise swallow the
 * 400/403 these arrive with.
 */
export function isKeyInvalidError(error: unknown): boolean {
  const message = messageOf(error);
  if (
    /API[ _]?key[ _]?not[ _]?valid|API_KEY_INVALID|API[ _]?key[ _]?(?:expired|invalid)|expired[^.]{0,40}API[ _]?key|CONSUMER_SUSPENDED|CONSUMER_INVALID|consumer[^.]{0,60}(?:suspended|invalid)|has been suspended|SERVICE_DISABLED|has not been used in project|API[ _]?key[^.]{0,40}(?:revoked|deleted|disabled)/i.test(
      message,
    )
  ) {
    return true;
  }
  return (statusOf(error) === 400 || /\bHTTP 400\b/.test(message)) && /API key/i.test(message);
}

/**
 * The SELECTED model is unavailable to this key: retired ID (404), permission
 * or billing gate (403), or paid-only on a free key. Strict model selection
 * turns every one of these into "pick another model yourself" — never a
 * substitution.
 */
export function isModelUnavailableError(error: unknown): boolean {
  if (isKeyInvalidError(error)) return false;
  if (error instanceof GeminiError && error.notFound) return true;
  const status = statusOf(error);
  if (status === 403 || status === 404) return true;
  const message = messageOf(error);
  if (/\bHTTP 40[34]\b/.test(message)) return true;
  if (
    /PERMISSION_DENIED|permission denied|is not found|was not found|not supported|doesn'?t have access|does not have access/i.test(
      message,
    )
  ) {
    return true;
  }
  return /free quota tier|limit:\s*0\b/i.test(message);
}

/** Rejected on input size. No key can fix it, so it never triggers failover. */
export function isSizeError(error: unknown): boolean {
  const message = messageOf(error);
  if (
    /exceeds the maximum number of tokens|maximum input|input token|request payload size|too large|content too long|exceeds the limit/i.test(
      message,
    )
  ) {
    return true;
  }
  return /INVALID_ARGUMENT/i.test(message) && /token|size|large|payload|long/i.test(message);
}

/** Never reached Google at all: offline, DNS, or the watchdog fired. */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof GeminiError && error.notFound) return false;
  return statusOf(error) === null;
}

/**
 * Could a DIFFERENT key plausibly fix this? Quota, an overloaded model, a dead
 * key, or a network-level failure — yes. A missing model, a size rejection or
 * any other 4xx is identical for every key, so those stop the loop.
 */
export function canFailOver(error: unknown): boolean {
  if (error instanceof GeminiError && error.notFound) return false;
  if (isSizeError(error)) return false;
  if (isPaidOnlyModelError(error)) return true;
  return (
    isQuotaError(error) ||
    isServerBusyError(error) ||
    isKeyInvalidError(error) ||
    statusOf(error) === null
  );
}

/* ── what the reader is told ──────────────────────────────────────────── */

export const NETWORK_MESSAGE =
  "ئىنتېرنېتقا باغلىنالمىدى. سۈنئىي ئىدراك ئىنتېرنېت تەلەپ قىلىدۇ؛ كىتاب ئوقۇش، ئىزدەش، خەتكۈچ ۋە قۇرئان بۆلىكى ئىنتېرنېتسىزمۇ نورمال ئىشلەيدۇ.";

export const SAFETY_MESSAGE =
  "Google نىڭ بىخەتەرلىك سۈزگۈچى بۇ مەزمۇنغا جاۋاب بېرىشنى رەت قىلدى. سوئالنى باشقىچە يېزىپ سىناڭ.";

export const SERVER_BUSY_MESSAGE =
  "مودېل ھازىر ئالدىراش (بەك كۆپ تەلەپ بار). بىردەمدىن كېيىن قايتا سىناڭ ياكى زاپاس ئاچقۇچ قوشۇڭ.";

export const KEY_INVALID_MESSAGE =
  "Gemini API ئاچقۇچى ئىناۋەتسىز ياكى ۋاقتى ئۆتكەن. تەڭشەكتىن ئاچقۇچلىرىڭىزنى تەكشۈرۈپ يېڭىلاڭ.";

export const NO_KEY_MESSAGE =
  "Gemini API ئاچقۇچى تېخى قوشۇلمىغان. تۆۋەندىكى «ئاساسىي ئاچقۇچ» رامكىسىغا ئۆز ئاچقۇچىڭىزنى چاپلاڭ.";

export const DISABLED_MESSAGE =
  "سۈنئىي ئىدراك ئېتىك تۇرۇپتۇ. يۇقىرىدىكى كۇنۇپكىنى بېسىپ ئاچسىڭىز ئىشلەيدۇ.";

export const SIZE_MESSAGE =
  "ئەۋەتىلگەن تېكىست بەك ئۇزۇن بولۇپ، Google قوبۇل قىلمىدى. قىسقىراق بۆلەككە بۆلۈپ سىناڭ.";

/**
 * A retired or mistyped model ID, or a permission gate. Names the exact model
 * so the reader knows which choice failed, and says outright that nothing was
 * switched behind their back.
 */
export function modelUnavailableMessage(model: string): string {
  return `«${model}» مودېلى ئىشلىمىدى. بۇ مودېلنىڭ ID سى ئۆزگەرگەن ياكى Google ئۇنى توختاتقان بولۇشى مۇمكىن. باشقا مودېل تاللاڭ. (مودېلىڭىز ئۆزلۈكىدىن ئالماشتۇرۇلمىدى.)`;
}

/**
 * The chosen model is paid-only and no configured key has billing. Names the
 * model, gives both ways out, and states that the model was NOT changed —
 * because it was not, and a reader who has been silently downgraded elsewhere
 * has no reason to believe us unless we say so.
 */
export function paidOnlyMessage(model: string): string {
  const free = SELECTABLE_MODELS.filter((id) => !isPaidOnlyModel(id)).join(" / ");
  return (
    `«${model}» — پۇللۇق مودېل. ھەقسىز Gemini ئاچقۇچى بۇ مودېلنى ئىشلىتەلمەيدۇ ` +
    `(Google بۇ مودېلنىڭ ھەقسىز ھەققىنى 0 قىلىپ بەلگىلىگەن). ئىككى يولى بار: ` +
    `① ھەقسىز مودېللاردىن بىرىنى تاللاڭ (${free})؛ ` +
    `② ياكى Google ھېساباتىڭىزدا billing نى ئېچىڭ: ${URL_BILLING} . ` +
    `تاللىغان مودېلىڭىز ئۆزلۈكىدىن ئۆزگەرتىلمىدى.`
  );
}

/**
 * 429 on every key. Google reports how long to wait; show THAT rather than a
 * free-tier number we have not verified and that changes without notice.
 */
export function quotaAllMessage(retryMs?: number | null): string {
  const seconds = retryMs && retryMs > 0 ? Math.ceil(retryMs / 1000) : 0;
  const wait = seconds
    ? ` Google ${seconds >= 90 ? `${Math.ceil(seconds / 60)} مىنۇت` : `${seconds} سېكۇنت`} كۈتۈڭ دەۋاتىدۇ.`
    : "";
  return `ھەقسىز ئىشلىتىش ھەققىڭىز توشۇپ قالدى.${wait} بىردەمدىن كېيىن قايتا سىناڭ ياكى باشقا بىر project دىن زاپاس ئاچقۇچ قوشۇڭ.`;
}

/**
 * The call succeeded and came back with no text. The finishReason is the only
 * clue there is, so turn each known one into something actionable instead of
 * printing the raw token at the reader.
 */
export function emptyAnswerMessage(reason?: string | null): string {
  const code = String(reason ?? "").toUpperCase();
  if (/SAFETY|BLOCKLIST|PROHIBITED|BLOCKED|IMAGE_SAFETY/.test(code)) return SAFETY_MESSAGE;
  if (/RECITATION/.test(code)) {
    return "جاۋاب Google نىڭ نەقىل چەكلىمىسىگە ئۇچرىدى. سوئالنى ئازراق ئۆزگەرتىپ قايتا سىناڭ.";
  }
  if (/MAX_TOKENS/.test(code)) {
    return "جاۋاب بەك ئۇزۇن بولۇپ كېتىپ توختاپ قالدى. سوئالنى كىچىكرەك بۆلەكلەرگە بۆلۈپ سىناڭ.";
  }
  return `جاۋاب چىقمىدى (سەۋەب: ${reason || "نامەلۇم"}). قايتا سىناڭ.`;
}

/* ── an answer that arrived, but not all of it ────────────────────────── */

/**
 * A finished stream is not the same thing as a finished answer.
 *
 * Gemini reports why it stopped in `finishReason`, and only `STOP` means "I
 * said everything I had to say". An answer that hit the output ceiling stops
 * mid-sentence and used to be handed to the reader as though it were
 * complete — which reads exactly like the "sentences that do not connect"
 * this whole change is about. So every non-STOP ending is named, and the
 * reader is told whether there is a way forward.
 *
 * An empty reason is treated as complete on purpose: Google always sends one
 * on the last chunk, and inventing a warning out of its absence would cry
 * wolf on every answer the day the field moves.
 */
export type AnswerCut = {
  /** What the panel shows, under the answer and visibly apart from it. */
  notice: string;
  /** Would «داۋاملاشتۇرۇش» plausibly pick up where this stopped? */
  canContinue: boolean;
};

export const CONTINUE_LABEL = "داۋاملاشتۇرۇش";

export function describeCutAnswer(meta: {
  stopReason?: string | null;
  partial?: boolean;
}): AnswerCut | null {
  const code = String(meta.stopReason ?? "").toUpperCase();

  // The last key died mid-answer with nothing left to fail over to. The text
  // on screen is real, and it is not all of it.
  if (meta.partial) {
    return {
      notice:
        "باغلىنىش ئۈزۈلۈپ قېلىپ جاۋاب ئوتتۇرىدا توختاپ قالدى — بۇ تولۇق جاۋاب ئەمەس.",
      canContinue: true,
    };
  }

  if (!code || code === "STOP" || code === "FINISH_REASON_STOP") return null;

  if (/MAX_TOKENS/.test(code)) {
    return {
      notice:
        "جاۋاب ئۇزۇنلۇق چېكىگە يېتىپ ئوتتۇرىدا توختاپ قالدى — بۇ تولۇق جاۋاب ئەمەس. «داۋاملاشتۇرۇش» نى بېسىپ قالغىنىنى داۋاملاشتۇرالايسىز.",
      canContinue: true,
    };
  }
  if (/SAFETY|BLOCKLIST|PROHIBITED|BLOCKED|SPII|IMAGE_SAFETY/.test(code)) {
    return {
      notice:
        "Google نىڭ بىخەتەرلىك سۈزگۈچى جاۋابنى ئوتتۇرىدا توختاتتى — بۇ تولۇق جاۋاب ئەمەس. سوئالنى باشقىچە يېزىپ سىناڭ.",
      // Continuing would stop at the same place for the same reason.
      canContinue: false,
    };
  }
  if (/RECITATION/.test(code)) {
    return {
      notice:
        "جاۋاب Google نىڭ نەقىل چەكلىمىسىگە ئۇچراپ ئوتتۇرىدا توختىدى — بۇ تولۇق جاۋاب ئەمەس. سوئالنى ئازراق ئۆزگەرتىپ قايتا سىناڭ.",
      canContinue: false,
    };
  }
  return {
    notice: `جاۋاب ئوتتۇرىدا توختاپ قالدى (سەۋەب: ${meta.stopReason}) — بۇ تولۇق جاۋاب ئەمەس.`,
    canContinue: true,
  };
}

/** What a failed request hands back to the UI. */
export type AiFailure = {
  ok: false;
  error: string;
  /** No key configured at all. */
  noKey?: boolean;
  /** AI is switched off in this browser. */
  disabled?: boolean;
  /** Every configured key is out of quota. */
  quotaExhausted?: boolean;
  /** Every configured key is dead. */
  keyInvalid?: boolean;
  /** The model needs billing and no configured key has it. */
  paidOnlyModel?: boolean;
  /** The model itself is gone or forbidden. */
  modelUnavailable?: boolean;
  /** Google is overloaded right now. */
  busy?: boolean;
  /** Nothing reached Google. */
  offline?: boolean;
  /** The request body was too big. */
  tooLarge?: boolean;
  /** Which model was asked for, when the failure is about the model. */
  model?: string;
};

/**
 * One place that turns a thrown error into the message a reader sees, in the
 * order the checks have to happen: a paid-only 429 must be caught before the
 * quota check, and a dead key before the model checks.
 */
export function describeFailure(error: unknown, model: string): AiFailure {
  if (isPaidOnlyModelError(error)) {
    return { ok: false, paidOnlyModel: true, model, error: paidOnlyMessage(model) };
  }
  if (isSizeError(error)) return { ok: false, tooLarge: true, error: SIZE_MESSAGE };
  if (isKeyInvalidError(error)) return { ok: false, keyInvalid: true, error: KEY_INVALID_MESSAGE };
  if (isModelUnavailableError(error)) {
    return { ok: false, modelUnavailable: true, model, error: modelUnavailableMessage(model) };
  }
  if (isServerBusyError(error)) return { ok: false, busy: true, error: SERVER_BUSY_MESSAGE };
  if (isQuotaError(error)) {
    return { ok: false, quotaExhausted: true, error: quotaAllMessage(retryDelayMsOf(error)) };
  }
  if (isNetworkError(error)) return { ok: false, offline: true, error: NETWORK_MESSAGE };
  return { ok: false, error: `سوراش مەغلۇپ بولدى: ${scrubKey(messageOf(error)) || "نامەلۇم خاتالىق"}` };
}

