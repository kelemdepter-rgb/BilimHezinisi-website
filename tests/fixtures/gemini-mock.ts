import type { Page } from "@playwright/test";

/**
 * A stand-in for Google, installed inside the page.
 *
 * CI must never spend anybody's real Gemini quota, so `fetch` is wrapped for
 * the Gemini origin ONLY and every other request — the site's own, Supabase's
 * — goes through untouched. The wrapper builds a real ReadableStream of real
 * SSE frames, so lib/ai/client.ts runs exactly as it does in production: same
 * parser, same watchdogs, same failover. Only the far end is fake.
 *
 * Behaviour is keyed by the API key, which is what makes failover testable: a
 * test can say "key one is out of quota, key two answers" and then assert
 * which keys were tried, in what order, and with which model.
 */

export const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";

export type GeminiBehaviour =
  /** Answers, one SSE frame per chunk. */
  | {
      kind: "ok";
      chunks: string[];
      delayMs?: number;
      tokensIn?: number;
      tokensOut?: number;
      /**
       * How the answer ends. "STOP" unless a test is about an answer that did
       * NOT finish — MAX_TOKENS, SAFETY, RECITATION.
       */
      finishReason?: string;
      /** What Google claims answered, for the strict-model-selection check. */
      modelVersion?: string;
    }
  /** 429 with RetryInfo — an exhausted free-tier quota. */
  | { kind: "quota"; retryDelay?: string }
  /**
   * 429 whose quota metric reads `limit: 0`. Looks like a quota error and is
   * not one: the model has no free tier and this key has no billing.
   */
  | { kind: "paid_only" }
  /** 503 — the model is momentarily overloaded, the key is fine. */
  | { kind: "busy" }
  /** 400 — the key itself is dead. */
  | { kind: "invalid" }
  /** Never answers, so a request can be cancelled while it is in flight. */
  | { kind: "hang" }
  /** What a browser with no connection does: fetch rejects outright. */
  | { kind: "offline" };

export type GeminiCall = {
  url: string;
  key: string;
  model: string;
  streaming: boolean;
  /** The request body as sent, so a test can prove what was asked. */
  body: string | null;
};

declare global {
  interface Window {
    __geminiBehaviour: Record<string, GeminiBehaviour>;
    __geminiCalls: GeminiCall[];
    __geminiDefault: GeminiBehaviour;
  }
}

/**
 * Wrap fetch before any page script runs. Re-applied on every navigation,
 * which is what `addInitScript` is for.
 */
export async function installGeminiMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__geminiBehaviour = {};
    window.__geminiCalls = [];
    window.__geminiDefault = { kind: "invalid" };

    const ORIGIN = "https://generativelanguage.googleapis.com";
    const realFetch = window.fetch.bind(window);

    const json = (status: number, message: string, details: unknown[] = []) =>
      new Response(JSON.stringify({ error: { code: status, message, status: "ERROR", details } }), {
        status,
        headers: { "content-type": "application/json" },
      });

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(ORIGIN)) return realFetch(input as RequestInfo, init);

      const headers = new Headers(init?.headers ?? {});
      const key = headers.get("x-goog-api-key") ?? "";
      const model = /models\/([^:]+):/.exec(url)?.[1] ?? "";
      const streaming = url.includes("streamGenerateContent");
      window.__geminiCalls.push({
        url,
        key,
        model,
        streaming,
        body: typeof init?.body === "string" ? init.body : null,
      });

      const behaviour = window.__geminiBehaviour[key] ?? window.__geminiDefault;
      const signal = init?.signal ?? null;

      if (behaviour.kind === "offline") {
        throw new TypeError("Failed to fetch");
      }
      if (behaviour.kind === "hang") {
        return new Promise<Response>((_resolve, reject) => {
          if (signal) {
            signal.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError")),
            );
          }
        });
      }
      if (behaviour.kind === "invalid") {
        return json(400, "API key not valid. Please pass a valid API key.");
      }
      if (behaviour.kind === "busy") {
        return json(503, "The model is overloaded. Please try again later.");
      }
      if (behaviour.kind === "paid_only") {
        return json(
          429,
          `Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: ${model}`,
        );
      }
      if (behaviour.kind === "quota") {
        return json(429, "Resource has been exhausted (e.g. check quota).", [
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: behaviour.retryDelay ?? "26s" },
        ]);
      }

      const usage = {
        promptTokenCount: behaviour.tokensIn ?? 11,
        candidatesTokenCount: behaviour.tokensOut ?? 7,
        totalTokenCount: (behaviour.tokensIn ?? 11) + (behaviour.tokensOut ?? 7),
      };

      if (!streaming) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: behaviour.chunks.join("") }] },
                finishReason: behaviour.finishReason ?? "STOP",
              },
            ],
            ...(behaviour.modelVersion ? { modelVersion: behaviour.modelVersion } : {}),
            usageMetadata: usage,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // One frame per chunk, with a pause between them when the test asks for
      // one — that pause is what makes "cancel while it is still writing"
      // something a test can actually catch.
      const delay = behaviour.delayMs ?? 0;
      const chunks = behaviour.chunks.slice();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          for (let index = 0; index < chunks.length; index += 1) {
            if (signal?.aborted) break;
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
            if (signal?.aborted) break;
            const frame: Record<string, unknown> = {
              candidates: [{ content: { parts: [{ text: chunks[index] }] } }],
            };
            if (behaviour.modelVersion) frame.modelVersion = behaviour.modelVersion;
            if (index === chunks.length - 1) {
              frame.usageMetadata = usage;
              (frame.candidates as { finishReason?: string }[])[0].finishReason =
                behaviour.finishReason ?? "STOP";
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
          }
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
  });
}

/** Teach the mock how each key behaves for the test about to run. */
export async function setGeminiBehaviour(
  page: Page,
  behaviours: Record<string, GeminiBehaviour>,
): Promise<void> {
  await page.evaluate((next) => {
    window.__geminiBehaviour = next;
    window.__geminiCalls = [];
  }, behaviours);
}

/** Every call the page made to Google, in order. */
export function geminiCalls(page: Page): Promise<GeminiCall[]> {
  return page.evaluate(() => window.__geminiCalls);
}
