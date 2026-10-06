#!/usr/bin/env node
/**
 * A throwaway copy of the site's database, on this computer, for the flood
 * test and the search-slot checks (PROMPT-40, docs/search-flood.md).
 *
 *   node scripts/flood/stack.mjs up      Postgres + PostgREST in Docker, every migration applied
 *   node scripts/flood/gateway.mjs       (another terminal) the /rest/v1 gateway on :54339
 *   node scripts/flood/stack.mjs seed    the Qur'an and migration-data/library.db, tripled
 *   node scripts/flood/stack.mjs down    remove both containers and their network
 *
 * LOCAL ONLY. Never load-test the live site or the live Supabase project —
 * that is what took bilimhezinisi.com down on 2026-10-05 (CLAUDE.md).
 *
 * The same versions the live project reports: Supabase's own Postgres image
 * (PostgreSQL 17.6, with Supabase's roles and their 3 s / 8 s statement
 * timeouts) and PostgREST 14.5 with its default pool of 10 connections. The
 * database container is held to 0.66 CPU, which makes a single search take
 * about half its live time and the whole about as much throughput as the free
 * tier's two shared cores — measured, not assumed (docs/search-flood.md).
 *
 * Keys: a random JWT secret, and an anon and a service key signed with it,
 * are written to .flood/ (git-ignored). Nothing from .env.local is read or
 * used, so nothing here can reach the live project.
 *
 * The database keeps its data inside its container (this image does not use
 * the declared volume), so `down` — or removing the container — loses it;
 * `up` and `seed` rebuild it in a few minutes.
 */
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FLOOD = join(ROOT, ".flood");
const NETWORK = "bh-flood";
const DB = process.env.BH_FLOOD_DB ?? "bh-flood-db";
const REST = "bh-flood-rest";
const DB_IMAGE = "public.ecr.aws/supabase/postgres:17.6.1.143";
const REST_IMAGE = "postgrest/postgrest:v14.5";
const DB_PASSWORD = "flood-local-only";
const REST_PORT = 54330;
const GATEWAY = "http://127.0.0.1:54339";

