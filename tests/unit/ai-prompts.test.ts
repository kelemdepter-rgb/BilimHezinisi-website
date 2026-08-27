/**
 * The ported prompts, held to the desktop's.
 *
 * These strings are the product of a lot of tuning against real Uyghur output,
 * and the failure mode if one is quietly reworded is not an exception — it is
 * worse answers that nobody notices. So there are two layers here:
 *
 *   1. Self-contained assertions about the things that MUST be true, which run
 *      anywhere, CI included.
 *   2. A byte-for-byte comparison against the desktop app's own ai.js, which
 *      runs only on a machine that has the reference checked out beside this
 *      repo. It is skipped, loudly, elsewhere.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_QUESTIONS,
  LANGS,
  MAX_CONTEXT_CHARS,
  PROMPTS,
  READER_TYPES,
  SYSTEM_BASE,
  TRANSLATION_DIRECTIONS,
  buildPrompt,
  buildTranslationPrompt,
  typeLabel,
} from "@/lib/ai/prompts";
import { detectType } from "@/lib/ai/content-type";

/* ── the rules that must hold ─────────────────────────────────────────── */

describe("translation bypasses SYSTEM_BASE", () => {
  const prompt = buildPrompt({
    type: "translation",
    translateFrom: "uy",
    translateTo: "ar",
    context: "ئىلىم ئۆگىنىڭلار",
  });

  it("does not carry the instruction that forces Uyghur output", () => {
    // The whole point: SYSTEM_BASE says "always answer in Uyghur", which would
    // make "translate into Arabic" come back in Uyghur.
    expect(prompt).not.toContain(SYSTEM_BASE);
    expect(prompt).not.toContain("ئۇيغۇر تىلىدا (ئۇيغۇر يېزىقىدا) جاۋاب بېرىڭ");
  });

  it("names the target language at the top AND at the bottom", () => {
    const arabic = LANGS.ar.name;
    expect(prompt.startsWith(`TASK: Translate FROM ${LANGS.uy.name} INTO ${arabic}.`)).toBe(true);
    expect(prompt.trimEnd().endsWith("Do not transliterate; translate.")).toBe(true);
    expect(prompt).toContain(`The ENTIRE response must be written in ${arabic}`);
    // Twice, deliberately — once is not enough to stop the model drifting back.
    expect(prompt.split(arabic).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("wraps the passage in the delimiters the prompt tells it to expect", () => {
    expect(prompt).toContain("<<<\nئىلىم ئۆگىنىڭلار\n>>>");
  });

  it("carries every direction the reader can pick", () => {
    expect(TRANSLATION_DIRECTIONS).toHaveLength(6);
    for (const direction of TRANSLATION_DIRECTIONS) {
      const text = buildTranslationPrompt(direction.from, direction.to, "سىناق");
      expect(text).toContain(`INTO ${LANGS[direction.to].name}`);
      expect(text).not.toContain(SYSTEM_BASE);
    }
  });
});

describe("every other prompt is built on SYSTEM_BASE", () => {
  it("puts it first, then the role and the task", () => {
    const prompt = buildPrompt({ type: "summary", context: "بىر پارچە تېكىست" });
    expect(prompt.startsWith(SYSTEM_BASE)).toBe(true);
    expect(prompt).toContain("تۈر: summary");
    expect(prompt).toContain(`رول: ${PROMPTS.summary.role}`);
    expect(prompt).toContain(PROMPTS.summary.task);
  });

  it("marks where the book text starts and ends", () => {
    const prompt = buildPrompt({ type: "general", context: "مەزمۇن" });
    expect(prompt).toContain("--- تېكىست (ھازىر ئوقۇلۇۋاتقان مەزمۇن) ---");
    expect(prompt).toContain("--- تېكىست ئاخىرى ---");
  });

  it("says so when the reader asked nothing, instead of leaving it blank", () => {
    const prompt = buildPrompt({ type: "summary", context: "مەزمۇن" });
    expect(prompt).toContain("ئوقۇرمەن ئېنىق سوئال سورىمىدى");
  });

  it("passes the reader's own question through under its own heading", () => {
    const prompt = buildPrompt({ type: "general", context: "مەزمۇن", question: "بۇ نېمە؟" });
    expect(prompt).toContain("ئوقۇرمەننىڭ سوئالى:\nبۇ نېمە؟");
    expect(prompt).not.toContain("ئوقۇرمەن ئېنىق سوئال سورىمىدى");
  });

  it("falls back to the general template for a type it does not know", () => {
    const prompt = buildPrompt({ type: "not-a-type", context: "مەزمۇن" });
    expect(prompt).toContain(PROMPTS.general.task);
  });

  it("never sends more than one request may carry", () => {
    const huge = "ئا".repeat(MAX_CONTEXT_CHARS + 5000);
    expect(buildPrompt({ type: "summary", context: huge }).length).toBeLessThan(
      MAX_CONTEXT_CHARS + SYSTEM_BASE.length + PROMPTS.summary.task.length + 2000,
    );
  });
});

describe("explaining a term", () => {
  it("handles a term the reader typed and no term at all, in one prompt", () => {
    // Both branches are described inside the single task string; that is how
    // the desktop does it and why there is no second template.
    expect(PROMPTS.term_explain.task).toContain("ئوقۇرمەننىڭ سوئالى");
    expect(PROMPTS.term_explain.task).toContain("ئەگەر ئاتالغۇ كۆرسىتىلمىگەن بولسا");

    const typed = buildPrompt({ type: "term_explain", context: "مەزمۇن", question: "تەقۋا" });
    expect(typed).toContain("ئوقۇرمەننىڭ سوئالى:\nتەقۋا");

    const auto = buildPrompt({ type: "term_explain", context: "مەزمۇن" });
    expect(auto).toContain(PROMPTS.term_explain.task);
    expect(auto).toContain("ئوقۇرمەن ئېنىق سوئال سورىمىدى");
  });
});

describe("the catalogue the panel offers", () => {
  it("lists the desktop's nine types, in the desktop's order", () => {
    expect(READER_TYPES.map((entry) => entry.id)).toEqual([
      "hadith",
      "tafsir",
      "fiqh",
      "poetry",
      "political",
      "literary",
      "translation",
      "term_explain",
      "general",
    ]);
    expect(READER_TYPES.map((entry) => entry.label)).toEqual([
      "ھەدىس",
      "تەپسىر",
      "فىقھ",
      "شېئىر",
      "سىياسىي",
      "ئەدەبىي",
      "تەرجىمە",
      "چۈشەندۈرۈش",
      "ئادەتتىكى",
    ]);
    expect(typeLabel("hadith")).toBe("ھەدىس");
    expect(typeLabel("nonsense")).toBe("ئادەتتىكى");
  });

  it("has a prompt for every type the reader can choose", () => {
    for (const entry of READER_TYPES) {
      expect(PROMPTS, `${entry.id} needs a prompt`).toHaveProperty(entry.id);
    }
  });

  it("has example chips for every type, two at a time", () => {
    for (const entry of READER_TYPES) {
      const chips = EXAMPLE_QUESTIONS[entry.id];
      expect(chips, `${entry.id} needs chips`).toBeDefined();
      expect(chips.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("detecting what the text is", () => {
  it("recognises hadith, tafsir and fiqh from their own vocabulary", () => {
    expect(detectType("حدثنا أبو بكر قال رسول الله")).toBe("hadith");
    expect(detectType("بۇ ھەدىس بۇخارى توپلىمىدا كەلگەن")).toBe("hadith");
    expect(detectType("بۇ ئايەتنىڭ تەپسىرى مۇنداق")).toBe("tafsir");
    expect(detectType("بۇ مەسىلىدە ھەنەفىي مەزھەبىنىڭ ھۆكمى")).toBe("fiqh");
  });

  it("keeps the desktop's ordering, which decides the overlapping cases", () => {
    // A tafsir passage nearly always mentions ھەدىس too, and hadith is tested
    // first — so this comes back as hadith on the desktop and must here too.
    expect(detectType("بۇ ئايەت ۋە ھەدىس ھەققىدە")).toBe("hadith");
  });

  it("reads many short lines as verse", () => {
    expect(detectType(["كۆڭۈل ئاچىلدى", "باھار كەلدى", "گۈل ئېچىلدى", "قۇش سايرىدى"].join("\n"))).toBe(
      "poetry",
    );
  });

  it("falls back to general for ordinary prose and for nothing", () => {
    expect(detectType("بۈگۈن ھاۋا ئوچۇق بولدى ۋە بىز سىرتقا چىقتۇق.")).toBe("general");
    expect(detectType("")).toBe("general");
    expect(detectType("   ")).toBe("general");
  });
});

/* ── byte-for-byte, against the desktop itself ────────────────────────── */

const DESKTOP_AI_JS =
  "E:/ditallar/men yasigan ditallar/bilim hezinisi/bilim hezinisi pc/ai.js";
const DESKTOP_CLIENT_JS =
  "E:/ditallar/men yasigan ditallar/bilim hezinisi/bilim hezinisi pc/src/ai-client.js";
const haveDesktop = existsSync(DESKTOP_AI_JS) && existsSync(DESKTOP_CLIENT_JS);

/** Evaluate one `const NAME = …;` out of a source file, and nothing else. */
function literalFrom(source: string, name: string, opener?: "{"): unknown {
  const start = source.indexOf(`const ${name} =`);
  if (start === -1) throw new Error(`${name} not found`);
  if (opener) {
    const open = source.indexOf(opener, start);
    let depth = 0;
    let index = open;
    for (; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return new Function(`return (${source.slice(open, index + 1)})`)();
  }
  const from = source.indexOf("=", start) + 1;
  const semi = source.indexOf(";\n", from);
  return new Function(`return (${source.slice(from, semi)})`)();
}

describe.skipIf(!haveDesktop)("byte-for-byte against the desktop app", () => {
  const lf = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");

  it("has the same SYSTEM_BASE, character for character", () => {
    expect(SYSTEM_BASE).toBe(literalFrom(lf(DESKTOP_AI_JS), "SYSTEM_BASE"));
  });

  it("has the same role and task for every prompt it ported", () => {
    const theirs = literalFrom(lf(DESKTOP_AI_JS), "PROMPTS", "{") as Record<
      string,
      { role: string; task: string }
    >;
    for (const [key, ours] of Object.entries(PROMPTS)) {
      expect(theirs[key], `${key} must exist on the desktop`).toBeDefined();
      expect(ours.role, `${key} role`).toBe(theirs[key].role);
      expect(ours.task, `${key} task`).toBe(theirs[key].task);
    }
  });

  it("names the languages the same way, which the prompt text depends on", () => {
    expect(LANGS).toEqual(literalFrom(lf(DESKTOP_AI_JS), "LANGS", "{"));
  });

  it("offers the same example chips", () => {
    const theirs = literalFrom(lf(DESKTOP_CLIENT_JS), "EXAMPLE_QUESTIONS", "{") as Record<
      string,
      string[]
    >;
    for (const [key, chips] of Object.entries(theirs)) {
      expect(EXAMPLE_QUESTIONS[key], `${key} chips`).toEqual(chips);
    }
  });

  it("does not carry anything OCR across", () => {
    // Permanently out of scope on the web, and the desktop's own prompt for it
    // must never appear here.
    const theirs = lf(DESKTOP_AI_JS);
    expect(theirs).toContain("buildOcrCleanupPrompt");
    expect(Object.keys(PROMPTS)).not.toContain("ocr_cleanup");
  });
});
