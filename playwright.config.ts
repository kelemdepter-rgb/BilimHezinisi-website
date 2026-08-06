import { defineConfig } from "@playwright/test";
import { STAFF_STATE_PATH, loadEnvLocal } from "./tests/env";

loadEnvLocal();

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
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
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
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
