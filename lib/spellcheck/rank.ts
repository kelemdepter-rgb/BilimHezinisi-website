/**
 * Which correction to offer first.
 *
 * THE MODEL. This is a noisy channel, stated plainly so the parts stay coherent
 * instead of drifting into a pile of ad-hoc bonuses:
 *
 *     score(candidate) = log P(candidate) + log P(typed | candidate)
 *
 * P(candidate) is how often the word is actually written — measured over the
 * 15 published books, carried in the dictionary artifact as a log2 bucket, so
 * `log P` is the bucket itself and adding it is the right operation.
 *
 * P(typed | candidate) is how likely this particular slip was, which is what
 * the learned edit weights in confusion.ts price. A cheap edit is a probable
 * one, so the channel term is the negative of the weighted distance.
 *
 * WHY FREQUENCY IS SCALED DOWN. The two terms are not commensurable: the
 * frequency bucket spans 0..15 while an edit costs about 1. Left unscaled,
 * frequency would decide everything and a very common word three edits away
 * would beat the word the writer obviously meant. FREQUENCY_WEIGHT is set so
 * the entire frequency range is worth slightly less than one arbitrary edit,
 * which gives a property worth having: frequency fully orders candidates that
 * are equally close, and can never promote a further candidate over a nearer
 * one. Ties are therefore broken by what people write, never alphabetically.
 *
 * The weight was chosen by sweeping it against the TRAINING half of the
 * corrections; the held-out half was not consulted, so the accuracy reported
 * for it is not the accuracy it was tuned on.
 */
import { REWRITES_BY_HEAD, substitutionCost } from "./confusion";
import { frequencyOf, type PackedDictionary } from "./dictionary";

/** One full frequency range (0..15) is worth a shade under one arbitrary edit. */
export const FREQUENCY_WEIGHT = 0.06;

/** Deletion and insertion, when no learned rewrite covers them. */
const GAP_COST = 1;
/** Transposition — one motion, and priced as such. */
const TRANSPOSE_COST = 0.9;

/**
 * The weighted distance from what was typed to a candidate.
 *
 * An ordinary edit-distance table, plus one extra move: any learned segment
 * rewrite whose two sides both match here can be taken as a single step at its
 * own price. That is what makes «لىن → لەن» cost less as one habit than as an
 * arbitrary substitution, and it is the only place multi-character knowledge
 * enters the ranking.
 */
export function weightedDistance(typed: string, candidate: string): number {
  const a = [...typed];
  const b = [...candidate];
  const rows = a.length;
  const columns = b.length;

  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(Infinity));
  table[0][0] = 0;
  for (let i = 1; i <= rows; i++) table[i][0] = i * GAP_COST;
  for (let j = 1; j <= columns; j++) table[0][j] = j * GAP_COST;

  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= columns; j++) {
      const here = table[i][j];
      if (here === Infinity) continue;

      if (i < rows && j < columns) {
        const cost = a[i] === b[j] ? 0 : substitutionCost(a[i], b[j]);
        if (here + cost < table[i + 1][j + 1]) table[i + 1][j + 1] = here + cost;
      }
      if (i < rows && here + GAP_COST < table[i + 1][j]) table[i + 1][j] = here + GAP_COST;
      if (j < columns && here + GAP_COST < table[i][j + 1]) table[i][j + 1] = here + GAP_COST;

      if (i + 1 < rows && j + 1 < columns && a[i] === b[j + 1] && a[i + 1] === b[j]) {
        if (here + TRANSPOSE_COST < table[i + 2][j + 2]) table[i + 2][j + 2] = here + TRANSPOSE_COST;
      }

      // Learned segment rewrites, indexed by the character they start at so
      // this stays a short list rather than a scan of the whole table.
      const bucket = REWRITES_BY_HEAD.get(a[i]);
      if (!bucket) continue;
      for (const rewrite of bucket) {
        const fromLength = rewrite.from.length;
        const toLength = rewrite.to.length;
        if (i + fromLength > rows || j + toLength > columns) continue;
        let matches = true;
        for (let k = 0; k < fromLength; k++) {
          if (a[i + k] !== rewrite.from[k]) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
        for (let k = 0; k < toLength; k++) {
          if (b[j + k] !== rewrite.to[k]) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
        const target = table[i + fromLength][j + toLength];
        if (here + rewrite.cost < target) table[i + fromLength][j + toLength] = here + rewrite.cost;
      }
    }
  }
  return table[rows][columns];
}

/**
 * The full score. Higher is better.
 *
 * `frequency` is passed in rather than looked up so the caller can score a
 * candidate that is not a single dictionary entry — a corrected stem with its
 * suffix reattached, for instance, whose frequency is the stem's.
 */
export function scoreCandidate(typed: string, candidate: string, frequency: number): number {
  return FREQUENCY_WEIGHT * frequency - weightedDistance(typed, candidate);
}

export type ScoredCandidate = { term: string; score: number };

/**
 * Rank candidates and keep the best `limit`.
 *
 * Everything is scored before anything is cut. The previous implementation cut
 * to ten by edit distance and then sorted alphabetically inside each distance,
 * which threw away the good answer whenever more than ten words sat one edit
 * away — and for short Uyghur words that is most of them.
 */
export function rankCandidates(
  dictionary: PackedDictionary,
  typed: string,
  candidates: Iterable<{ term: string; frequency?: number }>,
  limit: number,
): string[] {
  const scored: ScoredCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.term === typed || seen.has(candidate.term)) continue;
    seen.add(candidate.term);
    const frequency = candidate.frequency ?? frequencyOf(dictionary, candidate.term);
    scored.push({ term: candidate.term, score: scoreCandidate(typed, candidate.term, frequency) });
  }
  // Score descending; the term comparison is only a tiebreak of last resort so
  // the order is deterministic, never the primary rule.
  scored.sort((a, b) => b.score - a.score || (a.term < b.term ? -1 : 1));
  return scored.slice(0, limit).map((candidate) => candidate.term);
}