function run(command, args, { input, check = true, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (check && result.status !== 0) {
    console.error(result.stdout, result.stderr);
    throw new Error(`${command} ${args.slice(0, 3).join(" ")} … failed`);
  }
  if (!quiet && result.stdout.trim()) console.log(result.stdout.trim());
  return result;
}

/** psql inside the database container, as `postgres` — the SQL Editor's role. */
function psql(sql, user = "postgres") {
  return run("docker", ["exec", "-i", DB, "psql", "-v", "ON_ERROR_STOP=1", "-qAt", "-U", user, "-h", "127.0.0.1", "-d", "postgres"], {
    input: sql,
    quiet: true,
  });
}

function sign(secret, payload) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = part({ alg: "HS256", typ: "JWT" });
  const body = part({ iss: "bh-flood-local", iat: 1790000000, exp: 1990000000, ...payload });
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

async function up() {
  mkdirSync(FLOOD, { recursive: true });
  const secret = randomBytes(32).toString("hex");
  writeFileSync(join(FLOOD, "jwt-secret.txt"), secret);
  writeFileSync(
    join(FLOOD, "local.env"),
    [
      `NEXT_PUBLIC_SUPABASE_URL=${GATEWAY}`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${sign(secret, { role: "anon" })}`,
      `SUPABASE_SERVICE_ROLE_KEY=${sign(secret, { role: "service_role" })}`,
      "ADMIN_EMAIL=bh-flood-admin@example.com",
    ].join("\n") + "\n",
  );

  run("docker", ["network", "create", NETWORK], { check: false, quiet: true });
  run("docker", ["rm", "-f", DB, REST], { check: false, quiet: true });
  // No host port: PostgREST reaches it on the private network, and the
  // checks go through `docker exec`.
  run("docker", ["run", "-d", "--name", DB, "--network", NETWORK, "--cpus=0.66", "--memory=1g", "--memory-swap=1g",
    "-e", `POSTGRES_PASSWORD=${DB_PASSWORD}`, DB_IMAGE], { quiet: true });
  for (let i = 0; i < 60; i += 1) {
    const health = run("docker", ["inspect", "-f", "{{.State.Health.Status}}", DB], { quiet: true }).stdout.trim();
    if (health === "healthy") break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  psql(`${readText("scripts/flood/bootstrap.sql")}\nalter role authenticator with password '${DB_PASSWORD}';`, "supabase_admin");
  const migrations = readdirSync(join(ROOT, "supabase", "migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) {
    psql(readText(join("supabase", "migrations", name)));
    console.log(`applied ${name}`);
  }

  run("docker", ["run", "-d", "--name", REST, "--network", NETWORK, "--cpus=0.5", "-p", `127.0.0.1:${REST_PORT}:3000`,
    "-e", `PGRST_DB_URI=postgres://authenticator:${DB_PASSWORD}@${DB}:5432/postgres`,
    "-e", "PGRST_DB_SCHEMAS=public,graphql_public", "-e", "PGRST_DB_EXTRA_SEARCH_PATH=public,extensions",
    "-e", "PGRST_DB_MAX_ROWS=1000", "-e", "PGRST_DB_ANON_ROLE=anon", "-e", `PGRST_JWT_SECRET=${secret}`,
    REST_IMAGE], { quiet: true });
  console.log(`\nup: ${DB} (PostgreSQL 17.6, 0.66 CPU) and ${REST} (PostgREST 14.5) on 127.0.0.1:${REST_PORT}`);
  console.log("next: node scripts/flood/gateway.mjs   (another terminal), then  node scripts/flood/stack.mjs seed");
}

async function seed() {
  const reachable = await fetch(`${GATEWAY}/rest/v1/`).then(() => true, () => false);
  if (!reachable) throw new Error(`the gateway is not answering on ${GATEWAY} — run node scripts/flood/gateway.mjs first`);
  if (!existsSync(join(ROOT, "migration-data", "library.db"))) {
    throw new Error("migration-data/library.db is missing — copy the desktop library there first");
  }
  const env = join(FLOOD, "local.env");
  for (const [script, args] of [
    ["scripts/seed-quran.mjs", []],
    ["scripts/migrate-from-desktop.mjs", ["--skip-pdf", "--import", "--publish"]],
  ]) {
    const result = spawnSync(process.execPath, [`--env-file=${env}`, script, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`${script} failed:\n${result.stdout}\n${result.stderr}`);
    console.log(result.stdout.trim().split("\n").slice(-2).join("\n"));
  }
  // Two more copies of every book: the live library had 17,601 pages on
  // 2026-09-11, the desktop copy about a third of that.
  psql(`
    do $$
    declare r record; v_new bigint; k int;
    begin
      for k in 1..2 loop
        for r in select * from public.books where file_hash not like 'flood-copy%' order by id loop
          insert into public.books (title, author, category_id, format, date, description, language,
                                    file_hash, page_count, status, content_format, published_at)
          values (r.title || ' (' || k || ')', r.author, r.category_id, r.format, r.date, r.description,
                  r.language, 'flood-copy' || k || '-' || r.file_hash, r.page_count, r.status,
                  r.content_format, r.published_at)
          returning id into v_new;
          insert into public.book_pages (book_id, page_no, content)
          select v_new, p.page_no, p.content from public.book_pages p where p.book_id = r.id;
        end loop;
      end loop;
    end $$;
    analyze public.book_pages;
    analyze public.books;
  `);
  const counted = psql("select count(*) || ' books, ' || sum(page_count) || ' pages' from public.books where status = 'published';");
  console.log(`seeded: ${counted.stdout.trim()}`);
}

function down() {
  run("docker", ["rm", "-f", DB, REST], { check: false, quiet: true });
  run("docker", ["network", "rm", NETWORK], { check: false, quiet: true });
  console.log("down: containers and network removed");
}

function readText(relative) {
  return readFileSync(join(ROOT, relative), "utf8");
}

const command = process.argv[2];
if (command === "up") await up();
else if (command === "seed") await seed();
else if (command === "down") down();
else {
  console.error("usage: node scripts/flood/stack.mjs up|seed|down");
  process.exit(2);
}
