#!/usr/bin/env node
/**
 * Build and serve the site against the LOCAL flood stack only.
 *
 *   node scripts/flood/serve.mjs build     next build into .next-flood/
 *   node scripts/flood/serve.mjs start     next start on :3400
 *   node scripts/flood/serve.mjs start 3401   … a second instance, for the reader
 *
 * Every Supabase variable — the address, both keys, ADMIN_EMAIL — is taken
 * from .flood/local.env (written by scripts/flood/stack.mjs up) and passed in
 * the environment, which Next lets win over .env.local, so this build cannot
 * reach the live project even though .env.local sits beside it; CRON_SECRET
 * and SITE_URL are local values too. It refuses to run if the address it was
 * given is not 127.0.0.1.
 *
 * Its own output directory, like the offline specs' .next-e2e/: the live
 * build and the dev server are left alone.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const local = Object.fromEntries(
  readFileSync(join(ROOT, ".flood", "local.env"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(/=(.*)/s).slice(0, 2)),
);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(local.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
  console.error("refusing: .flood/local.env does not point at the local stack");
  process.exit(2);
}

const FLOOD_PORT = Number(process.argv[3] ?? 3400);

const env = {
  ...process.env,
  NEXT_DIST_DIR: ".next-flood",
  NEXT_PUBLIC_SUPABASE_URL: local.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: local.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: local.SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_EMAIL: local.ADMIN_EMAIL,
  SITE_URL: `http://localhost:${FLOOD_PORT}`,
  // Nothing from the live project travels with this build.
  CRON_SECRET: "flood-local-only",
};

const command = process.argv[2];
const args =
  command === "build"
    ? ["next", "build"]
    : command === "start"
      ? ["next", "start", "-p", String(FLOOD_PORT)]
      : null;
if (!args) {
  console.error("usage: node scripts/flood/serve.mjs build|start");
  process.exit(2);
}

const child = spawn("npx", args, { env, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
