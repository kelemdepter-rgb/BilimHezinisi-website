import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { MOCK_SERVICE_KEY, MOCK_SUPABASE_PORT, MOCK_SUPABASE_URL } from "../env";

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
 *     queue of scripted errors a test can put in front of any of them.
 *   - The attempt counter: the four auth_attempt_* functions, executed by the
 *     REAL migration 0026 in PGlite, as PostgREST would run them — as
 *     service_role for the service key, as anon otherwise.
 *   - Everything else PostgREST: empty, which is what a fresh project holds.
 *
 * Every Auth call is recorded, so a spec can assert what was — and was not —
 * sent to Supabase.
 */

export type AuthEndpoint = "signup" | "token" | "recover" | "resend" | "verify" | "user";

export type AuthCall = { endpoint: AuthEndpoint; method: string; body: Record<string, unknown> };

export type ScriptedError = { status: number; code: string; message: string };

type MockUser = {
  id: string;
  email: string;
  password: string;
  confirmed: boolean;
  displayName: string;
  createdAt: string;
};

const MIGRATION = join(process.cwd(), "supabase", "migrations", "0026_auth_attempts.sql");
const COUNTER_FUNCTIONS = new Set([
  "auth_attempt_status",
  "auth_attempt_fail",
  "auth_attempt_clear",
  "auth_attempt_sweep",
]);

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
  private scripted = new Map<AuthEndpoint, ScriptedError[]>();
  readonly calls: AuthCall[] = [];

  async start(): Promise<void> {
    this.db = await new PGlite();
    await this.db.exec("create role anon; create role authenticated; create role service_role;");
    await this.db.exec(readFileSync(MIGRATION, "utf8"));
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

  /** A clean project: no users, no calls, no counted failures. */
  async reset(): Promise<void> {
    this.users.clear();
    this.sessions.clear();
    this.refreshTokens.clear();
    this.recoveryTokens.clear();
    this.scripted.clear();
    this.calls.length = 0;
    await this.db!.exec("delete from public.auth_attempts");
  }

  addUser(email: string, password: string, confirmed = true): void {
    this.users.set(email.toLowerCase(), {
      id: randomUUID(),
      email: email.toLowerCase(),
      password,
      confirmed,
      displayName: "",
      createdAt: new Date().toISOString(),
    });
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

  callsTo(endpoint: AuthEndpoint): AuthCall[] {
    return this.calls.filter((call) => call.endpoint === endpoint);
  }

  passwordOf(email: string): string | undefined {
    return this.users.get(email.toLowerCase())?.password;
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
      // A fresh project: every table is empty.
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
        const owner = this.recoveryTokens.get(String(body.token_hash ?? ""));
        const user = owner ? this.users.get(owner) : undefined;
        if (!user) return this.authError(response, { status: 403, code: "otp_expired", message: "Email link is invalid or has expired" });
        this.recoveryTokens.delete(String(body.token_hash));
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

  /**
   * PostgREST's /rpc: the counter functions run for real, as the role the
   * key maps to; anything else answers like an empty project.
   */
  private async rpc(
    fn: string,
    body: Record<string, unknown>,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!COUNTER_FUNCTIONS.has(fn)) return this.send(response, 200, []);
    const names = Object.keys(body);
    if (!names.every((key) => /^p_[a-z_]+$/.test(key))) {
      return this.send(response, 400, { code: "PGRST100", message: "bad argument name" });
    }
    const role = this.bearer(request) === MOCK_SERVICE_KEY ? "service_role" : "anon";
    const sql = `select public.${fn}(${names.map((key, index) => `${key} => $${index + 1}`).join(", ")}) as result`;
    try {
      const result = await this.db!.transaction(async (tx) => {
        await tx.exec(`set local role ${role}`);
        return tx.query<{ result: unknown }>(sql, names.map((key) => body[key]));
      });
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
