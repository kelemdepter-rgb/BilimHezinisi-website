#!/usr/bin/env node
/**
 * The 2026-10-05 flood, replayed against a LOCAL build — never the live site.
 *
 *   node scripts/flood/serve.mjs build && node scripts/flood/serve.mjs start
 *   node scripts/flood/flood.mjs [--users=100] [--seconds=30] [--one-address]
 *
 * NEVER POINT THIS AT bilimhezinisi.com OR THE LIVE SUPABASE PROJECT. It
 * refuses any target that is not localhost; a flood like this is exactly what
 * took the site down. (CLAUDE.md, DO-NOT-TOUCH.)
 *
 * What it does, in three phases:
 *   1. before — the reading pages, one at a time, on a quiet server;
 *   2. flood  — `--users` virtual users, each sending whole-library searches
 *      for heavy words back to back for `--seconds` (what k6 does: a new
 *      request the moment the last one answers), each from its own address
 *      unless `--one-address`; meanwhile one reader keeps loading the home
 *      page, a book page and a reader page, one after another;
 *   3. after  — the reading pages and one search, once the flood has stopped.
 *
 * It reports per phase how long the reading pages took, how the searches
 * ended (results / busy / anything else) and how long the slowest of each
 * took, and exits non-zero when a reading page took 2 s or more, any request
 * answered 5xx, or a search was neither results nor the busy message.
 *
 * Addresses: the site's own per-address brake (SEARCH_RULE) keys on
 * x-forwarded-for, which Vercel sets and this script imitates from the
 * 198.18.0.0/15 benchmarking range. With an address per user the brake never
 * fires, so what holds is the database's search slots (migration 0028) — the
 * layer that must hold against a flood from many addresses.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const TARGET = process.env.FLOOD_TARGET ?? "http://localhost:3400";
/**
 * Where the reader loads the reading pages. The same server by default; a
 * second instance of the same build (serve.mjs start 3401) is closer to
 * Vercel, where requests get function instances of their own and the one
 * thing every page shares is the database — what failed on 2026-10-05.
 */
const READER = process.env.FLOOD_READER ?? TARGET;
for (const url of [TARGET, READER]) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url)) {
    console.error(`refusing: ${url} is not a local server`);
    process.exit(2);
  }
}

const arg = (name, fallback) => {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found ? Number(found.split("=")[1]) : fallback;
};
const USERS = arg("users", 100);
const SECONDS = arg("seconds", 30);
const ONE_ADDRESS = process.argv.includes("--one-address");
const READ_BUDGET_MS = 2_000;

const READING = [
  "/",
  `/books/${process.env.FLOOD_BOOK ?? "22"}`,
  `/books/${process.env.FLOOD_BOOK ?? "22"}/read?page=5`,
];
const HEAVY = ["پەيغەمبەر", "ناماز", "ئىلىم", "كىتاب", "مېۋە", "تېخنىكا", "ئاللاھ"];

const address = (n) => `198.18.${Math.floor(n / 250) + 10}.${(n % 250) + 1}`;

async function get(path, forwardedFor, base = TARGET) {
  const started = performance.now();
  try {
    const response = await fetch(`${base}${path}`, {
      headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
      redirect: "manual",
    });
    const body = await response.text();
    return { status: response.status, ms: performance.now() - started, body };
  } catch (error) {
    return { status: 0, ms: performance.now() - started, body: String(error) };
  }
}

function searchOutcome(result) {
  if (result.status >= 500 || result.status === 0) return "5xx";
  if (result.body.includes('data-testid="search-busy"')) return "busy";
  if (result.body.includes('data-testid="search-meta"') || result.body.includes('data-testid="search-empty"')) {
    return "results";
  }
  if (result.body.includes('data-testid="search-timeout"')) return "timeout";
  if (result.body.includes('data-testid="search-failed"')) return "failed";
  return "other";
}

