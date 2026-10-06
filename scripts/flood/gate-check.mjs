#!/usr/bin/env node
/**
 * The search slots of migration 0028, tested against a REAL Postgres with real
 * concurrent sessions — the one thing PGlite (a single session) cannot do.
 *
 *   node scripts/flood/stack.mjs up && node scripts/flood/stack.mjs seed
 *   node scripts/flood/gateway.mjs            (in another terminal)
 *   node scripts/flood/gate-check.mjs
 *
 * LOCAL ONLY. It talks to the throwaway stack scripts/flood/stack.mjs builds
 * (Supabase's own Postgres image + PostgREST, the versions the live project
 * runs) and refuses any address that is not 127.0.0.1. Never point it at the
 * live project: holding search slots there is exactly what a flood does.
 *
 * What it proves, each as its own numbered check:
 *   1. with both whole-library slots held by other sessions, a whole-library
 *      search is refused — PT429 / bh:search_busy, HTTP 429 — in < 200 ms;
 *   2. … while a one-category search, the reader's navigator and the Qur'an
 *      search still answer (separate pools);
 *   3. with ONE of the two held, a whole-library search still answers: the
 *      pool really has two slots, and the refusal is the third caller;
 *   4. a slot comes back after its holder COMMITS;
 *   5. … after its holder's statement ERRORS;
 *   6. … after its holder hits the statement timeout (the anon role's 3 s
 *      is what a real search runs into);
 *   7. … after its holder's backend is terminated (a crashed request);
 *   8. a burst of 30 concurrent whole-library searches gets only results and
 *      refusals — never a 5xx — and at least one refusal.
 * Exits non-zero when any check fails.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".flood", "local.env"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(/=(.*)/s).slice(0, 2)),
);
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE ?? "")) {
  console.error(`refusing: ${BASE} is not the local stack`);
  process.exit(2);
}
const CONTAINER = process.env.BH_FLOOD_DB ?? "bh-flood-db";

/** The namespace and pools of migration 0028. */
const NS = 20261005;
const WHOLE = [101, 102];

/** A heavy word on any library: on most pages, so 301 candidates are ranked. */
const HEAVY = "پەيغەمبەر";

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function rpc(fn, args) {
  const started = performance.now();
  const response = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  const ms = Math.round(performance.now() - started);
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, ms, body };
}

const isBusy = (result) =>
  result.status === 429 && result.body?.code === "PT429" && result.body?.message === "bh:search_busy";

