import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { MOCK_SERVICE_KEY, MOCK_SUPABASE_PORT, MOCK_SUPABASE_URL } from "../env";
import { hookEvent, installAccountSchema } from "./pglite-auth";

/**
 * A stand-in for the Supabase project, for the sign-in and registration
 * specs (tests/auth-flows.spec.ts).
 *
 * Those specs exercise Server Actions, which call Supabase from the Next
 * server rather than from the browser, so `page.route` cannot reach them. The
 * `auth-flow-*` projects therefore run their own dev server on :3300 whose
 * NEXT_PUBLIC_SUPABASE_URL points here (playwright.config.ts). Nothing in
 * these specs ever reaches the real project: no signup, no email, no row.
 *
 * What it answers:
 *   - Auth (GoTrue): signup, password sign-in, recover, resend, verify, the
 *     user endpoint, logout — with the error shapes supabase-js parses, and a
 *     queue of scripted errors a test can put in front of any of them. A NEW
 *     user's signup first goes through the REAL Before User Created hook
 *     (migration 0027), called as supabase_auth_admin exactly as Auth calls
 *     it, and a refusal comes back the way Auth passes it on.
 *   - The account rules' SQL, executed by the REAL migrations 0026 and 0027
 *     and the generated domain seed in PGlite (tests/fixtures/pglite-auth.ts):
 *     the four auth_attempt_* functions and the /admin card's two, as
 *     PostgREST would run them — as service_role for the service key, as
 *     anon otherwise. Every user here is mirrored into that auth.users and
 *     profiles, so the hook's brake and the card count what the tests made.
 *   - PostgREST reads and writes of `settings` and `profiles`, with the
 *     project's row rules in miniature: anyone reads a public setting, a
 *     signed-in reader reads their own profile, the service role does
 *     anything. Every other table is empty, which is what a fresh project
 *     holds.
 *   - On request (PROMPT-40, tests/search-flood.spec.ts): any RPC can be given
 *     a fixed answer — the search slots' HTTP 429 `PT429 bh:search_busy`, or
 *     a page of results — and any table can be made to fail, which is what a
 *     database that does not answer looks like to the site's loaders.
 *   - On request (tests/notes-unavailable.spec.ts): any other table can be
 *     given fixed rows to answer every read with — a writer's notes, say.
 *
 * Every Auth call is recorded, so a spec can assert what was — and was not —
 * sent to Supabase.
 */

export type AuthEndpoint = "signup" | "token" | "recover" | "resend" | "verify" | "user";

export type AuthCall = { endpoint: AuthEndpoint; method: string; body: Record<string, unknown> };

export type ScriptedError = { status: number; code: string; message: string };

export type MockRole = "admin" | "uploader" | "reader";

type MockUser = {
  id: string;
  email: string;
  password: string;
  confirmed: boolean;
  displayName: string;
  createdAt: string;
};

/** The functions PostgREST may call here; each runs for real in PGlite. */
const SQL_FUNCTIONS = new Set([
  "auth_attempt_status",
  "auth_attempt_fail",
  "auth_attempt_clear",
  "auth_attempt_sweep",
  "account_security_stats",
  "unconfirmed_accounts_to_sweep",
]);
/** …and the one of them that returns a set of rows rather than a value. */
const SET_RETURNING = new Set(["unconfirmed_accounts_to_sweep"]);

/** The columns a query may name, per table — anything else is refused. */
const COLUMNS: Record<string, Set<string>> = {
  settings: new Set(["key", "value", "is_public", "updated_at"]),
  profiles: new Set(["id", "role", "display_name", "created_at"]),
};

