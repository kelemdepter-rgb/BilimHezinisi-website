/**
 * Stand-in for the `server-only` package under vitest (see vitest.config.mts).
 *
 * The real package throws on import so a server module can never be pulled
 * into a client bundle. That guard belongs in the build, not in a unit test
 * runner that has no such notion — importing it there would fail every test
 * of a server module's pure logic.
 */
export {};
