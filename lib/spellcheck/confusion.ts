/**
 * What it costs to have typed one thing when another was meant.
 *
 * Not guessed from what looks similar — counted. Every number here comes from
 * the desktop's `uyghur_corrections.json`, 3,400 hand-collected wrong → right
 * pairs, aligned and tallied by scripts/build-edit-weights.mjs. Four pairs in
 * five were used for the counting and the fifth was held out before any of it
 * happened, so the accuracy the evaluation reports was measured on pairs these
 * costs never saw.
 *
 * The top single-character entry is the surprise, and it is why this table is
 * measured rather than assumed: ل ↔ م is not a pair anyone would list as
 * confusable, and it is the most common error there is. It is the spoken
 * assimilation of the «-ئالماي» (cannot) suffix — قىلالماي written as قىلامماي,
 * بولماستىن as بوماستىن. م ↔ ن is the same thing for nasals. A table built from
 * intuition would have missed both and kept ژ ↔ چ, which never happens at all.
 *
 * SEGMENTS, NOT ONLY CHARACTERS. Single-character costs cannot express that
 * «امم → الم» is one habit rather than two independent slips, so the aligned
 * segment rewrites are priced as units — Brill and Moore's construction. A
 * rewrite the data shows happening again and again becomes cheap AS A WHOLE,
 * which is what separates a real Uyghur error pattern from an arbitrary pair of
 * edits that happens to land in the same place.
 */
import { CONFUSIONS, REWRITES } from "./edit-weights.generated";

/** IsSozuq, from the desktop's Uyghur.cs by way of spellcheck.js line 50. */
export const UYGHUR_VOWELS = new Set(["ا", "ە", "و", "ۇ", "ۆ", "ۈ", "ې", "ى"]);

/**
 * What one substitution costs, against 1.0 for an arbitrary one.
 *
 * The floor is 0.55 and not lower for a reason worth stating: two substitutions
 * then cost at least 1.10, which is more than any single one can cost. Nothing
 * a confusion table says can make two edits look closer than one edit.
 */
const COST_VERY_COMMON = 0.55; // 60+ occurrences
const COST_COMMON = 0.65; //      20+
const COST_SEEN = 0.75; //         5+
const COST_RARE = 0.85; //         seen at all
const COST_ARBITRARY = 1; //       never observed

function costForCount(count: number): number {
  if (count >= 60) return COST_VERY_COMMON;
  if (count >= 20) return COST_COMMON;
  if (count >= 5) return COST_SEEN;
  return COST_RARE;
}

/**
 * Pairs treated as near-free whatever the corpus says.
 *
 * ژ ↔ ج / ژ ↔ چ and ۋ ↔ ف are here deliberately: ژ occurs 743 times in a
 * 441,322-word dictionary and ف 2,900, so neither appears often enough in 3,400
 * corrections to earn a count. Rare is not the same as impossible.
 */
const REQUIRED = ["ۇۆ", "ۇۈ", "ۆۈ", "ىې", "خھ", "قك", "غگ", "جچ", "ژج", "ژچ", "اە", "وۇ", "ۋف"];

function key(a: string, b: string): string {
  return a < b ? a + b : b + a;
}

const COSTS: Map<string, number> = (() => {
  const table = new Map<string, number>();
  for (const pair of REQUIRED) {
    const [a, b] = [...pair];
    table.set(key(a, b), COST_RARE);
  }
  for (const [pair, count] of CONFUSIONS) {
    const [a, b] = [...pair];
    const cost = costForCount(count);
    // A pair in both lists takes the cheaper (better attested) cost.
    const existing = table.get(key(a, b));
    table.set(key(a, b), existing === undefined ? cost : Math.min(existing, cost));
  }
  return table;
})();

/** What replacing `a` with `b` costs. 1.0 when the pair is not a known confusion. */
export function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  return COSTS.get(key(a, b)) ?? COST_ARBITRARY;
}

/**
 * A learned segment rewrite, priced against what the same span would otherwise
 * cost as ordinary edits.
 *
 * The discount is capped rather than unbounded. A rewrite seen 59 times is a
 * real habit, but letting it cost nothing would let a candidate three
 * characters away outrank one that is a single letter off, and no amount of
 * frequency should buy that. So the cheapest a segment can ever be is
 * REWRITE_FLOOR times the span it replaces.
 */
const REWRITE_FLOOR = 0.34;

export type Rewrite = { from: string; to: string; cost: number };

/** Rewrites grouped by their first typed character, for a fast inner loop. */
export const REWRITES_BY_HEAD: ReadonlyMap<string, readonly Rewrite[]> = (() => {
  const table = new Map<string, Rewrite[]>();
  for (const [from, to, count] of REWRITES) {
    // Rewrites are indexed by the character they START AT IN THE TYPED WORD,
    // so one with no typed side has nowhere to hang and would fire wherever
    // its intended side happened to begin. The miner drops those; this is the
    // guard that keeps a regenerated table from reintroducing one quietly.
    if (from.length === 0) continue;
    // The span this replaces would otherwise cost roughly one per edit; price
    // the whole rewrite as a fraction of that, floored so it stays a discount
    // and never becomes free.
    const span = Math.max(from.length, to.length);
    const discount = count >= 40 ? REWRITE_FLOOR : count >= 15 ? 0.45 : count >= 6 ? 0.55 : 0.65;
    const cost = Math.max(REWRITE_FLOOR, discount) * span;
    const head = from[0];
    const bucket = table.get(head);
    if (bucket) bucket.push({ from, to, cost });
    else table.set(head, [{ from, to, cost }]);
  }
  return table;
})();

/** Only for tests and the ranking report — the tables are otherwise read through functions. */
export const CONFUSION_PAIR_COUNT = COSTS.size;
export const REWRITE_COUNT = REWRITES.length;

/**
 * Which letters are plausibly confused with each one.
 *
 * Used to bound the second edit when searching two edits out. Generating every
 * second edit over the whole 34-letter alphabet costs about half a million
 * candidates and half a second per word, which is far past the point where
 * typing stutters — and almost all of it is spent on pairs like ژ for ت that
 * nobody has ever typed. Two REAL errors in one word are two confusions, so the
 * second step is drawn from this table instead. The first edit stays
 * unrestricted, because a single arbitrary slip is exactly what does happen.
 */
export const CONFUSABLE_WITH: ReadonlyMap<string, readonly string[]> = (() => {
  const table = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const bucket = table.get(a);
    if (bucket) bucket.push(b);
    else table.set(a, [b]);
  };
  for (const pair of COSTS.keys()) {
    const [a, b] = [...pair];
    link(a, b);
    link(b, a);
  }
  return table;
})();
