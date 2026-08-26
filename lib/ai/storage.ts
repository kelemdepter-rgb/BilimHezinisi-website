/**
 * Everything the AI layer remembers, kept in the reader's own browser.
 *
 * There is no table behind this file and no request that carries any of it.
 * The reader's Gemini key is theirs: it is written to localStorage on their
 * device, read back only to build a request that goes straight to Google, and
 * erased completely by clearAiState(). Our server never sees it, which is
 * exactly why the owner pays nothing and holds nobody else's secret.
 *
 * WHY THIS IS NOT NAMESPACED BY USER ID: two accounts sharing one browser
 * would still share one localStorage — anything that can run script on this
 * origin can read all of it, whoever happens to be signed in. Namespacing
 * would look like a protection without being one, so instead the screen says
 * plainly that a shared or public computer is a bad place to keep a key, and
 * offers one button that erases everything.
 *
 * Every read and write is wrapped: a private window, a browser set to block
 * site data, and a full quota all throw here, and none of them may break a
 * settings page.
 */

import { DEFAULT_MODEL, isSelectableModel, type ModelId } from "./models";

/** Primary plus three backups, matching the desktop's four slots. */
export const KEY_SLOT_COUNT = 4;

const STORAGE_KEYS = {
  enabled: "bh-ai-enabled",
  keys: "bh-ai-keys",
  model: "bh-ai-model",
  lastGoodSlot: "bh-ai-last-good-slot",
  usage: "bh-ai-usage",
} as const;

/** Everything this module may ever write, so "erase it all" can be exhaustive. */
export const AI_STORAGE_KEYS: readonly string[] = Object.values(STORAGE_KEYS);

export type AiUsage = {
  /** Local calendar day, YYYY-MM-DD — usage is shown as "today". */
  day: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
};

/**
 * Anything that changes AI state tells the screen about it.
 *
 * Three components read this store — the switch, the key slots and the ask
 * box — and all three can write to it, including from inside a running
 * request when a failover records which key worked. A version counter that
 * every write bumps is what lets them all read through useSyncExternalStore
 * instead of each keeping its own stale copy.
 */
const listeners = new Set<() => void>();
let version = 0;

export function subscribeToAiState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAiStateVersion(): number {
  return version;
}

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    store()?.setItem(key, value);
  } catch {
    // Storage full or blocked: the setting simply does not persist. Nothing
    // kept here is worth interrupting the reader over.
  }
}

function remove(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    // Same as above.
  }
}

/* ── keys ─────────────────────────────────────────────────────────────── */

/**
 * Light obfuscation at rest, ported from the desktop.
 *
 * This is NOT encryption and is never presented as any: nothing running in a
 * browser can keep a secret from whoever controls that browser. It exists so
 * a key does not sit in plain sight in a devtools panel someone glances at
 * over a shoulder. The screen tells the reader exactly this, in Uyghur.
 */
const OBFUSCATION_PREFIX = "obf1:";
const OBFUSCATION_SECRET = "BilimHezinisi/web/ai";

function xorWithSecret(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    out += String.fromCharCode(
      input.charCodeAt(i) ^ OBFUSCATION_SECRET.charCodeAt(i % OBFUSCATION_SECRET.length),
    );
  }
  return out;
}

export function obfuscateKey(plain: string): string {
  try {
    return OBFUSCATION_PREFIX + btoa(xorWithSecret(plain));
  } catch {
    return plain;
  }
}

export function deobfuscateKey(stored: string): string {
  if (!stored.startsWith(OBFUSCATION_PREFIX)) return stored;
  try {
    return xorWithSecret(atob(stored.slice(OBFUSCATION_PREFIX.length)));
  } catch {
    return "";
  }
}

/** All four slots, "" where empty. Index 0 is the primary key. */
export function readKeys(): string[] {
  const slots = new Array<string>(KEY_SLOT_COUNT).fill("");
  const raw = read(STORAGE_KEYS.keys);
  if (!raw) return slots;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return slots;
    for (let i = 0; i < KEY_SLOT_COUNT; i += 1) {
      const value: unknown = parsed[i];
      if (typeof value === "string" && value) slots[i] = deobfuscateKey(value).trim();
    }
  } catch {
    // Corrupt value — read it as "no keys" rather than throw on a page load.
  }
  return slots;
}

/**
 * Save the slots. `null` means "leave this one alone", which is what the form
 * sends for a field the reader did not retype — re-saving must never wipe a
 * key they cannot see. An empty string clears that slot deliberately.
 */
