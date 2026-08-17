/**
 * Which letter substitutions Uyghur writers actually make.
 *
 * Not guessed from what looks similar — counted. Every pair below was derived
 * from the desktop's `uyghur_corrections.json`, 3,400 hand-collected
 * wrong → right pairs, by taking only those that differ in exactly ONE position
 * (1,700 of them) so no alignment guesswork could invent a substitution that
 * was really an insertion or a rewrite. The number after each pair is how many
 * times that swap appears in that data.
 *
 * The top entry is the surprise, and it is why this table is measured rather
 * than assumed: ل ↔ م is not a pair anyone would list as confusable, and it is
 * the single most common error there is. It is the spoken assimilation of the
 * «-ئالماي» (cannot) suffix — قىلالماي written as قىلامماي, بولماستىن as
 * بوماستىن — 160 times over. م ↔ ن (39) is the same thing for nasals. A table
 * built from intuition would have missed both and kept ژ ↔ چ, which never
 * happens at all.
 *
 * A pair being cheap does not let it outrank a closer word: ranking sorts on
 * the true integer edit distance first (lib/spellcheck/rank.ts), and this table
 * only decides the order WITHIN one distance. That is deliberate — it means a
 * generous discount here can never promote a word that is further away.
 */

/** Observed in corrections.json, three times or more. Sorted as counted. */
const OBSERVED: Record<string, number> = {
  // ── the assimilation patterns ──
  "لم": 160, "من": 39, "لن": 24, "تن": 17, "رل": 15, "دل": 8, "تل": 8, "رن": 6,
  "قل": 4, "دن": 3,
  // ── vowels, which is where most real typing errors live ──
  "اە": 127, "ىە": 111, "ىۇ": 99, "وۇ": 89, "اى": 72, "ىۈ": 68, "ۇۈ": 64,
  "ېە": 52, "ىې": 34, "ۆۈ": 32, "اۇ": 30, "او": 23, "ۈە": 9, "اې": 8, "وۆ": 7,
  "ۆۇ": 6, "ۇە": 4, "وې": 3,
  // ── consonants ──
  "تد": 42, "سش": 41, "غق": 40, "قك": 35, "بپ": 33, "جچ": 27, "نڭ": 27,
  "خق": 26, "كگ": 24, "غگ": 23, "شچ": 23, "خھ": 17, "زس": 14, "ئي": 9,
  "ئھ": 8, "ڭگ": 8, "يپ": 8, "بۋ": 7, "غھ": 7, "خغ": 6, "خش": 5, "ھۋ": 5,
  "قپ": 5, "قھ": 5, "بد": 4, "تك": 4, "غڭ": 4, "ئت": 4, "ئن": 4, "قچ": 3,
  "مڭ": 3, "تق": 3, "شھ": 3, "پۋ": 3, "گۋ": 3, "ئل": 3, "لي": 3,
};

/**
 * Pairs the brief requires treated as near-free whatever the corpus says.
 *
 * ژ ↔ ج / ژ ↔ چ and ۋ ↔ ف are here on that instruction: ژ occurs 743 times in
 * a 441,322-word dictionary and ف 2,900, so neither appears often enough in
 * 3,400 corrections to earn a count. Rare is not the same as impossible.
 */
const REQUIRED = ["ۇۆ", "ۇۈ", "ۆۈ", "ىې", "خھ", "قك", "غگ", "جچ", "ژج", "ژچ", "اە", "وۇ", "ۋف"];

/**
 * What one substitution costs, against 1.0 for an arbitrary one.
 *
 * The floor is 0.55 and not lower for a reason worth stating: two substitutions
 * then cost at least 1.10, which is more than any single one can cost. Combined
 * with sorting on integer distance first, a two-edit candidate can never
 * displace a one-edit candidate however confusable its letters are.
 */
const COST_VERY_COMMON = 0.55; // 60+ occurrences
const COST_COMMON = 0.65; //      20+
const COST_SEEN = 0.75; //         5+
const COST_RARE = 0.85; //         seen at all, or required by the brief
const COST_ARBITRARY = 1; //       never observed

function key(a: string, b: string): string {
  return a < b ? a + b : b + a;
}

const COSTS: Map<string, number> = (() => {
  const table = new Map<string, number>();
  for (const pair of REQUIRED) {
    const [a, b] = [...pair];
    table.set(key(a, b), COST_RARE);
  }
  for (const [pair, count] of Object.entries(OBSERVED)) {
    const [a, b] = [...pair];
    const cost =
      count >= 60
        ? COST_VERY_COMMON
        : count >= 20
          ? COST_COMMON
          : count >= 5
            ? COST_SEEN
            : COST_RARE;
    // A pair in both lists takes the cheaper (better attested) cost.
    const existing = table.get(key(a, b));
    table.set(key(a, b), existing === undefined ? cost : Math.min(existing, cost));
  }
  return table;
})();

/** IsSozuq, from the desktop's Uyghur.cs by way of spellcheck.js line 50. */
export const UYGHUR_VOWELS = new Set(["ا", "ە", "و", "ۇ", "ۆ", "ۈ", "ې", "ى"]);

/** What replacing `a` with `b` costs. 1.0 when the pair is not a known confusion. */
export function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  return COSTS.get(key(a, b)) ?? COST_ARBITRARY;
}

/** Only for tests and the ranking report — the table is otherwise read through the function. */
export const CONFUSION_PAIR_COUNT = COSTS.size;
