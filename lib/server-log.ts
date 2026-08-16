import "server-only";

/**
 * Report a server-side failure to the platform log (Vercel → Logs) in a shape
 * that is actually diagnosable, without ever writing down something private.
 *
 * The notebook bug that prompted this took a long time to place because the
 * only evidence was a blank page reading "A server error occurred": Next's
 * built-in error screen, with the real cause visible nowhere. So failures are
 * now named where they happened and what kind they were.
 *
 * What is deliberately NOT logged: note text, titles, book content, request
 * bodies, cookies, tokens, and any environment value. A Postgres error's
 * `details` and `hint` can quote the offending row, so they are left out too —
 * the SQLSTATE code identifies the fault without quoting the data.
 */
export function reportServerError(where: string, error: unknown): void {
  const parts: string[] = [`[bh] ${where}`];

  if (error instanceof Error) {
    parts.push(`${error.name}: ${error.message.slice(0, 300)}`);
    // A module that fails to load takes the whole route with it, and the stack
    // is the only thing that says which module — the case that hid the jsdom
    // failure behind a 500 for weeks.
    if (error.stack) parts.push(error.stack.split("\n").slice(1, 4).join(" | "));
  } else if (error && typeof error === "object") {
    const supabaseError = error as { code?: string; message?: string };
    parts.push(
      `code=${supabaseError.code ?? "?"} ${String(supabaseError.message ?? "").slice(0, 300)}`,
    );
  } else {
    parts.push(String(error).slice(0, 300));
  }

  console.error(parts.join(" — "));
}
