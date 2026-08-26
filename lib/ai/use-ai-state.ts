"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_MODEL, type ModelId } from "./models";
import {
  KEY_SLOT_COUNT,
  getAiStateVersion,
  hasAnyKey,
  maskKey,
  readEnabled,
  readKeys,
  readLastGoodSlot,
  readModel,
  readUsage,
  subscribeToAiState,
  type AiUsage,
} from "./storage";

export type AiState = {
  enabled: boolean;
  model: ModelId;
  /** One masked key per slot, "" where the slot is empty. */
  masks: string[];
  lastGoodSlot: number | null;
  usage: AiUsage;
  hasKey: boolean;
};

/**
 * What the server renders, and what a browser with no stored state shows:
 * everything off and empty.
 *
 * The server has no localStorage to read and never will — it is not supposed
 * to know any of this. Rendering the off state on both sides is what keeps
 * hydration honest; React swaps in the real values immediately afterwards.
 */
const SERVER_STATE: AiState = Object.freeze({
  enabled: false,
  model: DEFAULT_MODEL,
  masks: new Array<string>(KEY_SLOT_COUNT).fill(""),
  lastGoodSlot: null,
  usage: { day: "", requests: 0, tokensIn: 0, tokensOut: 0 },
  hasKey: false,
});

let cachedVersion = -1;
let cached: AiState = SERVER_STATE;

/**
 * useSyncExternalStore compares snapshots by identity, so this has to return
 * the SAME object until something actually changes — building a fresh one on
 * every call would loop forever.
 */
function clientState(): AiState {
  const version = getAiStateVersion();
  if (version === cachedVersion) return cached;
  cachedVersion = version;
  cached = {
    enabled: readEnabled(),
    model: readModel(),
    masks: readKeys().map(maskKey),
    lastGoodSlot: readLastGoodSlot(),
    usage: readUsage(),
    hasKey: hasAnyKey(),
  };
  return cached;
}

/**
 * Every AI setting this browser holds, kept in step across the switch, the key
 * slots and the ask box — including when a request itself writes, which is
 * what happens when a failover records the key that finally answered.
 */
export function useAiState(): AiState {
  return useSyncExternalStore(subscribeToAiState, clientState, () => SERVER_STATE);
}
