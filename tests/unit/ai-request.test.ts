/**
 * What this site actually puts on the wire, checked against a fake Google.
 *
 * Every other AI test proves the plumbing — which key was tried, which error
 * was shown. This one proves the REQUEST, because that is where the quality of
 * the Uyghur was being lost: a `generationConfig` that overrode Gemini 3's own
 * defaults on every path. Nothing here spends anybody's quota; `fetch` is
 * replaced, and lib/ai/client.ts runs unchanged behind it.
 *
 * Google's guidance these assertions encode (re-read 2026-08-28):
 *   - "For all Gemini 3 models, we strongly recommend keeping the temperature
 *     parameter at its default value of 1.0."
 *   - `thinking_level` accepts minimal/low/medium/high and, when it is not
 *     sent, each model applies its own default — medium for gemini-3.7-flash,
 *     minimal for gemini-3.5-flash-lite, high for gemini-3.1-pro-preview.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* ── a browser, near enough for the storage module ───────────────────────── */

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

const storage = new MemoryStorage();
vi.stubGlobal("window", { localStorage: storage });
vi.stubGlobal("localStorage", storage);

/* ── a stand-in for Google ───────────────────────────────────────────────── */

type Recorded = { url: string; key: string; body: Record<string, unknown> };

const calls: Recorded[] = [];
let respond: () => Response = () => streamOf(["جاۋاب"]);

vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const headers = new Headers(init?.headers ?? {});
  calls.push({
    url,
    key: headers.get("x-goog-api-key") ?? "",
    body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
  });
  return respond();
});

type FrameOptions = { finishReason?: string; modelVersion?: string };

