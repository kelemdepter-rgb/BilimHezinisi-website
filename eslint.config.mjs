import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // The production build the offline Playwright specs are served from
    // (next.config.ts distDir); machine-generated, exactly like .next.
    ".next-e2e/**",
    // The dev server the sign-in and registration specs run against a fake
    // Supabase (playwright.config.ts); machine-generated too.
    ".next-mock/**",
    // The production build the flood test serves (scripts/flood/); generated too.
    ".next-flood/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