export function writeKeys(next: readonly (string | null | undefined)[]): void {
  const current = readKeys();
  const merged: string[] = [];
  for (let i = 0; i < KEY_SLOT_COUNT; i += 1) {
    const incoming = next[i];
    const value = incoming === null || incoming === undefined ? current[i] : incoming.trim();
    merged.push(value ? obfuscateKey(value) : "");
  }
  write(STORAGE_KEYS.keys, JSON.stringify(merged));
  // The keys just changed, so "the slot that last worked" may now hold a
  // different key. Drop the hint rather than start a request on a stale one.
  remove(STORAGE_KEYS.lastGoodSlot);
  notify();
}

/** Slots that actually hold a usable key, in slot order, de-duplicated. */
export function readKeySlots(): { slot: number; key: string }[] {
  const seen = new Set<string>();
  const out: { slot: number; key: string }[] = [];
  readKeys().forEach((key, slot) => {
    if (key.length > 8 && !seen.has(key)) {
      seen.add(key);
      out.push({ slot, key });
    }
  });
  return out;
}

export function hasAnyKey(): boolean {
  return readKeySlots().length > 0;
}

/** The only form of a key that is ever rendered back: first four, last four. */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/* ── on/off ───────────────────────────────────────────────────────────── */

/**
 * Off for everyone, forever, until they turn it on. Reading, searching and
 * every other part of the library behaves identically either way, so there is
 * nothing here to nudge anyone towards.
 */
export function readEnabled(): boolean {
  return read(STORAGE_KEYS.enabled) === "1";
}

export function writeEnabled(on: boolean): void {
  write(STORAGE_KEYS.enabled, on ? "1" : "0");
  notify();
}

/* ── model ────────────────────────────────────────────────────────────── */

export function readModel(): ModelId {
  const stored = read(STORAGE_KEYS.model);
  return isSelectableModel(stored) ? stored : DEFAULT_MODEL;
}

export function writeModel(model: ModelId): void {
  write(STORAGE_KEYS.model, model);
  notify();
}

/* ── which key last worked ────────────────────────────────────────────── */

/**
 * Remembered so a reader whose first key is permanently exhausted does not
 * pay a failed round trip before every single answer.
 */
export function readLastGoodSlot(): number | null {
  const parsed = Number.parseInt(read(STORAGE_KEYS.lastGoodSlot) ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < KEY_SLOT_COUNT ? parsed : null;
}

export function writeLastGoodSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= KEY_SLOT_COUNT) return;
  // Every answered request lands here; only a real change is worth a write and
  // a re-render.
  if (readLastGoodSlot() === slot) return;
  write(STORAGE_KEYS.lastGoodSlot, String(slot));
  notify();
}

/* ── usage ────────────────────────────────────────────────────────────── */

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function emptyUsage(): AiUsage {
  return { day: today(), requests: 0, tokensIn: 0, tokensOut: 0 };
}

/** Today's counters. A stored day that is not today reads as a fresh zero. */
export function readUsage(): AiUsage {
  const raw = read(STORAGE_KEYS.usage);
  if (!raw) return emptyUsage();
  try {
    const parsed = JSON.parse(raw) as Partial<AiUsage>;
    if (parsed.day !== today()) return emptyUsage();
    return {
      day: parsed.day,
      requests: Number(parsed.requests) || 0,
      tokensIn: Number(parsed.tokensIn) || 0,
      tokensOut: Number(parsed.tokensOut) || 0,
    };
  } catch {
    return emptyUsage();
  }
}

/**
 * Count one answered request. Token counts are added only when Google reports
 * them — an invented number would be worse than none at all.
 */
export function bumpUsage(tokens?: { in?: number | null; out?: number | null }): AiUsage {
  const current = readUsage();
  const next: AiUsage = {
    day: current.day,
    requests: current.requests + 1,
    tokensIn: current.tokensIn + (Number(tokens?.in) || 0),
    tokensOut: current.tokensOut + (Number(tokens?.out) || 0),
  };
  write(STORAGE_KEYS.usage, JSON.stringify(next));
  notify();
  return next;
}

/* ── erase ────────────────────────────────────────────────────────────── */

/**
 * Every key and every trace of AI state, gone from this browser. Offered on
 * the AI screen and linked from the account page, because a reader who wants
 * their key off a machine should not have to hunt for the switch.
 */
export function clearAiState(): void {
  for (const key of AI_STORAGE_KEYS) remove(key);
  notify();
}