/** Real SSE frames, so the real parser in client.ts does the reading. */
function streamOf(chunks: string[], options: FrameOptions = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((text, index) => {
        const candidate: Record<string, unknown> = { content: { parts: [{ text }] } };
        const frame: Record<string, unknown> = { candidates: [candidate] };
        if (options.modelVersion) frame.modelVersion = options.modelVersion;
        if (index === chunks.length - 1) {
          candidate.finishReason = options.finishReason ?? "STOP";
          frame.usageMetadata = {
            promptTokenCount: 3,
            candidatesTokenCount: 5,
            totalTokenCount: 8,
          };
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      });
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function jsonOf(text: string, options: FrameOptions = {}): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        { content: { parts: [{ text }] }, finishReason: options.finishReason ?? "STOP" },
      ],
      ...(options.modelVersion ? { modelVersion: options.modelVersion } : {}),
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5, totalTokenCount: 8 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const { askStream, chatStream, probeKey, DEFAULT_OUTPUT_TOKENS } = await import("@/lib/ai/client");
const { SELECTABLE_MODELS } = await import("@/lib/ai/models");
const { obfuscateKey } = await import("@/lib/ai/storage");
import type { ModelId } from "@/lib/ai/models";
import { CONTINUE_LABEL, describeCutAnswer } from "@/lib/ai/errors";
import { CONTINUE_TAIL_CHARS, buildContinuePrompt } from "@/lib/ai/prompts";
import type { AiFailure } from "@/lib/ai/errors";
import type { AskDoneMeta, AskOptions } from "@/lib/ai/client";

const KEY = "AIzaUnitTestKey0000000000000000001";

function enableAi(model: ModelId = "gemini-3.7-flash") {
  storage.clear();
  storage.setItem("bh-ai-enabled", "1");
  storage.setItem("bh-ai-keys", JSON.stringify([obfuscateKey(KEY), "", "", ""]));
  storage.setItem("bh-ai-model", model);
}

type Outcome =
  | { ok: true; text: string; meta: AskDoneMeta }
  | { ok: false; failure: AiFailure };

function ask(options: AskOptions): Promise<Outcome> {
  return new Promise((resolve) => {
    askStream(
      options,
      () => {},
      (text, _model, _usage, meta) => resolve({ ok: true, text, meta }),
      (failure) => resolve({ ok: false, failure }),
    );
  });
}

function chat(
  messages: { role: "user" | "model"; text: string }[],
  continueFrom = "",
): Promise<Outcome> {
  return new Promise((resolve) => {
    chatStream(
      messages,
      () => {},
      (text, _model, _usage, meta) => resolve({ ok: true, text, meta }),
      (failure) => resolve({ ok: false, failure }),
      () => {},
      continueFrom,
    );
  });
}

/** The one request the call under test made. */
function sentConfig(): Record<string, unknown> {
  expect(calls).toHaveLength(1);
  return calls[0].body.generationConfig as Record<string, unknown>;
}

beforeEach(() => {
  calls.length = 0;
  respond = () => streamOf(["جاۋاب"]);
  enableAi();
});

/* ── Gemini 3's own sampling defaults ────────────────────────────────────── */

describe("the sampling parameters", () => {
  it("sends no temperature and no topP when a reader asks a question", async () => {
    const result = await ask({ prompt: "بۇ بەت نېمە ھەققىدە؟" });
    expect(result.ok).toBe(true);

    const config = sentConfig();
    expect(config, "Google asks for temperature 1.0; sending nothing is how we get it").not.toHaveProperty(
      "temperature",
    );
    expect(config).not.toHaveProperty("topP");
    expect(config).not.toHaveProperty("top_p");
  });

  it("sends none on the notebook's chat either", async () => {
    await chat([{ role: "user", text: "سالام" }]);
    const config = sentConfig();
    expect(config).not.toHaveProperty("temperature");
    expect(config).not.toHaveProperty("topP");
    // The chat still carries its own system instruction and a longer thread.
    expect(calls[0].body).toHaveProperty("systemInstruction");
  });

  it("sends none on a translation or a proofread, whatever budget they ask for", async () => {
    // Both go through askStream with only maxOutputTokens raised — the two
    // paths that used to clamp the sampler hardest (0.3 and 0.2).
    await ask({ prompt: "TASK: Translate FROM Uyghur INTO Arabic", maxOutputTokens: 49_152 });
    let config = sentConfig();
    expect(config).not.toHaveProperty("temperature");
    expect(config).not.toHaveProperty("topP");
    expect(config.maxOutputTokens).toBe(49_152);

    calls.length = 0;
    await ask({ prompt: "⟦1⟧ بىر جۈملە", maxOutputTokens: 49_152 });
    config = sentConfig();
    expect(config).not.toHaveProperty("temperature");
    expect(config).not.toHaveProperty("topP");
  });

  it("sends none on the key probe, which is built like a real request", async () => {
    respond = () => jsonOf("سالام");
    const probe = await probeKey(0, KEY);
    expect(probe.status).toBe("valid");

    const config = sentConfig();
    expect(config).not.toHaveProperty("temperature");
    expect(config).not.toHaveProperty("topP");
    // A probe that tested a different configuration would tick for a path the
    // reader never takes.
    expect(config.maxOutputTokens).toBe(DEFAULT_OUTPUT_TOKENS);
    expect(calls[0].url).toContain(":generateContent");
  });
});

/* ── each model thinks at its own default ────────────────────────────────── */

describe("the thinking level", () => {
  it("is not sent at all for an ordinary request", async () => {
    await ask({ prompt: "خۇلاسىلەڭ" });
    const config = sentConfig();
    expect(
      config,
      "an omitted thinkingLevel is what lets each model use its own default",
    ).not.toHaveProperty("thinkingConfig");
  });

  it("is high, and only high, when deep reasoning is asked for", async () => {
    await ask({ prompt: "خۇلاسىلەڭ", deepThink: true });
    expect(sentConfig().thinkingConfig).toEqual({ thinkingLevel: "high" });
  });

  it("never carries the thinkingBudget two of these models reject", async () => {
    await ask({ prompt: "خۇلاسىلەڭ" });
    expect(JSON.stringify(calls[0].body)).not.toContain("thinkingBudget");
    calls.length = 0;
    await ask({ prompt: "خۇلاسىلەڭ", deepThink: true });
    expect(JSON.stringify(calls[0].body)).not.toContain("thinkingBudget");
  });
});

/* ── room for the answer ─────────────────────────────────────────────────── */

describe("the output budget", () => {
  it("defaults to a ceiling with real headroom, well under the model limit", async () => {
    await ask({ prompt: "سوئال" });
    expect(sentConfig().maxOutputTokens).toBe(DEFAULT_OUTPUT_TOKENS);
    // Every model this library offers stops at 65,536 output tokens.
    expect(DEFAULT_OUTPUT_TOKENS).toBeLessThan(65_536);
    expect(DEFAULT_OUTPUT_TOKENS).toBeGreaterThan(4_096);
  });
});

/* ── strict model selection, provable from the URL ───────────────────────── */

describe("the model that is called", () => {
  it("is the one the reader picked, for every model we offer", async () => {
    for (const model of SELECTABLE_MODELS) {
      calls.length = 0;
      enableAi(model);
      const result = await ask({ prompt: "سوئال" });
      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain(`/models/${model}:`);
      expect(calls[0].key).toBe(KEY);
    }
  });
});

/* ── an answer that stopped short is never called finished ───────────────── */

describe("a cut-off answer", () => {
  it("still delivers the text, and carries why it stopped", async () => {
    respond = () => streamOf(["بىرىنچى جۈملە. ئىككىنچى جۈم"], { finishReason: "MAX_TOKENS" });
    const result = await ask({ prompt: "ئۇزۇن خۇلاسە" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The half that arrived is real and is kept — throwing it away would be
    // worse than showing it with a warning.
    expect(result.text).toContain("بىرىنچى جۈملە");
    expect(result.meta.stopReason).toBe("MAX_TOKENS");
  });

  it("is described to the reader, with a way forward", () => {
    const cut = describeCutAnswer({ stopReason: "MAX_TOKENS" });
    expect(cut).not.toBeNull();
    expect(cut?.notice).toContain("تولۇق جاۋاب ئەمەس");
    expect(cut?.canContinue, "the reader must not be left at a dead end").toBe(true);
    expect(CONTINUE_LABEL).toBe("داۋاملاشتۇرۇش");
  });

  it("says so for every non-STOP ending, not only the length limit", () => {
    // A safety or recitation stop cannot be continued past — it would stop at
    // the same place — so it is named and the continue action is withheld.
    for (const reason of ["SAFETY", "RECITATION", "PROHIBITED_CONTENT"]) {
      const cut = describeCutAnswer({ stopReason: reason });
      expect(cut, `${reason} must be surfaced`).not.toBeNull();
      expect(cut?.notice).toContain("تولۇق جاۋاب ئەمەس");
      expect(cut?.canContinue).toBe(false);
    }
    // An ending nobody has seen before is still an ending.
    const unknown = describeCutAnswer({ stopReason: "SOMETHING_NEW" });
    expect(unknown?.notice).toContain("SOMETHING_NEW");

    // The last key dying mid-answer is the same problem by another route.
    expect(describeCutAnswer({ partial: true })?.canContinue).toBe(true);
  });

  it("says nothing at all when the answer actually finished", () => {
    expect(describeCutAnswer({ stopReason: "STOP" })).toBeNull();
    // Google always sends a reason; inventing a warning out of its absence
    // would cry wolf on every answer the day the field moves.
    expect(describeCutAnswer({})).toBeNull();
    expect(describeCutAnswer({ stopReason: "" })).toBeNull();
  });

  it("comes back with STOP on an ordinary answer", async () => {
    const result = await ask({ prompt: "سوئال" });
    expect(result.ok && result.meta.stopReason).toBe("STOP");
  });
});

/* ── carrying on from where it stopped ───────────────────────────────────── */

describe("continuing an answer", () => {
  it("re-sends the task and shows the model exactly where it stopped", () => {
    const original = "ۋەزىپە: بۇ بەتنى خۇلاسىلەڭ";
    const soFar = `${"ئ".repeat(4000)}ئاخىرقى جۈملە`;
    const prompt = buildContinuePrompt(original, soFar);

    // The task, because the model has no memory of it.
    expect(prompt).toContain(original);
    // The TAIL, not the head: continuing from the wrong end of a long answer
    // would repeat half of it.
    expect(prompt).toContain("ئاخىرقى جۈملە");
    expect(prompt.length).toBeLessThan(original.length + CONTINUE_TAIL_CHARS + 600);
    // And the instruction that stops it starting over.
    expect(prompt).toContain("قايتا يازماڭ");
  });

  it("is what the notebook's chat sends when it carries a reply on", async () => {
    await chat([{ role: "user", text: "ئۇزۇن ھېكايە يېزىڭ" }], "يېزىلغان قىسمى");
    const sent = (calls[0].body.contents as { parts: { text: string }[] }[]).at(-1);
    expect(sent?.parts[0].text).toContain("يېزىلغان قىسمى");
    expect(sent?.parts[0].text).toContain("ئۇزۇن ھېكايە يېزىڭ");
    // Still one transport: same system instruction, same everything else.
    expect(calls[0].body).toHaveProperty("systemInstruction");
    expect(calls[0].body.generationConfig).not.toHaveProperty("temperature");
  });
});
