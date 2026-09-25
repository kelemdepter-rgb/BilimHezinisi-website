import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    // Playwright specs live in tests/ too — keep the runners from colliding.
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Seven files boot their own PGlite — Postgres compiled to WebAssembly —
    // in beforeAll, all at once beside the CPU-heavy spellcheck tests. Alone
    // each boot takes about a second; together they overran the 10 s default
    // on this machine and failed files that had nothing wrong with them.
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // `server-only` throws on import outside a Server Component, which is
      // exactly the guard we want in the build — but it also blocks unit
      // tests. Stubbing it here keeps the guard in production and lets the
      // pure logic in those modules stay testable.
      "server-only": fileURLToPath(new URL("./tests/unit/stubs/server-only.ts", import.meta.url)),
    },
  },
});
