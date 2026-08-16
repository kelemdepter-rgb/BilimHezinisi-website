/// <reference lib="webworker" />
/**
 * The spellchecker, off the main thread.
 *
 * Unpacking 441,322 words takes ~24 ms and checking is a binary search, but
 * suggestions can explore ~90,000 candidates when a word is two edits from
 * anything real. On the main thread that would show up as dropped keystrokes,
 * which is the one thing a writing surface may never do.
 */
import {
  isCorrect,
  suggest,
  unpackDictionary,
  UYGHUR_LETTERS,
  type PackedDictionary,
} from "@/lib/spellcheck/dictionary";
import { fetchCached } from "@/lib/spellcheck/fetch-cached";
import { CACHE_NAME, type FromWorker, type ToWorker } from "@/lib/spellcheck/protocol";

declare const self: DedicatedWorkerGlobalScope;

let dictionary: PackedDictionary | null = null;
let corrections: Map<string, string> = new Map();
let personal = new Set<string>();

function post(message: FromWorker) {
  self.postMessage(message);
}

async function init(dictUrl: string, correctionsUrl: string) {
  const started = Date.now();
  try {
    const [dict, corr] = await Promise.all([
      fetchCached(dictUrl, CACHE_NAME),
      // Corrections are an optimisation, not a requirement: without them the
      // edit search still answers, just without the hand-built pairs first.
      fetchCached(correctionsUrl, CACHE_NAME).catch(() => ({ text: "{}", fromCache: false })),
    ]);
    dictionary = unpackDictionary(dict.text);
    corrections = new Map(Object.entries(JSON.parse(corr.text) as Record<string, string>));
    post({
      type: "ready",
      words: dictionary.size,
      loadMs: Date.now() - started,
      fromCache: dict.fromCache,
    });
  } catch (error) {
    // Never block writing: the notebook carries on with spellcheck off.
    post({ type: "failed", reason: error instanceof Error ? error.message : "unknown" });
  }
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;

  if (message.type === "init") {
    void init(message.dictUrl, message.correctionsUrl);
    return;
  }

  if (message.type === "personal") {
    personal = new Set(message.words);
    return;
  }

  if (!dictionary) {
    if (message.type === "check") post({ type: "checked", id: message.id, wrong: [] });
    if (message.type === "suggest") {
      post({ type: "suggestions", id: message.id, word: message.word, list: [] });
    }
    return;
  }

  if (message.type === "check") {
    const wrong: string[] = [];
    for (const word of message.words) {
      if (!isCorrect(dictionary, word, personal)) wrong.push(word);
    }
    post({ type: "checked", id: message.id, wrong });
    return;
  }

  if (message.type === "suggest") {
    post({
      type: "suggestions",
      id: message.id,
      word: message.word,
      list: suggest(dictionary, message.word, { alphabet: UYGHUR_LETTERS, corrections }),
    });
  }
};
