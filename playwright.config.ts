import { defineConfig, type Project } from "@playwright/test";
import { CRON_TEST_SECRET, STAFF_STATE_PATH, loadEnvLocal } from "./tests/env";

loadEnvLocal();

/**
 * The cron token the servers this suite starts run with.
 *
 * /api/health only checks a Bearer token when CRON_SECRET is set, and without
 * one there is no way to prove that check survived the domain move — the
 * route would simply answer everybody. A real secret out of .env.local wins;
 * otherwise the suite supplies its own, and both servers below inherit it
 * through process.env. domain.spec.ts says so out loud if it finds a reused
 * server that predates this.
 */
process.env.CRON_SECRET ||= CRON_TEST_SECRET;

/**
 * Where the dev server runs.
 *
 * Overridable because Windows hands whole port ranges to Hyper-V on a whim —
 * `netsh interface ipv4 show excludedportrange protocol=tcp` has been seen
 * holding 2988-3087, which takes 3000 with it and makes `next dev` fail with
 * EACCES. `PW_DEV_PORT=3200 npm test` gets a run through without editing
 * anything; the default is unchanged.
 */
const DEV_PORT = process.env.PW_DEV_PORT ?? "3000";
const DEV_URL = `http://localhost:${DEV_PORT}`;

/** Where the production build for the offline specs is served. */
const PROD_URL = "http://localhost:3100";

/**
 * A distinct caller address per project, per run.
 *
 * The site's rate limiters (lib/rate-limit.ts) key on `x-forwarded-for`, and on
 * localhost there is none — so every caller falls into one shared bucket, and
 * a full run spends the sign-up allowance partway through and then fails the
 * rest with an unexplained "could not sign in". Three viewports really are
 * three devices, and the setup project really is a different visitor from the
 * request specs, so saying so is honest as well as convenient.
 *
 * The run byte changes between runs, so running the suite twice inside ten
 * minutes does not carry the first run's counters into the second. It is drawn
 * at random rather than from the clock: a second-derived byte repeats itself
 * every 254 seconds, which is exactly the interval at which the suite gets run
 * twice while something is being fixed.
 *
 * The limiters themselves are untouched and still exercised: discovery.spec.ts
 * spends its own allowance on purpose and asserts the Uyghur message it gets.
 */
const RUN_OCTET = Math.floor(Math.random() * 254) + 1;

function callerFor(name: string): string {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) % 251;
  // 198.18.0.0/15 is reserved for benchmarking and routes nowhere real.
  return `198.18.${RUN_OCTET}.${hash + 1}`;
}

/** Every project browses as its own visitor. */
function asOwnVisitor(projects: Project[]): Project[] {
  return projects.map((project) => {
    // Project["use"] is Partial<{}> until a project actually sets something,
    // so the existing options are widened rather than indexed into.
    const existing = (project.use ?? {}) as Record<string, unknown>;
    const headers = (existing.extraHTTPHeaders ?? {}) as Record<string, string>;
    return {
      ...project,
      use: {
        ...existing,
        extraHTTPHeaders: {
          ...headers,
          "x-forwarded-for": callerFor(project.name ?? "anonymous"),
        },
      },
    } as Project;
  });
}

const VIEWPORTS = [
  { name: "mobile-375x667", width: 375, height: 667, mobile: true, scale: 2 },
  { name: "mobile-390x844", width: 390, height: 844, mobile: true, scale: 3 },
  { name: "desktop-1280x800", width: 1280, height: 800, mobile: false, scale: 1 },
] as const;

/**
 * Mobile-first testing gate (CLAUDE.md): every feature must pass at
 * 375×667, 390×844 and 1280×800 — no horizontal overflow, controls usable
 * after scrolling, drawers must not trap body scroll.
 */
