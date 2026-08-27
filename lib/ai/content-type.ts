/**
 * What kind of text is this? Ported verbatim from the desktop's
 * src/ai-client.js `detectType`.
 *
 * The reader can always override the answer — this only picks the starting
 * point, so that opening the panel on a page of hadith does not begin with the
 * generic prompt. The tests in tests/unit/ai-prompts.test.ts hold the ordering
 * to the desktop's, which matters: a page of tafsir usually mentions ئايەت AND
 * ھەدىس, and whichever check runs first wins.
 */

import type { ReaderType } from "@/lib/ai/prompts";

export function detectType(text: string): ReaderType {
  const t = String(text ?? "");
  if (!t.trim()) return "general";

  // Hadith: Arabic chain words + canonical collection names + Uyghur signals.
  if (
    /حدثنا\s|أخبرنا\s|أنبأنا\s|عن\s+أبي|عن\s+ابن|روى\s+ع|قال\s+رسول\s+الله/.test(t) ||
    /(صحيح\s+(البخاري|مسلم)|سنن\s+(أبي\s+داود|الترمذي|النسائي|ابن\s+ماجه))/.test(t) ||
    /پەيغەمبىرىمىز.*ئەلەيھىسسالام|پەيغەمبەر.*ئەلەيھىسسالام|ھەدىس|بۇخارى|تىرمىزى/.test(t)
  ) {
    return "hadith";
  }

  // Tafsir: explicit Quranic citation + commentary clues.
  if (
    /﴿[\s\S]*﴾|قال\s+الله\s+تعالى|قول\s+الله\s+تعالى|تعالى\s+قال|سورة\s+/.test(t) ||
    /قۇرئان\s+كەرىم|قۇرئاندا|ئايەت|سۈرە|تەپسىر/.test(t)
  ) {
    return "tafsir";
  }

  // Fiqh: jurisprudence vocabulary in Arabic OR Uyghur.
  if (
    /مسألة|الحكم\s+الشرعي|اختلف\s+(العلماء|الفقهاء)|الحلال|الحرام|الواجب|المكروه|المباح|مذهب|الإمام/.test(
      t,
    ) ||
    /مەسىلە|ھۆكۈم|ھالال|ھارام|پەرز|كىراھەت|مەكروھ|مەزھەب|فىقھ|ئىمام/.test(t)
  ) {
    return "fiqh";
  }

  // Poetry: heuristic — many short lines suggesting verse layout.
  const lines = t.split("\n").filter((line) => line.trim());
  if (lines.length >= 4) {
    const lengths = lines.map((line) => line.trim().length);
    const average = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const shortish = lengths.filter((n) => n < 60).length;
    if (average < 50 && shortish / lengths.length > 0.7) return "poetry";
  }

  // Political: contemporary politics / current-affairs vocabulary.
  if (
    /سياسة|حكومة|انتخابات|الحزب|الدولة|الرئيس|الوزير|البرلمان|ئىقتىساد|ھۆكۈمەت|پارتىيە|سايلام|سىياسەت/.test(
      t,
    )
  ) {
    return "political";
  }

  // Literary fallback for narrative prose; else general.
  if (/قىسسە|ھېكايە|رومان|ئەدەبىيات|شائىر|يازغۇچى|قىصة|رواية|الأدب/.test(t)) {
    return "literary";
  }
  return "general";
}
