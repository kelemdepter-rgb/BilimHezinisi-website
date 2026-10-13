#!/usr/bin/env node
/**
 * Time the notebook's own search, search_my_notes (migration 0031), at the
 * size the task set for it: one writer with 200 notes of 60,000 characters.
 *
 *   node scripts/flood/stack.mjs up
 *   node scripts/flood/notes-search.mjs
 *
 * LOCAL ONLY. It writes to the throwaway database scripts/flood/stack.mjs
 * builds — through `docker exec`, as the SQL Editor's role — and asks
 * PostgREST on 127.0.0.1 as that one invented writer. Never production.
 *
 * Every note is invented: random words from a fixed list, every note ending
 * in «خەزىنە» and every tenth holding «يېشىل باغ» in its middle. Results:
 * docs/notes-search.md.
 */
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DB = process.env.BH_FLOOD_DB ?? "bh-flood-db";
const REST = "http://127.0.0.1:54330";
const WRITER = "cccccccc-0000-4000-8000-000000000047";

function psql(sql) {
  const result = spawnSync(
    "docker",
    ["exec", "-i", DB, "psql", "-v", "ON_ERROR_STOP=1", "-qAt", "-U", "postgres", "-h", "127.0.0.1", "-d", "postgres"],
    { input: sql, encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
  );
  if (result.status !== 0) throw new Error(`psql failed:\n${result.stderr}`);
  return result.stdout.trim();
}

const WORDS = [
  "بىلىم", "كىتاب", "ئوقۇش", "مەكتەپ", "ئۇستاز", "ئوقۇغۇچى", "تارىخ", "مەدەنىيەت", "تىل", "ئەدەبىيات",
  "شېئىر", "ھېكايە", "ۋەتەن", "ئانا", "دادا", "بالا", "ئائىلە", "دوست", "يول", "سەپەر",
  "تاغ", "دەريا", "ئاسمان", "يۇلتۇز", "ئاي", "كۈن", "ئەتىگەن", "كەچ", "باھار", "كۈز",
  "ئىلىم", "ھېكمەت", "نەسىھەت", "ئەخلاق", "ئادەم", "جەمئىيەت", "ئىقتىساد", "سودا", "ئىش", "ئەمگەك",
  "بۇ", "ئۇ", "ۋە", "بىلەن", "ئۈچۈن", "ھەم", "لېكىن", "چۈنكى", "ئەگەر", "بولسا",
  "قىلىش", "كېلىش", "بېرىش", "ئېلىش", "يېزىش", "سۆزلەش", "ئويلاش", "كۆرۈش", "بىلىش", "ئىشلەش",
  "ياخشى", "چىرايلىق", "چوڭ", "كىچىك", "يېڭى", "كونا", "ئۇزۇن", "قىسقا", "ئېگىز", "پەس",
];

console.log("seeding 200 notes of 60,000 characters …");
psql(`
  insert into auth.users (id, email, email_confirmed_at)
  values ('${WRITER}', 'bh-notes-timing@example.com', now()) on conflict (id) do nothing;
  insert into public.profiles (id) values ('${WRITER}') on conflict (id) do nothing;
  delete from public.note_documents where user_id = '${WRITER}';
  with vocab as (select array[${WORDS.map((word) => `'${word}'`).join(",")}] as w),
  bodies as (
    select n,
           (select string_agg(v.w[1 + floor(random() * ${WORDS.length})::int]
                              || case when g % 17 = 0 then E'\\n' else ' ' end, '')
              from vocab v, generate_series(1, 10600) as g
             where n > 0) as raw
      from generate_series(1, 200) as n
  )
  insert into public.note_documents (user_id, title, content_html, content_text)
  select '${WRITER}', 'سىناق خاتىرىسى ' || n, '<div>' || t || '</div>', t
    from (select n,
                 left(case when n % 10 = 0 then left(raw, 30000) || ' يېشىل باغ ' || substr(raw, 30001) else raw end, 59993)
                   || ' خەزىنە' as t
            from bodies) s;
  analyze public.note_documents;
`);
console.log(
  psql(`select count(*) || ' notes, ' || min(content_length) || '–' || max(content_length) || ' characters, '
               || pg_size_pretty(sum(content_bytes)::bigint)
          from public.note_documents where user_id = '${WRITER}';`),
);

const secret = readFileSync(join(process.cwd(), ".flood", "jwt-secret.txt"), "utf8").trim();
const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const head = part({ alg: "HS256", typ: "JWT" });
const body = part({ iss: "bh-flood-local", iat: 1790000000, exp: 1990000000, role: "authenticated", sub: WRITER });
const jwt = `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;

async function once(query) {
  const started = performance.now();
  const response = await fetch(`${REST}/rpc/search_my_notes`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ p_query: query }),
  });
  const rows = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(rows)}`);
  return { ms: performance.now() - started, rows: rows.length };
}

const CASES = [
  ["a word in every note", "خەزىنە"],
  ["a word in none", "زىمىستان"],
  ["a two-word phrase", "يېشىل باغ"],
  ["a 99-character phrase", "بىلىم كىتاب ئوقۇش مەكتەپ ئۇستاز ئوقۇغۇچى تارىخ مەدەنىيەت تىل ئەدەبىيات شېئىر ھېكايە ۋەتەن ئانا دادا"],
  ["hamza forms and tashkil", "أَنَا بِلِيمْ"],
];

await once(CASES[0][1]);
for (const [label, query] of CASES) {
  const runs = [];
  for (let index = 0; index < 7; index++) runs.push(await once(query));
  const ms = runs.map((run) => run.ms).sort((a, b) => a - b);
  console.log(
    `${label.padEnd(26)} ${String(runs[0].rows).padStart(2)} rows   min ${ms[0].toFixed(0)}   median ${ms[3].toFixed(0)}   max ${ms[6].toFixed(0)} ms`,
  );
}

// The plain definition the function is held to: strpos over ug_normalize of
// every note. Inside the database, no HTTP — for comparison only.
const plain = psql(`
  \\timing on
  select count(*) from public.note_documents d
   where d.user_id = '${WRITER}' and d.deleted_at is null
     and strpos(public.ug_normalize(d.title || E'\\n' || d.content_text), public.ug_normalize('زىمىستان')) > 0;
`);
console.log(`strpos over ug_normalize, same notes: ${plain.split("\n").find((line) => line.startsWith("Time"))}`);
