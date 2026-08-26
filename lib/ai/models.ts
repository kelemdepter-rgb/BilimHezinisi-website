/**
 * The three Gemini models this library offers, and the pages Google keeps the
 * facts on.
 *
 * Verified on 2026-08-26 against Google's own model list and pricing page:
 * all three IDs still resolve, the two Flash tiers are free of charge, and
 * gemini-3.1-pro-preview reads "Not available" in the free-tier column. The
 * desktop app reached the same verdict on 2026-08-20 by calling each model
 * with a real key, which is the stronger test — a free key gets a 429 whose
 * quota metric says `limit: 0` for the Pro model and answers fine for the
 * other two.
 *
 * Model IDs move. When one stops resolving, change it HERE — this file is the
 * single source for the picker, the transport and the tests.
 */

/** The endpoint the reader's own browser calls. Kept in step with GEMINI_ORIGIN
 *  in lib/security/csp.ts by tests/unit/ai-csp-parity.test.ts. */
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const SELECTABLE_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-pro-preview",
] as const;

export type ModelId = (typeof SELECTABLE_MODELS)[number];

export const DEFAULT_MODEL: ModelId = "gemini-3.7-flash";

/**
 * Models Google sells only on the paid tier. A key without billing gets a 429
 * whose quota metric is `*_free_tier_*` with `limit: 0` — it looks like a
 * quota error and is not one, which is why it earns its own message.
 */
export const PAID_ONLY_MODELS: readonly ModelId[] = ["gemini-3.1-pro-preview"];

/**
 * The short Uyghur line under each model, ported from the desktop's
 * MODEL_INFO. No price figures on purpose: Google changes them, so the screen
 * links to the pricing page instead of going stale.
 */
export const MODEL_INFO: Record<ModelId, string> = {
  "gemini-3.7-flash": "تەۋسىيە · ئۈنۈمى ياخشى · سۈرئىتى تېز · (ھەقسىز)",
  "gemini-3.5-flash-lite": "ئۈنۈمى ئادەتتىكىدەك · سۈرئىتى ئەڭ تېز · ئىنتايىن ئەرزان · (ھەقسىز)",
  "gemini-3.1-pro-preview": "ئۈنۈمى ناھايىتى سۈپەتلىك · سۈرئىتى ئاستا · (پۇللۇق · سېتىۋېلىشىڭىز كېرەك)",
};

/** Google's own pages — linked, never copied, because they change. */
export const URL_PRICING = "https://ai.google.dev/pricing";
export const URL_BILLING = "https://ai.google.dev/gemini-api/docs/billing";
export const URL_TERMS = "https://ai.google.dev/gemini-api/terms";
export const URL_GET_KEY = "https://aistudio.google.com/apikey";

export function isPaidOnlyModel(model: string): boolean {
  return PAID_ONLY_MODELS.includes(model.trim() as ModelId);
}

export function isSelectableModel(value: unknown): value is ModelId {
  return typeof value === "string" && SELECTABLE_MODELS.includes(value as ModelId);
}

/**
 * The word that goes on the badge. A native <select> renders the selected
 * option's own text in the closed control, so putting this in the option
 * label is what makes the free/paid status visible both closed and open — a
 * reader must never discover a model is paid only by hitting an error.
 */
export function feeBadge(model: ModelId): "ھەقسىز" | "پۇللۇق" {
  return isPaidOnlyModel(model) ? "پۇللۇق" : "ھەقسىز";
}

/** What one row of the picker says: `gemini-3.7-flash — ھەقسىز`. */
export function modelOptionLabel(model: ModelId): string {
  return `${model} — ${feeBadge(model)}`;
}