export default defineConfig({
  testDir: "./tests",
  // The Next dev server on Windows stalls page loads under parallel browser
  // contexts (all navigations time out with >1 worker), so the suite runs
  // serially — it stays well under a minute.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: DEV_URL,
    trace: "on-first-retry",
  },
  projects: asOwnVisitor([
    { name: "setup", testMatch: /auth\.setup\.ts/, teardown: "cleanup" },
    { name: "cleanup", testMatch: /auth\.teardown\.ts/ },
    ...VIEWPORTS.flatMap((viewport) => [
      {
        name: viewport.name,
        testMatch: /smoke\.spec\.ts/,
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
        },
      },
      {
        // Format specs (PDF rejection, DOCX round-trip, free-tier plumbing).
        name: `formats-${viewport.name}`,
        testMatch: /formats\.spec\.ts/,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
          storageState: STAFF_STATE_PATH,
        },
      },
      {
        // Reader/library specs need the seeded book from the setup project.
        name: `reader-${viewport.name}`,
        testMatch: /reader\.spec\.ts/,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
          storageState: STAFF_STATE_PATH,
        },
      },
      {
        /**
         * The domain move: the old address redirecting, the hosts that must
         * NOT be redirected, and the daily cron's route still answering.
         * Which host a request arrives on has nothing to do with how wide the
         * screen is, so — like the security project below — this runs once at
         * the desktop size; the one block that does care about width sets its
         * own 360 px viewport.
         */
        name: `domain-${viewport.name}`,
        testMatch: /domain.spec.ts/,
        testIgnore: viewport.mobile ? /./ : undefined,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
        },
      },
      {
        // Security and crawler rules: anonymous by definition, and viewport
        // independent, so they run once at the desktop size only.
        name: `security-${viewport.name}`,
        testMatch: /security\.spec\.ts/,
        testIgnore: viewport.mobile ? /./ : undefined,
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
        },
      },
      {
        // Quran specs run ANONYMOUSLY — /quran must work without an account.
        // The bookmark block opts into the staff state itself, which is why
        // the setup project still has to run first.
        name: `quran-${viewport.name}`,
        testMatch: /quran\.spec\.ts/,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
        },
      },
      {
        // The notebook: signed-in by default, with the isolation test opening a
        // second, different account itself.
        name: `notes-${viewport.name}`,
        testMatch: /notes.spec.ts/,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
          storageState: STAFF_STATE_PATH,
        },
      },
      {
        /**
         * Citing the library and the Qur'an from inside a note, find and
         * replace, and the notebook's typography. Signed in, like the rest of
         * the notebook, and against the seeded book the setup project writes.
         */
        name: `notes-sources-${viewport.name}`,
        testMatch: /notes-sources.spec.ts/,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
          storageState: STAFF_STATE_PATH,
        },
      },
      {
        // Licence attribution, the legal pages, password recovery and the
        // account page. Anonymous by default — everything a reader without an
        // account must be able to reach — with the account block opting into
        // the staff state itself, which is why setup still has to run first.
        name: `trust-${viewport.name}`,
        testMatch: /trust.spec.ts/,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
        },
      },
      {
        /**
         * Installability and offline reading. Anonymous by default — reading
         * without an account is the point — with the private-cache block
         * opening its own signed-in context, which is why setup runs first.
         */
        name: `offline-${viewport.name}`,
        testMatch: /offline.spec.ts/,
        dependencies: ["setup"],
        use: {
          // Against the production build, not the dev server: Next's dev HMR
          // client chunk is renamed on every load, so a document cached for
          // offline use could never find its scripts again — an artifact of
          // the dev server that says nothing about what ships.
          baseURL: PROD_URL,
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
        },
      },
      {
        // Downloading a book, sharing a page, and the quote card — all of
        // which must work for a reader with no account.
        name: `share-${viewport.name}`,
        testMatch: /share.spec.ts/,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
        },
      },
      {
        /**
         * Authors, what is new, the feed and the book-request inbox.
         * Anonymous by default — none of it may need an account — with the
         * inbox block opening its own signed-in contexts.
         */
        name: `discovery-${viewport.name}`,
        testMatch: /discovery.spec.ts/,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
        },
      },
      {
        // The on-screen Uyghur keyboard and recent searches: both exist for a
        // phone, so both are checked at every width.
        name: `keyboard-${viewport.name}`,
        testMatch: /keyboard.spec.ts/,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
        },
      },
      {
        /**
         * Importing many books at once. Writes real books and reads their
         * metadata back out of the database, so it runs signed in as staff and
         * removes everything it created.
         */
        name: `batch-${viewport.name}`,
        testMatch: /batch-import.spec.ts/,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
          storageState: STAFF_STATE_PATH,
        },
      },
      {
        /**
         * The notebook's AI workspace, against the same fake endpoint. Signed
         * in as an ordinary reader, because notes are per-user and this spec
         * writes real ones and removes them again.
         */
        name: `notes-ai-${viewport.name}`,
        testMatch: /notes-ai\.spec\.ts/,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
          storageState: STAFF_STATE_PATH,
        },
      },
      {
        /**
         * The reader's AI panel, against the same fake endpoint. Signed in and
         * against the seeded book, because the panel only exists for a reader
         * with an account who has switched AI on — the "no account, no sign of
         * AI" block opens its own anonymous context.
         */
        name: `reader-ai-${viewport.name}`,
        testMatch: /reader-ai.spec.ts/,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
          storageState: STAFF_STATE_PATH,
        },
      },
      {
        /**
         * The AI layer, against a fake Gemini endpoint installed in the page
         * (tests/fixtures/gemini-mock.ts) — a CI run must never spend the
         * owner's or anybody else's real quota. Signed in, because the
         * settings screen is; the "no account, no sign of AI" block opens its
         * own anonymous context.
         */
        name: `ai-${viewport.name}`,
        /**
         * Anchored to the filename on purpose. `/ai.spec.ts/` is a substring
         * match, so it also picked up reader-ai.spec.ts AND notes-ai.spec.ts —
         * 42 extra tests per viewport, every one of them already run by its
         * own project. Keep the leading separator and the $.
         */
        testMatch: /[\\/]ai\.spec\.ts$/,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
          storageState: STAFF_STATE_PATH,
        },
      },
      {
        /**
         * What PROMPT-21 repaired: the loading skeletons, the pending dot on
         * the control that was tapped, the streamed account controls, and the
         * two things caching was not allowed to cost — a stale library after
         * publishing, and one reader's page reaching another. Anonymous by
         * default, because that is who most of it is for; the signed-in blocks
         * open their own contexts, which is why setup runs first.
         */
        name: `navigation-${viewport.name}`,
        testMatch: /navigation\.spec\.ts/,
        dependencies: ["setup"],
        use: {
          /**
           * Against the production build, like the offline specs, and for a
           * related reason: `next dev` turns <Link> prefetching off, and half
           * of what this spec is about — the loading boundary a prefetch
           * delivers, and the prefetch itself — does not happen there. Testing
           * it against the dev server would be testing something no reader
           * ever meets.
           */
          baseURL: PROD_URL,
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
        },
      },
      {
        // Admin specs reuse the signed-in staff state from the setup project.
        name: `admin-${viewport.name}`,
        testMatch: /admin\.spec\.ts/,
        dependencies: ["setup"],
        use: {
          browserName: "chromium" as const,
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          deviceScaleFactor: viewport.scale,
          storageState: STAFF_STATE_PATH,
        },
      },
    ]),
  ]),
  webServer: [
    {
      command: `npm run dev -- --port ${DEV_PORT}`,
      url: DEV_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      /**
       * A real build, on its own port and its own output directory, for the
       * offline specs. Reused when it is already up, so running the suite
       * twice in a row only builds once.
       */
      command: "npm run test:prod",
      url: PROD_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