/** One psql session inside the database container, fed through stdin. */
function psql(sql, { background = false } = {}) {
  const child = spawn(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-h", "127.0.0.1", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=0"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (err += chunk));
  child.stdin.end(sql);
  const done = new Promise((resolve) => child.on("close", (code) => resolve({ code, out, err })));
  return background ? { done } : done;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Advisory locks in 0028's namespace held by anyone right now. */
async function heldSlots() {
  const { out } = await psql(
    `select coalesce(string_agg(objid::text, ',' order by objid), '') from pg_locks where locktype = 'advisory' and classid = ${NS} and granted;`,
  );
  return out.trim();
}

async function waitForSlots(expected) {
  for (let i = 0; i < 100; i += 1) {
    if ((await heldSlots()) === expected) return true;
    await sleep(50);
  }
  return false;
}

/** Hold the given slots in another session for `seconds`, inside one transaction. */
function hold(slots, seconds) {
  const takes = slots.map((slot) => `select pg_advisory_xact_lock(${NS}, ${slot});`).join("\n");
  return psql(`begin;\n${takes}\nselect pg_sleep(${seconds});\ncommit;\n`, { background: true });
}

const whole = () => rpc("search_books", { q: HEAVY, category_id: null, lim: 21, off: 0 });

// ── 0. The stack answers, and nothing is held ───────────────────────────────
const warm = await whole();
check("0. a whole-library search answers on an idle stack", warm.status === 200, `HTTP ${warm.status}, ${warm.ms} ms`);
check("0. no slot is held before the checks", (await heldSlots()) === "", await heldSlots());

// ── 1–2. Both whole-library slots held elsewhere ────────────────────────────
{
  const holder = hold(WHOLE, 4);
  check("   (both whole-library slots are now held by another session)", await waitForSlots("101,102"));
  const refused = await whole();
  check(
    "1. the third whole-library search is refused as busy, fast",
    isBusy(refused) && refused.ms < 200,
    `HTTP ${refused.status} ${JSON.stringify(refused.body).slice(0, 90)} in ${refused.ms} ms`,
  );
  const category = await rpc("search_books", { q: HEAVY, category_id: 1, lim: 21, off: 0 });
  check("2. a one-category search still answers", category.status === 200, `HTTP ${category.status}, ${category.ms} ms`);
  const navigator = await rpc("book_match_pages", { book_id: 22, q: HEAVY, lim: 500 });
  check("2. the reader's navigator still answers", navigator.status === 200, `HTTP ${navigator.status}, ${navigator.ms} ms`);
  const quran = await rpc("search_quran", { q: "الله", lim: 21, off: 0 });
  check("2. the Qur'an search still answers", quran.status === 200, `HTTP ${quran.status}, ${quran.ms} ms`);
  await holder.done;
  // ── 4. after commit ───────────────────────────────────────────────────────
  check("4. the slots are free once the holder commits", (await heldSlots()) === "");
  const after = await whole();
  check("4. … and a whole-library search answers again", after.status === 200, `HTTP ${after.status}`);
}

// ── 3. One of the two held ──────────────────────────────────────────────────
{
  const holder = hold([101], 3);
  await waitForSlots("101");
  const second = await whole();
  check("3. with one slot held, a second concurrent search still answers", second.status === 200, `HTTP ${second.status}, ${second.ms} ms`);
  await holder.done;
}

// ── 5. After an error ───────────────────────────────────────────────────────
{
  const { out } = await psql(
    [
      "begin;",
      `select count(*) >= 0 from public.search_books('${HEAVY}', null, 1, 0);`,
      `select count(*) from pg_locks where locktype = 'advisory' and classid = ${NS} and pid = pg_backend_pid();`,
      "select 1 / 0;",
      "rollback;",
    ].join("\n"),
  );
  const lines = out.trim().split(/\r?\n/);
  check("5. a search holds its slot until its transaction ends", lines[1] === "1", `held inside: ${lines.join(" | ")}`);
  check("5. the slot is free after the transaction errors", (await heldSlots()) === "", await heldSlots());
}

// ── 6. After a statement timeout ────────────────────────────────────────────
{
  const { err } = await psql(
    "set statement_timeout = '600ms';\nselect private.take_search_slot(1, 2), pg_sleep(3);\n",
  );
  check("6. a slot holder can run into the statement timeout", /statement timeout/.test(err), err.trim().split("\n")[0]);
  check("6. the slot is free after the timeout", (await heldSlots()) === "", await heldSlots());
}

// ── 7. After the holder's backend dies ──────────────────────────────────────
{
  const holder = hold(WHOLE, 60);
  await waitForSlots("101,102");
  const { out } = await psql(
    `select pg_terminate_backend(pid) from pg_locks where locktype = 'advisory' and classid = ${NS} and granted limit 1;`,
  );
  await holder.done;
  check("7. the holding backend was terminated", out.trim() === "t");
  check("7. its slots are free at once", await waitForSlots(""), await heldSlots());
  const after = await whole();
  check("7. … and a whole-library search answers", after.status === 200, `HTTP ${after.status}`);
}

// ── 8. A burst ──────────────────────────────────────────────────────────────
{
  const results = await Promise.all(Array.from({ length: 30 }, () => whole()));
  const ok = results.filter((r) => r.status === 200);
  const busy = results.filter(isBusy);
  const other = results.filter((r) => r.status !== 200 && !isBusy(r));
  const slowestBusy = Math.max(0, ...busy.map((r) => r.ms));
  check(
    "8. a burst of 30 gets results or busy, never anything else",
    other.length === 0 && busy.length > 0,
    `${ok.length} results, ${busy.length} busy (slowest refusal ${slowestBusy} ms incl. PostgREST's queue), ${other.length} other`,
  );
  check("8. nothing is held after the burst", await waitForSlots(""), await heldSlots());
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