const summary = (values) => {
  if (values.length === 0) return "—";
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return `n=${sorted.length} median ${Math.round(at(0.5))} ms, p95 ${Math.round(at(0.95))} ms, max ${Math.round(sorted.at(-1))} ms`;
};

let problems = 0;

if (process.argv.includes("--reader-only")) {
  // Let the flood build up first, then read through it until it stops.
  const stop = Date.now() + SECONDS * 1000;
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const times = Object.fromEntries(READING.map((path) => [path, []]));
  const notes = [];
  while (Date.now() < stop) {
    for (const path of READING) {
      const result = await get(path, undefined, READER);
      times[path].push(result.ms);
      if (result.status !== 200) notes.push(`  during: ${path} answered ${result.status}`);
      if (result.status !== 200 || result.ms >= READ_BUDGET_MS) problems += 1;
    }
  }
  process.stdout.write(JSON.stringify({ times, notes, problems }));
  process.exit(0);
}

async function readingRound(label, rounds) {
  const times = Object.fromEntries(READING.map((path) => [path, []]));
  for (let round = 0; round < rounds; round += 1) {
    for (const path of READING) {
      const result = await get(path, undefined, READER);
      times[path].push(result.ms);
      if (result.status !== 200) {
        console.log(`  ${label}: ${path} answered ${result.status}`);
        problems += 1;
      }
      if (result.ms >= READ_BUDGET_MS) problems += 1;
    }
  }
  for (const path of READING) console.log(`  ${label.padEnd(7)} ${path.padEnd(22)} ${summary(times[path])}`);
}

console.log(`target ${TARGET} · reader ${READER} · ${USERS} users · ${SECONDS} s · ${ONE_ADDRESS ? "one address" : "an address each"}`);

console.log("\n1. before the flood");
await readingRound("before", 5);

console.log(`\n2. the flood`);
const stopAt = Date.now() + SECONDS * 1000;
const outcomes = {};
const searchTimes = {};
let sent = 0;
const user = async (n) => {
  let i = n;
  while (Date.now() < stopAt) {
    const q = encodeURIComponent(HEAVY[i % HEAVY.length]);
    i += 1;
    sent += 1;
    const result = await get(`/search?q=${q}`, ONE_ADDRESS ? address(0) : address(n));
    const outcome = searchOutcome(result);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    (searchTimes[outcome] ??= []).push(result.ms);
  }
};
/**
 * The reader runs in a process of its own: timed from inside this one, its
 * page loads would include the time this process spends parsing fifty flood
 * responses a second, and the numbers would be about the client, not the site.
 */
const reader = new Promise((resolve) => {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--reader-only", `--seconds=${SECONDS}`], {
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  child.on("close", () => resolve(JSON.parse(out)));
});
const [read] = await Promise.all([reader, ...Array.from({ length: USERS }, (_, n) => user(n))]);
for (const path of READING) console.log(`  during  ${path.padEnd(22)} ${summary(read.times[path])}`);
for (const line of read.notes) console.log(line);
problems += read.problems;
console.log(`  searches sent: ${sent} (${(sent / SECONDS).toFixed(1)} a second)`);
for (const [outcome, count] of Object.entries(outcomes)) {
  console.log(`  search ${outcome.padEnd(8)} ${String(count).padStart(5)}   ${summary(searchTimes[outcome])}`);
  if (!["results", "busy"].includes(outcome)) problems += count;
}

console.log("\n3. after the flood");
await new Promise((resolve) => setTimeout(resolve, 3000));
await readingRound("after", 3);
const last = await get(`/search?q=${encodeURIComponent(HEAVY[0])}`, address(9999));
console.log(`  after   one search: ${searchOutcome(last)} in ${Math.round(last.ms)} ms (HTTP ${last.status})`);
if (searchOutcome(last) !== "results") problems += 1;

console.log(problems === 0 ? "\nPASS" : `\nFAIL — ${problems} problem(s)`);
process.exit(problems === 0 ? 0 : 1);