type Caller = { role: "service_role" | "anon" | "authenticated"; userId: string | null };

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export class SupabaseMock {
  private server: Server | null = null;
  private db: PGlite | null = null;
  private users = new Map<string, MockUser>();
  private sessions = new Map<string, string>();
  private refreshTokens = new Map<string, string>();
  private recoveryTokens = new Map<string, string>();
  private confirmationTokens = new Map<string, string>();
  private scripted = new Map<AuthEndpoint, ScriptedError[]>();
  private rpcAnswers = new Map<string, { status: number; body: unknown }>();
  private failingTables = new Map<string, { status: number; body: unknown }>();
  private tableAnswers = new Map<string, unknown[]>();
  readonly calls: AuthCall[] = [];
  /** Every RPC asked for, by name, in order — to prove one was or was not called. */
  readonly rpcCalls: string[] = [];

  async start(): Promise<void> {
    this.db = await new PGlite();
    await installAccountSchema(this.db);
    this.server = createServer((request, response) => {
      this.handle(request, response).catch((error: unknown) => {
        this.send(response, 500, { code: "mock_failure", msg: String(error) });
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(MOCK_SUPABASE_PORT, "127.0.0.1", () => resolve());
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
    await this.db?.close();
    this.db = null;
  }

  /** A clean project: no users, no calls, no counted failures, both switches off. */
  async reset(): Promise<void> {
    this.users.clear();
    this.sessions.clear();
    this.refreshTokens.clear();
    this.recoveryTokens.clear();
    this.confirmationTokens.clear();
    this.scripted.clear();
    this.rpcAnswers.clear();
    this.failingTables.clear();
    this.tableAnswers.clear();
    this.calls.length = 0;
    this.rpcCalls.length = 0;
    await this.db!.exec(`
      delete from public.auth_attempts;
      delete from auth.users;
      delete from public.settings where key not in ('registration_paused', 'unconfirmed_sweep_enabled');
      update public.settings set value = 'false'::jsonb;
    `);
  }

  /** Answer every call of `fn` with this, until reset or cleared. */
  answerRpc(fn: string, status: number, body: unknown): void {
    this.rpcAnswers.set(fn, { status, body });
  }

  /** The answer migration 0028 gives when every search slot is in use. */
  answerRpcBusy(fn: string): void {
    this.answerRpc(fn, 429, {
      code: "PT429",
      message: "bh:search_busy",
      details: "every slot in search pool 1 is in use",
      hint: null,
    });
  }

  clearRpc(fn: string): void {
    this.rpcAnswers.delete(fn);
  }

  /** Every read of `table` fails like a database that is not answering. */
  failTable(table: string, status = 503): void {
    this.failingTables.set(table, {
      status,
      body: { code: "PGRST003", message: "Timed out acquiring connection from connection pool.", details: null, hint: null },
    });
  }

  clearTable(table: string): void {
    this.failingTables.delete(table);
  }

  /**
   * Every read of `table` answers these rows, whatever it filtered on, until
   * reset — unless the table is also made to fail, which wins.
   */
  answerTable(table: string, rows: unknown[]): void {
    this.tableAnswers.set(table, rows);
  }

  /** An existing account — confirmed unless said otherwise — with its profile. */
  async addUser(email: string, password: string, confirmed = true, role: MockRole = "reader"): Promise<void> {
    const user: MockUser = {
      id: randomUUID(),
      email: email.toLowerCase(),
      password,
      confirmed,
      displayName: "",
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.email, user);
    await this.mirror(user, role);
  }

  /**
   * Unconfirmed sign-ups made `minutesAgo` — rows only, nobody can sign in
   * with them: what an attack leaves behind, for the automatic brake.
   */
  async addUnconfirmedSignups(count: number, minutesAgo = 5): Promise<void> {
    await this.db!.query(
      `insert into auth.users (email, created_at)
       select 'burst-' || n || '-' || $3 || '@example.com', now() - make_interval(mins => $2)
         from generate_series(1, $1::int) as n`,
      [count, minutesAgo, randomBytes(4).toString("hex")],
    );
  }

  /** Move every account's creation time back, as if `minutes` had passed. */
  async age(minutes: number): Promise<void> {
    await this.db!.query("update auth.users set created_at = created_at - make_interval(mins => $1)", [minutes]);
  }

  async setting(key: string): Promise<unknown> {
    const { rows } = await this.db!.query<{ value: unknown }>("select value from public.settings where key = $1", [key]);
    return rows[0]?.value;
  }

  async setSetting(key: string, value: unknown, isPublic = false): Promise<void> {
    await this.db!.query(
      `insert into public.settings (key, value, is_public) values ($1, $2::jsonb, $3)
       on conflict (key) do update set value = excluded.value, is_public = excluded.is_public`,
      [key, JSON.stringify(value), isPublic],
    );
  }

  /** Run SQL against the fake project directly — to change a domain list, say. */
  async sql(statement: string, params: unknown[] = []): Promise<void> {
    await this.db!.query(statement, params);
  }

  async accountCount(): Promise<number> {
    const { rows } = await this.db!.query<{ n: number }>("select count(*)::int as n from auth.users");
    return rows[0].n;
  }

  /** The next call to `endpoint` fails like this, once. */
  failNext(endpoint: AuthEndpoint, error: ScriptedError): void {
    const queue = this.scripted.get(endpoint) ?? [];
    queue.push(error);
    this.scripted.set(endpoint, queue);
  }

  /** The token_hash a recovery email would carry — nothing is sent anywhere. */
  recoveryLink(email: string): string {
    const tokenHash = randomBytes(16).toString("hex");
    this.recoveryTokens.set(tokenHash, email.toLowerCase());
    return `/auth/confirm?token_hash=${tokenHash}&type=recovery`;
  }

  /** And the one a confirmation email would carry: following it confirms the account. */
  confirmationLink(email: string): string {
    const tokenHash = randomBytes(16).toString("hex");
    this.confirmationTokens.set(tokenHash, email.toLowerCase());
    return `/auth/confirm?token_hash=${tokenHash}&type=email`;
  }

  callsTo(endpoint: AuthEndpoint): AuthCall[] {
    return this.calls.filter((call) => call.endpoint === endpoint);
  }

  passwordOf(email: string): string | undefined {
    return this.users.get(email.toLowerCase())?.password;
  }

  /** A user as the database sees one: a row in auth.users and its profile. */
  private async mirror(user: MockUser, role: MockRole): Promise<void> {
    await this.db!.query(
      `insert into auth.users (id, email, created_at, email_confirmed_at)
       values ($1, $2, $3, case when $4 then $3::timestamptz end)`,
      [user.id, user.email, user.createdAt, user.confirmed],
    );
    await this.db!.query("insert into public.profiles (id, role) values ($1, $2)", [user.id, role]);
  }

  /** Supabase Auth's call to the Before User Created hook, and its answer. */
  private async beforeUserCreated(email: string): Promise<{ http_code: number; message: string } | null> {
    const answer = await this.db!.transaction(async (tx) => {
      await tx.exec("set local role supabase_auth_admin");
      const { rows } = await tx.query<{ out: { error?: { http_code: number; message: string } } }>(
        "select public.hook_before_user_created($1::jsonb) as out",
        [hookEvent(email)],
      );
      return rows[0].out;
    });
    return answer.error ?? null;
  }

  async counterRows(): Promise<number> {
    const { rows } = await this.db!.query<{ n: number }>("select count(*)::int as n from public.auth_attempts");
    return rows[0].n;
  }

  /* ── HTTP ────────────────────────────────────────────────────────────── */

  private cors(response: ServerResponse): void {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "*");
    response.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS");
    response.setHeader("access-control-expose-headers", "content-range, x-supabase-api-version");
  }

  private send(response: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
    this.cors(response);
    response.setHeader("x-supabase-api-version", "2024-01-01");
    // No keep-alive. Each project's worker starts its own fake on the same
    // port, and the Next server once reused a socket from the previous one:
    // "fetch failed", silently changing what that test exercised.
    response.setHeader("connection", "close");
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    if (body === undefined) {
      response.writeHead(status);
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.writeHead(status);
    response.end(JSON.stringify(body));
  }

  private authError(response: ServerResponse, error: ScriptedError): void {
    this.send(response, error.status, { code: error.code, error_code: error.code, msg: error.message });
  }

  private async body(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private userJson(user: MockUser) {
    const confirmedAt = user.confirmed ? user.createdAt : null;
    return {
      id: user.id,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      email_confirmed_at: confirmedAt,
      confirmed_at: confirmedAt,
      phone: "",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: { display_name: user.displayName },
      identities: [],
      created_at: user.createdAt,
      updated_at: user.createdAt,
      is_anonymous: false,
    };
  }

  private session(user: MockUser) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = base64url(
      JSON.stringify({
        sub: user.id,
        email: user.email,
        aud: "authenticated",
        role: "authenticated",
        iat: now,
        exp: now + 3600,
        session_id: randomUUID(),
      }),
    );
    const accessToken = `${header}.${payload}.${randomBytes(16).toString("base64url")}`;
    const refreshToken = randomBytes(12).toString("hex");
    this.sessions.set(accessToken, user.email);
    this.refreshTokens.set(refreshToken, user.email);
    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: refreshToken,
      user: this.userJson(user),
    };
  }

  private bearer(request: IncomingMessage): string {
    const header = request.headers.authorization ?? "";
    return header.startsWith("Bearer ") ? header.slice(7) : "";
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", MOCK_SUPABASE_URL);
    const method = request.method ?? "GET";
    if (method === "OPTIONS") return this.send(response, 204);

    if (url.pathname.startsWith("/auth/v1/")) {
      return this.auth(url, method, await this.body(request), request, response);
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      return this.rpc(url.pathname.slice("/rest/v1/rpc/".length), await this.body(request), request, response);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      const failure = this.failingTables.get(table);
      if (failure) return this.send(response, failure.status, failure.body);
      const rows = this.tableAnswers.get(table);
      if (rows && method === "GET") {
        return this.send(response, 200, rows, { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` });
      }
      if (table in COLUMNS) return this.rest(table, url, method, await this.body(request), request, response);
      // A fresh project: every other table is empty.
      if (method === "HEAD") return this.send(response, 200, undefined, { "content-range": "*/0" });
      if (method === "GET") return this.send(response, 200, [], { "content-range": "*/0" });
      return this.send(response, 201, []);
    }
    return this.send(response, 404, { message: "not mocked" });
  }

  private async auth(
    url: URL,
    method: string,
    body: Record<string, unknown>,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const name = url.pathname.slice("/auth/v1/".length);
    const endpoint = (name.split("/")[0] || "user") as AuthEndpoint;
    if (["signup", "token", "recover", "resend", "verify", "user"].includes(endpoint)) {
      const recorded = { ...body };
      delete recorded.password;
      this.calls.push({ endpoint, method, body: recorded });
      const scripted = this.scripted.get(endpoint)?.shift();
      if (scripted) return this.authError(response, scripted);
    }
    const email = typeof body.email === "string" ? body.email.toLowerCase() : "";

    switch (name) {
      case "signup": {
        const existing = this.users.get(email);
        if (existing) return this.send(response, 200, { ...this.userJson(existing), identities: [] });
        // Only a NEW user goes through the hook; Auth passes its refusal on
        // under its generic code, with the hook's own message.
        const refusal = await this.beforeUserCreated(email);
        if (refusal) {
          return this.authError(response, { status: refusal.http_code, code: "unknown", message: refusal.message });
        }
        const data = (body.data ?? {}) as { display_name?: string };
        const user: MockUser = {
          id: randomUUID(),
          email,
          password: String(body.password ?? ""),
          confirmed: false,
          displayName: data.display_name ?? "",
          createdAt: new Date().toISOString(),
        };
        this.users.set(email, user);
        await this.mirror(user, "reader");
        return this.send(response, 200, this.userJson(user));
      }
      case "token": {
        const grant = url.searchParams.get("grant_type");
        if (grant === "refresh_token") {
          const owner = this.refreshTokens.get(String(body.refresh_token ?? ""));
          const user = owner ? this.users.get(owner) : undefined;
          if (!user) return this.authError(response, { status: 400, code: "refresh_token_not_found", message: "Invalid Refresh Token" });
          return this.send(response, 200, this.session(user));
        }
        const user = this.users.get(email);
        if (!user || user.password !== body.password) {
          return this.authError(response, { status: 400, code: "invalid_credentials", message: "Invalid login credentials" });
        }
        if (!user.confirmed) {
          return this.authError(response, { status: 400, code: "email_not_confirmed", message: "Email not confirmed" });
        }
        return this.send(response, 200, this.session(user));
      }
      case "recover":
      case "resend":
        return this.send(response, 200, {});
      case "verify": {
        const tokenHash = String(body.token_hash ?? "");
        const owner = this.recoveryTokens.get(tokenHash) ?? this.confirmationTokens.get(tokenHash);
        const user = owner ? this.users.get(owner) : undefined;
        if (!user) return this.authError(response, { status: 403, code: "otp_expired", message: "Email link is invalid or has expired" });
        if (this.confirmationTokens.delete(tokenHash)) {
          user.confirmed = true;
          await this.db!.query("update auth.users set email_confirmed_at = now() where id = $1", [user.id]);
        }
        this.recoveryTokens.delete(tokenHash);
        return this.send(response, 200, this.session(user));
      }
      case "user": {
        const owner = this.sessions.get(this.bearer(request));
        const user = owner ? this.users.get(owner) : undefined;
        if (!user) return this.authError(response, { status: 401, code: "bad_jwt", message: "invalid JWT" });
        if (method === "PUT") {
          if (typeof body.password === "string") user.password = body.password;
        }
        return this.send(response, 200, this.userJson(user));
      }
      case "logout":
        this.sessions.delete(this.bearer(request));
        return this.send(response, 204);
      default:
        return this.send(response, 404, { message: `auth endpoint ${name} not mocked` });
    }
  }

  /** Who is asking, from the key or the session token on the request. */
  private caller(request: IncomingMessage): Caller {
    const token = this.bearer(request);
    if (token === MOCK_SERVICE_KEY) return { role: "service_role", userId: null };
    const owner = this.sessions.get(token);
    const user = owner ? this.users.get(owner) : undefined;
    return user ? { role: "authenticated", userId: user.id } : { role: "anon", userId: null };
  }

  /**
   * PostgREST for `settings` and `profiles`: `select`, `eq` and `in`
   * filters, an upsert, and an update — enough for what the site asks of
   * them, with the project's row rules in miniature.
   */
  private async rest(
    table: string,
    url: URL,
    method: string,
    body: Record<string, unknown> | Record<string, unknown>[],
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const columns = COLUMNS[table];
    const who = this.caller(request);
    const where: string[] = [];
    const params: unknown[] = [];
    for (const [name, raw] of url.searchParams) {
      if (["select", "on_conflict", "limit", "order"].includes(name)) continue;
      if (!columns.has(name)) return this.send(response, 400, { code: "PGRST100", message: `unknown column ${name}` });
      if (raw.startsWith("eq.")) {
        params.push(raw.slice(3));
        where.push(`${name}::text = $${params.length}`);
      } else if (raw.startsWith("in.(") && raw.endsWith(")")) {
        params.push(raw.slice(4, -1).split(",").map((value) => value.replace(/^"|"$/g, "")));
        where.push(`${name}::text = any($${params.length})`);
      } else {
        return this.send(response, 400, { code: "PGRST100", message: `unsupported filter ${raw}` });
      }
    }
    // The row rules: anyone reads a public setting; a signed-in reader reads
    // their own profile; only the service role writes.
    if (who.role !== "service_role") {
      if (method !== "GET" && method !== "HEAD") return this.send(response, 401, { code: "42501", message: "permission denied" });
      if (table === "settings") where.push("is_public");
      if (table === "profiles") {
        params.push(who.userId ?? "00000000-0000-0000-0000-000000000000");
        where.push(`id = $${params.length}::uuid`);
      }
    }
    const filter = where.length ? ` where ${where.join(" and ")}` : "";

    if (method === "GET" || method === "HEAD") {
      const wanted = (url.searchParams.get("select") ?? "*").split(",").map((name) => name.trim());
      if (!wanted.every((name) => name === "*" || columns.has(name))) {
        return this.send(response, 400, { code: "PGRST100", message: "unknown column in select" });
      }
      const { rows } = await this.db!.query(`select ${wanted.join(", ")} from public.${table}${filter}`, params);
      const range = { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` };
      if (method === "HEAD") return this.send(response, 200, undefined, range);
      return this.send(response, 200, rows, range);
    }

    if (method === "POST" && table === "settings") {
      for (const row of Array.isArray(body) ? body : [body]) {
        await this.setSetting(String(row.key), row.value ?? null, row.is_public === true);
      }
      return this.send(response, 201);
    }

    if (method === "PATCH" && table === "profiles" && !Array.isArray(body) && typeof body.role === "string") {
      params.push(body.role);
      await this.db!.query(`update public.profiles set role = $${params.length}${filter}`, params);
      return this.send(response, 204);
    }

    return this.send(response, 405, { code: "PGRST000", message: `${method} ${table} not mocked` });
  }

  /**
   * PostgREST's /rpc: the account rules' functions run for real, as the role
   * the key maps to; anything else answers like an empty project.
   */
  private async rpc(
    fn: string,
    body: Record<string, unknown>,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    this.rpcCalls.push(fn);
    const answer = this.rpcAnswers.get(fn);
    if (answer) return this.send(response, answer.status, answer.body);
    if (!SQL_FUNCTIONS.has(fn)) return this.send(response, 200, []);
    const names = Object.keys(body);
    if (!names.every((key) => /^p_[a-z_]+$/.test(key))) {
      return this.send(response, 400, { code: "PGRST100", message: "bad argument name" });
    }
    const role = this.caller(request).role === "service_role" ? "service_role" : "anon";
    const call = `public.${fn}(${names.map((key, index) => `${key} => $${index + 1}`).join(", ")})`;
    const sql = SET_RETURNING.has(fn) ? `select result from ${call} as result` : `select ${call} as result`;
    try {
      const result = await this.db!.transaction(async (tx) => {
        await tx.exec(`set local role ${role}`);
        return tx.query<{ result: unknown }>(sql, names.map((key) => body[key]));
      });
      if (SET_RETURNING.has(fn)) return this.send(response, 200, result.rows.map((row) => row.result));
      const value = result.rows[0]?.result ?? null;
      if (fn === "auth_attempt_clear") return this.send(response, 204);
      return this.send(response, 200, value instanceof Date ? value.toISOString() : value);
    } catch (error) {
      const code = (error as { code?: string }).code ?? "XX000";
      return this.send(response, code === "42501" ? 401 : 400, {
        code,
        message: (error as Error).message,
        details: null,
        hint: null,
      });
    }
  }
}
