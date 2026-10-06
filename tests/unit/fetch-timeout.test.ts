import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  BROWSER_FETCH_TIMEOUT_MS,
  BROWSER_UPLOAD_TIMEOUT_MS,
  PROXY_AUTH_DEADLINE_MS,
  SERVER_FETCH_TIMEOUT_MS,
  SESSION_DEADLINE_MS,
  fetchWithTimeout,
  withDeadline,
} from "@/lib/supabase/timeouts";

/**
 * Every Supabase client gives up on its own (PROMPT-40). On 2026-10-05 none
 * did: a stalled API held every page until Vercel killed it at 300 s.
 */

/** A fetch that never answers — until the signal it was given aborts. */
function hangingFetch() {
  const seen: { signal: AbortSignal | null }[] = [];
  const fetch = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal ?? null;
        seen.push({ signal });
        signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
      }),
  );
  return { fetch: fetch as unknown as typeof globalThis.fetch, seen, calls: fetch };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the ceilings", () => {
  it("are seconds, not minutes, and in the order the reasoning gives them", () => {
    expect(PROXY_AUTH_DEADLINE_MS).toBeLessThan(SESSION_DEADLINE_MS);
    expect(SESSION_DEADLINE_MS).toBeLessThan(SERVER_FETCH_TIMEOUT_MS);
    // Above the 8 s statement timeout of a signed-in or service request, so a
    // real Postgres timeout still arrives as Postgres's own 57014.
    expect(SERVER_FETCH_TIMEOUT_MS).toBeGreaterThan(8_000);
    expect(SERVER_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
    expect(BROWSER_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    expect(BROWSER_UPLOAD_TIMEOUT_MS).toBeGreaterThan(BROWSER_FETCH_TIMEOUT_MS);
  });
});

describe("fetchWithTimeout", () => {
  it("gives up after the timeout, with an AbortError", async () => {
    vi.useFakeTimers();
    const { fetch } = hangingFetch();
    const timed = fetchWithTimeout({ timeoutMs: 10_000, base: fetch });
    const pending = timed("https://example.supabase.co/rest/v1/books");
    const settled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(9_999);
    let done = false;
    void pending.catch(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
  });

  it("passes an answer through untouched", async () => {
    const answer = new Response(JSON.stringify([{ id: 1 }]), { status: 200 });
    const base = vi.fn(async () => answer) as unknown as typeof globalThis.fetch;
    const response = await fetchWithTimeout({ timeoutMs: 1_000, base })("https://example.test/");
    expect(response).toBe(answer);
  });

  it("still lets the caller's own signal abort — before the timeout", async () => {
    const { fetch, seen } = hangingFetch();
    const caller = new AbortController();
    const pending = fetchWithTimeout({ timeoutMs: 60_000, base: fetch })("https://example.test/", {
      signal: caller.signal,
    });
    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    // The base fetch was given OUR signal, which the caller's abort reached.
    expect(seen[0].signal?.aborted).toBe(true);
  });

  it("honours a caller's signal that was aborted before the call", async () => {
    const { fetch } = hangingFetch();
    const caller = new AbortController();
    caller.abort();
    await expect(
      fetchWithTimeout({ timeoutMs: 60_000, base: fetch })("https://example.test/", { signal: caller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("stops every request of a client once its shared deadline passes", async () => {
    const { fetch } = hangingFetch();
    const deadline = new AbortController();
    const timed = fetchWithTimeout({ timeoutMs: 60_000, deadline: deadline.signal, base: fetch });
    const first = timed("https://example.test/a");
    const second = timed("https://example.test/b");
    deadline.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    // A retry started after the deadline does not go out and wait.
    await expect(timed("https://example.test/c")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("chooses the limit per request when given a function (the browser's uploads)", async () => {
    vi.useFakeTimers();
    const { fetch } = hangingFetch();
    const timed = fetchWithTimeout({
      timeoutMs: (url) => (url.includes("/storage/v1/") ? 600_000 : 30_000),
      base: fetch,
    });
    let restDone = false;
    let uploadDone = false;
    void timed("https://example.test/rest/v1/book_pages").catch(() => (restDone = true));
    void timed(new URL("https://example.test/storage/v1/object/covers/1.jpg")).catch(() => (uploadDone = true));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(restDone).toBe(true);
    expect(uploadDone).toBe(false);
    await vi.advanceTimersByTimeAsync(570_000);
    expect(uploadDone).toBe(true);
  });

  it("is what supabase-js sends its requests through — and a stalled read is not retried", async () => {
    // postgrest-js retries a failed GET three more times (1 s, 2 s, 4 s) —
    // how one stalled read used to become four. An AbortError it hands back
    // at once instead.
    const { fetch, calls } = hangingFetch();
    const supabase = createClient("https://example.supabase.co", "public-anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithTimeout({ timeoutMs: 50, base: fetch }) },
    });
    const started = Date.now();
    const { error } = await supabase.from("books").select("id");
    expect(error?.message).toMatch(/AbortError/);
    expect(error?.code).toBe("");
    expect(calls).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("withDeadline", () => {
  it("answers with the work when it is quicker", async () => {
    expect(await withDeadline(Promise.resolve("work"), 1_000, "fallback")).toBe("work");
  });

  it("answers with the fallback when the work is slower", async () => {
    vi.useFakeTimers();
    const slow = new Promise<string>(() => undefined);
    const pending = withDeadline(slow, 5_000, "fallback");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toBe("fallback");
  });

  it("answers with the fallback when the work fails — the safe answer", async () => {
    expect(await withDeadline(Promise.reject(new Error("network")), 1_000, "fallback")).toBe("fallback");
  });
});
