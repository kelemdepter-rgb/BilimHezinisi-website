/**
 * Development-only timing probe.
 *
 * Answers one question and nothing else: how long did each server-side phase
 * of a request take — the proxy's session refresh, the shell's session
 * lookup, the category query, the page's own queries. It exists so that a
 * later session can re-measure the numbers in PROMPT-21 instead of guessing.
 *
 * It cannot record anything about a reader. What it prints is a label that is
 * a literal in our own source and a duration in milliseconds; a user id, an
 * email, a search term, a note, a prompt and a key can none of them reach it,
 * because none of them is ever passed in.
 *
 * It cannot run in production either. `process.env.NODE_ENV` is inlined at
 * build time, so in a production build ENABLED is the constant `false` and
 * the branch below is dead code. Even in development it stays silent until
 * PERF_TIMING=1 is set explicitly.
 */
const ENABLED = process.env.NODE_ENV !== "production" && process.env.PERF_TIMING === "1";

/** Times `fn` under a fixed label. Returns exactly what `fn` returns. */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!ENABLED) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    console.log(`[perf]   ${label.padEnd(28)} ${(performance.now() - start).toFixed(1)} ms`);
  }
}

/** Prints a header so the spans below it can be read as one request. */
export function markRequest(path: string): void {
  if (!ENABLED) return;
  console.log(`[perf] ── ${path}`);
}
