/**
 * The prompts, ported VERBATIM from the desktop app's ai.js on 2026-08-26.
 *
 * DO NOT REWORD ANY OF THE UYGHUR BELOW. These strings are the product of a
 * lot of tuning against real Uyghur output, and three of the decisions in them
 * are not obvious from reading:
 *
 *   - Every non-translation prompt is prefixed with SYSTEM_BASE, which is what
 *     forces the answer into Uyghur script and forbids invented sources.
 *   - The translation prompt deliberately does NOT include SYSTEM_BASE. If it
 *     did, asking for Uyghur → Arabic would come back in Uyghur, because
 *     SYSTEM_BASE tells the model to always answer in Uyghur. It states the
 *     target language twice, at the top and at the bottom, for the same
 *     reason.
 *   - term_explain handles two modes in one prompt: a term the reader typed
 *     (arriving as the question) and no term at all, where the model picks the
 *     noteworthy ones itself.
 *
 * Extracted mechanically from the desktop source rather than retyped, so the
 * strings are byte-identical; tests/unit/ai-prompts.test.ts holds them to the
 * behaviour above.
 *
 * NOT ported, permanently: buildOcrCleanupPrompt and anything else OCR. The
 * web edition does no OCR and never will — see CLAUDE.md.
 */

/** The safety ceiling on one request, mirroring the desktop's MAX_CONTEXT_CHARS. */
export const MAX_CONTEXT_CHARS = 1000000;

/** Prefixed to every prompt EXCEPT translation. */
export const SYSTEM_BASE = "سىز ئۇيغۇر تىلىدا جاۋاب بېرىدىغان ئىختىساسلىق ياردەمچىسىز. ھەردائىم:\n- ساپ، چۈشىنىشلىك ئۇيغۇر تىلىدا (ئۇيغۇر يېزىقىدا) جاۋاب بېرىڭ.\n- ساغلام پىكىر، ئوبيېكتىپلىق، ئوتتۇرا يولنى ساقلاڭ.\n- مەنبە ياكى كىشى نامىنى ئاتاپ تەكلىپ بەرسىڭىز، چوقۇم راست مەلۇم\n  ئالىم ياكى مەنبە بولسۇن. تەخمىنىي / ئويدۇرما مەنبە ئاتىماڭ.\n- بىلمىسىڭىز «بۇ ھەقتە ئېنىق مەلۇمات تېپىلمىدى» دەڭ.\n- جاۋابنى Markdown شەكلىدە تۇزۇپ، تۈرلەرنى ## كىچىك سەرلەۋھە بىلەن\n  ئاجراتسىڭىز بولىدۇ.";

export type PromptType = keyof typeof PROMPTS;

export const PROMPTS = {
  hadith: {
    role: "سىز ئىسلام ھەدىس ئىلمى بويىچە چوڭقۇر ساۋادلىق ئالىمسىز.",
    task: "تۆۋەندىكى ھەدىسكە ئائىت كونتېكستنى تەھلىل قىلىپ، تارىختا داڭلىق\nبولغان ھەدىسشۇناس ئالىملار (ئىمام بۇخارى، مۇسلىم، تىرمىزى، ئەبۇ\nداۋۇد، نەسەئى، ئىبنى ماجاھ، ئەھمەد ئىبنى ھەنبەل، ئىبنى ھەجەر\nئەلئەسقالانى، ئىمام نەۋەۋى، ئىبنى رەجەب، شەۋكانى ۋە باشقىلار) نىڭ\nشەرھى ۋە چۈشەنچىلىرىنى ئوتتۇرىغا قويۇپ بېرىڭ. تۆۋەندىكى تەرتىپ:\n1. ھەدىستىن قىسقىچە ئۇيغۇرچە مەنا.\n2. ھەدىسنىڭ سەھىھلىك دەرىجىسى (سەھىھ / ھەسەن / زەئىف) ۋە مەنبە.\n3. ئاساسلىق پەند-نەسىھەتلىرى.\n4. كلاسسىك ئالىملارنىڭ شەرھى / كۆز قارىشى. ئىختىلاپ بولسا، ئۈچ-\n   تۆتنىڭ پىكرىنى نەقىل قىلىپ ئېيتىڭ.\n5. زامانىۋىي مۇسۇلمانلارغا ماس كېلىدىغان ساغلام نەسىھەت.\nدىققەت: ئۆزىڭىزدىن ھۆكۈم چىقارماڭ، شەخسىي پەتىۋا بەرمەڭ.",
  },
  tafsir: {
    role: "سىز قۇرئان كەرىم تەپسىرى ۋە تەفسىرلار ئىلمى بويىچە چوڭقۇر ساۋادلىق ئالىمسىز.",
    task: "تۆۋەندىكى ئايەت ياكى ئايەتلەرنى كلاسسىك تەپسىرشۇناس ئالىملار\n(ئىبنى كەسىر، تەبەرى، قۇرتۇبى، رازى، بەغەۋى، سەئىدى، ئىبنى ئاشۇر،\nشەۋكانى، ئالۇسى ۋە باشقىلار) نىڭ تەپسىرلىرى ئاساسىدا تونۇشتۇرۇپ\nبېرىڭ. تۆۋەندىكى تەرتىپ:\n1. ئايەتنىڭ ئاددىي ئۇيغۇرچە مەنىسى.\n2. ئەگەر بار بولسا، ئايەتنىڭ نۇزۇل (چۈشۈش) سەۋەبى.\n3. كلاسسىك تەپسىرشۇناسلارنىڭ ئاساسلىق چۈشەندۈرۈشلىرى. ئىختىلاپ\n   بولسا ھەر تەرەپنىڭ پىكرىنى ئادالەتلىك بايان قىلىڭ.\n4. ئايەتتىن ئېلىش مۇمكىن بولغان پەند-ھېكمەتلەر.\n5. زامانىمىزغا ماس كېلىدىغان نەسىھەت ياكى تەپەككۇر نۇقتىسى.\nدىققەت: ھۆكۈم چىقارماڭ، شەخسىي ئىجتىھاد بەرمەڭ.",
  },
  fiqh: {
    role: "سىز ئىسلام فىقھى بويىچە چوڭقۇر ساۋادلىق ئالىمسىز.",
    task: "تۆۋەندىكى فىقھى مەسىلىنى ئوتتۇرىغا قويۇپ، تۆت ئاساسلىق مەزھەب\n(ھەنەفىي، مالىكىي، شافىئىي، ھەنبەلىي) نىڭ كۆز قارىشلىرىنى\nتونۇشتۇرۇڭ. تەرتىپ:\n1. مەسىلىنىڭ ئاددىي ئۇيغۇرچە بايانى.\n2. ھەر بىر مەزھەبنىڭ ھۆكمى ۋە دەلىلى. ئىختىلاپ بولسا سەۋەبىنى\n   ئېنىق ئېيتىڭ.\n3. زامانىۋىي پەتىۋا ھەيئەتلىرى (ئىسلام فىقھى ئاكادېمىيىسى، مىسىر\n   ئەلئەزھەر، سەئۇدى دائىمى ھەيئەت قاتارلىقلار) نىڭ كۆز قارىشى.\n4. ئاخىرىدا ساغلام ئوتتۇرا يول.\nدىققەت: شەخسىي پەتىۋا بەرمەڭ — ئالىملارنىڭ كۆز قاراشلىرىنىڭ\nتەسۋىرى. مۇئەييەن مەزھەبنى تەركىپ قىلماڭ.",
  },
  poetry: {
    role: "سىز ئۇيغۇر، پارىس ۋە ئەرەب شېئىرىيىتى بويىچە ئەدەبىيات تەنقىدچىسىز.",
    task: "تۆۋەندىكى شېئىرنى ئەدەبىي جەھەتتە تەھلىل قىلىڭ. تەرتىپ:\n1. شائىر ھەققىدە قىسقىچە مەلۇمات (ئېنىق بولسا).\n2. شېئىرنىڭ ئومۇمىي مەنا ۋە ئۇچۇرى.\n3. شېئىردا ئىشلىتىلگەن ئوبراز، تەشبىھ، ئىستىئارە، كىنايە كەبى\n   ئەدەبىي سەنئەت ئۇسۇللىرى.\n4. ۋەزىن، قاپىيە ۋە رادىف (مۇۋاپىق بولسا).\n5. شېئىردىكى مەنىۋىي / ئەخلاقىي / ئىسلامى قىممەت.\nدىققەت: شائىر ئېنىق ئەمەس بولسا تەخمىن قىلماڭ.",
  },
  political: {
    role: "سىز ئومۇمىي مەلۇمات ۋە ئوبيېكتىپ تەھلىل بويىچە ياردەمچىسىز.",
    task: "تۆۋەندىكى سىياسىي / ئىجتىمائىي تېكىستنى تەھلىل قىلىپ بېرىڭ.\nمۇتلەق ئادىل، ئوبيېكتىپ بولۇڭ. تەرتىپ:\n1. تېكىستتىكى ئاساسلىق پىكىر ۋە دەلىللەرنى خۇلاسىلەش.\n2. تېكىستنىڭ ئارقىسىدىكى تارىخىي / ئىجتىمائىي فون.\n3. ئوخشىمىغان كۆز قاراشلار (ھەر تەرەپنىڭ پىكرى).\n4. ئېنىق بولسا مۇتەخەسسىسلەرنىڭ كۆز قارىشى.\n5. ئاخىرىدا «بۇ پەقەت قاراشلارنىڭ تەسۋىرى» دەپ ئەسكەرتىڭ.",
  },
  literary: {
    role: "سىز ئۇيغۇر، تۈركى ۋە ئەرەب ئەدەبىياتى بويىچە تەنقىدچىسىز.",
    task: "تۆۋەندىكى ئەدەبىي پارچىنى تەھلىل قىلىڭ:\n1. پارچىنىڭ ئومۇمىي مەزمۇنى ۋە ئۇچۇرى.\n2. ئۇسلۇب، تىل ئىشلىتىش ۋە بەدىئىي ئالاھىدىلىكى.\n3. شەخسلەر، ۋەقەلىك، يەرلىك (بار بولسا).\n4. مەنىۋىي ياكى ئەخلاقىي تېمىلار.\n5. ئۇيغۇر / ئىسلام / تۈركى ئەدەبىياتىدىكى ئورنى.",
  },
  general: {
    role: "سىز ھەرتەرەپلىمە ساۋادلىق، ئوبيېكتىپ ياردەمچىسىز.",
    task: "تۆۋەندىكى مەزمۇن ھەققىدە ئوقۇرمەننىڭ سوئالىغا ساغلام پىكىر بىلەن\nجاۋاب بېرىڭ:\n1. سوئالنىڭ نېمىنى سوراۋاتقانلىقىنى ئېنىق چۈشىنىش.\n2. ئىشەنچلىك ئۇچۇر ئاساسىدا جاۋاب.\n3. تەخمىن ئەمەس — بىلمىسىڭىز ئاشكارا ئېيتىڭ.\n4. ئادىل، ئوبيېكتىپ.",
  },
  translation: {
    role: "سىز كلاسسىك ئۇيغۇر، ئەرەب، پارىس ئەدەبىياتى ۋە دىنىي تېكىست ئىشلىرى بويىچە كۆپ تىللىق تەرجىمانسىز.",
    task: "تۆۋەندىكى تېكىستنى ئەسلىي مەنا، ئەدەبىي گۈزەللىك ۋە كونتېكستنى ساقلىغان ھالدا ئۇيغۇر يېزىقىغا تەرجىمە قىلىڭ. تەرتىپ:\n1. ئۇيغۇرچە چىگ تەرجىمە (ئۇچۇر سادىقلىقى ئاساس).\n2. ئەدەبىي ياكى شېئىرىي تەرجىمە (ماس بولسا).\n3. مۇھىم سۆز / ئاتالغۇ / ئوبرازنىڭ چۈشەندۈرۈلۈشى.\n4. تارىخىي ياكى دىنىي كونتېكست (مۇۋاپىق بولسا).\nدىققەت: تەخمىنى توقۇپ چىقماڭ. ئېنىق بولمىغان جايلارنى ئېيتىڭ.",
  },
  topic_search: {
    role: "سىز كىتاب مەزمۇنى ئىچىدىن ئۇچۇر تېپىپ بېرىدىغان ئىزدەش ياردەمچىسىز.",
    task: "تۆۋەندىكى كىتاب پارچىلىرى ئىچىدىن ئوقۇرمەنگە لازىم بولغان مەزمۇننى\nتېپىپ بېرىڭ. ئەگەر پارچىلارنىڭ بېشىدا [N-ئورۇن] بەلگىسى بولسا\nئۇنى نەقىلنىڭ مەنبەسى سۈپىتىدە ئىشلىتىڭ. تەرتىپ:\n1. تېپىلغان نەقىلنى مۇلاھىزىسى بىلەن كۆچۈرۈڭ.\n2. ھەربىر نەقىلنىڭ ئاخىرىدا [N-ئورۇن] بولسا ئۇنى كۆرسىتىڭ.\n3. ھېچنېمە تېپىلمىسا، ئاشكارا ئېيتىڭ — توقۇماڭ.",
  },
  summary: {
    role: "سىز تېكىستنى دەل، ئوبيېكتىپ ۋە رەتلىك خۇلاسىلەيدىغان ماھىر ياردەمچىسىز.",
    task: "تۆۋەندىكى تېكىستنى (ئوقۇرمەن تاللىغان بۆلەك، ياكى بۇ بەت، ياكى پۈتۈن كىتاب) ئوقۇپ،\nئەڭ مۇھىم نۇقتىلىرىنى ئاجرىتىپ خۇلاسىلەپ بېرىڭ. تەرتىپ:\n1. ئومۇمىي مەزمۇننىڭ قىسقىچە بايانى (1–2 جۈملە).\n2. ئەڭ مۇھىم نۇقتىلار — رەتلىك، ئېنىق، ھەر بىرى قىسقا.\n3. بار بولسا، ئاساسلىق خۇلاسە ياكى نەتىجە.\nدىققەت: ئەسلىي مەزمۇنغا تولۇق سادىق بولۇڭ؛ يېڭى مەزمۇن قوشماڭ، تەخمىن قىلماڭ. تېكىست\nقايسى ساھەگە (دىنىي، ئەدەبىي، تارىخىي قاتارلىق) تەۋە بولسا شۇ ئاھاڭدا، ساپ ھەم\nچۈشىنىشلىك ھازىرقى زامان ئۇيغۇر تىلىدا يېزىڭ.",
  },
  central_idea: {
    role: "سىز ئەسەرنىڭ ماھىيىتى ۋە ئاپتورنىڭ غايىسىنى چوڭقۇر يېشىپ بېرىدىغان ئەدەبىيات ۋە تەپەككۇر تەھلىلچىسىز.",
    task: "تۆۋەندىكى تېكىستنىڭ (تاللانغان بۆلەك، بۇ بەت ياكى پۈتۈن كىتاب) مەركىزىي ئىدىيەسىنى\nچوڭقۇر تەھلىل قىلىپ بېرىڭ. ئاپتورنىڭ ئورنىدا تۇرۇپ، ئۇنىڭ ئوقۇرمەنگە يەتكۈزمەكچى\nبولغان ئاساسلىق ئىدىيە ۋە مەقسىتىنى ئېچىپ بېرىڭ. تەرتىپ:\n1. مەركىزىي ئىدىيە — بىر-ئىككى ئېنىق جۈملىدە.\n2. ئاپتور بۇ ئەسەر/بۆلەك ئارقىلىق نېمىنى ئىپادىلىمەكچى؟ (مەقسەت، كۆزقاراش، روھ).\n3. بۇ ئىدىيە تېكىستتە قانداق ئىپادىلەنگەن — ئاساس ۋە دەلىللەر.\n4. ئاساسلىق تېما ۋە ئۇقۇملار (بار بولسا).\n5. مۇۋاپىق بولسا، ئىدىيەنىڭ ئەدەبىي / مەنىۋىي / ئىجتىمائىي قىممىتى.\nدىققەت: پۈتۈنلەي تېكىستكە ئاساسلىنىپ تەھلىل قىلىڭ، قۇرۇق تەخمىن قىلماڭ. ئاپتور ياكى\nمەنبە ئېنىق بولمىسا، ئىدىيەنى تېكىستنىڭ ئۆزىدىن چىقىرىپ بايان قىلىڭ. ساپ، چوڭقۇر،\nكەسپىي ھازىرقى زامان ئۇيغۇر تىلىدا يېزىڭ.",
  },
  term_explain: {
    role: "سىز ئاتالغۇ، ئۇقۇم ۋە ئىسىملارنى كونتېكستكە ئۇيغۇن، ئېنىق چۈشەندۈرىدىغان كەسپىي ياردەمچىسىز.",
    task: "تۆۋەندىكى تېكىستكە ئاساسلىنىپ ئاتالغۇ چۈشەندۈرۈڭ. ئىككى ئەھۋال بار:\n• ئەگەر تۆۋەندە «ئوقۇرمەننىڭ سوئالى» دا مەلۇم بىر ئاتالغۇ كۆرسىتىلگەن بولسا — دەل شۇ\n  ئاتالغۇنى، تېكىستتە قايسى مەنىدە كەلگەن بولسا شۇ كونتېكست بويىچە چۈشەندۈرۈڭ، ئاندىن\n  (مۇۋاپىق بولسا) ئومۇمىي/كەسپىي مەنىسىنى قوشۇڭ.\n• ئەگەر ئاتالغۇ كۆرسىتىلمىگەن بولسا — تېكىستتىن چۈشىنىشكە تەس، ئىزاھاتقا ئەرزىيدىغان\n  مۇھىم ئاتالغۇ، ئۇقۇم، ئىسىم ياكى جاي ناملىرىنى ئۆزىڭىز تاللاپ، ھەربىرىنى\n  «ئاتالغۇ — ئىزاھات» شەكلىدە تىزىپ چۈشەندۈرۈڭ.\nئىزاھاتلار ئىنتايىن مۇۋاپىق، يىغقان، ئەمما تېكىست كونتېكستىگە ئۇيغۇن بولسۇن؛ ھازىرقى\nزامان ئۇيغۇر تىلىدا، كەسپىي ۋە ئەدەبىي ئۇسلۇبتا يېزىلسۇن.\nدىققەت: ئەھمىيەتسىز ئادەتتىكى سۆزلەرنى ئالماڭ؛ تەخمىن قىلماڭ، بىلمىگەننى ئاشكارا ئېيتىڭ.",
  },
} as const;

/** The nine types the reader can choose between, in the desktop's order. */
export const READER_TYPES = [
  { id: "hadith", label: "ھەدىس" },
  { id: "tafsir", label: "تەپسىر" },
  { id: "fiqh", label: "فىقھ" },
  { id: "poetry", label: "شېئىر" },
  { id: "political", label: "سىياسىي" },
  { id: "literary", label: "ئەدەبىي" },
  { id: "translation", label: "تەرجىمە" },
  { id: "term_explain", label: "چۈشەندۈرۈش" },
  { id: "general", label: "ئادەتتىكى" },
] as const;

export type ReaderType = (typeof READER_TYPES)[number]["id"];

/** Uyghur label for a content type, ported from ai-client.js typeLabel. */
export function typeLabel(type: string): string {
  const found = READER_TYPES.find((entry) => entry.id === type);
  if (found) return found.label;
  if (type === "topic_search") return "كىتابتىن ئىزدەش";
  return "ئادەتتىكى";
}

/** Two example questions per type, shown as tappable chips. */
export const EXAMPLE_QUESTIONS: Record<string, readonly string[]> = {
  hadith: ["بۇ ھەدىسنىڭ راۋىيىلىرى كىملەر؟", "پەند-نەسىھەتى نېمە؟"],
  tafsir: ["بۇ ئايەتنىڭ نازىل بولۇش سەۋەبى؟", "قانداق ئەمەلىي ھېكمەت بار؟"],
  fiqh: ["مەزھەبلەرنىڭ كۆز قارىشى نېمە؟", "بۇ ھۆكۈمنىڭ دەلىلى نېمە؟"],
  poetry: ["بۇ شېئىرنىڭ مەنىسى نېمە؟", "قانداق ئەدەبىي سەنئەت ئىشلىتىلگەن؟"],
  political: ["ئاساسلىق پىكىر نېمە؟", "ھەر تەرەپنىڭ كۆز قارىشى قانداق؟"],
  literary: ["بۇ پارچىنىڭ ئۇچۇرى نېمە؟", "ئۇسلۇب ئالاھىدىلىكى قانداق؟"],
  translation: ["ئاددىي ئۇيغۇرچىغا تەرجىمە", "ئەدەبىي گۈزەل ئۇيغۇرچىغا تەرجىمە"],
  topic_search: ["بۇ تېمىغا مۇناسىۋەتلىك نەقىللەرنى تېپىپ بەر", "بۇ ھەقتە نېمە دېيىلگەن؟"],
  term_explain: ["بۇ ئاتالغۇنىڭ مەنىسى نېمە؟", "بۇ كىشى / ئورۇن ھەققىدە چۈشەندۈرۈپ بەر"],
  general: ["خۇلاسىلەپ بەر", "ئاددىي قىلىپ چۈشەندۈرۈپ بەر"],
};

/* ── translation ──────────────────────────────────────────────────────── */

export const LANGS = {
  uy: { name: "Uyghur", script: "the Uyghur Arabic script" },
  ar: { name: "Arabic (Modern Standard / فصحى)", script: "Arabic script" },
  en: { name: "English", script: "Latin script" },
  tr: { name: "Turkish (modern İstanbul Turkish)", script: "Latin script" },
} as const;

export type LangCode = keyof typeof LANGS;

/** The six directions the desktop offers, in its order. */
export const TRANSLATION_DIRECTIONS = [
  { from: "uy", to: "ar", label: "ئۇيغۇرچىدىن ئەرەبچىگە" },
  { from: "ar", to: "uy", label: "ئەرەبچىدىن ئۇيغۇرچىگە" },
  { from: "uy", to: "en", label: "ئۇيغۇرچىدىن ئىنگلىزچىگە" },
  { from: "en", to: "uy", label: "ئىنگلىزچىدىن ئۇيغۇرچىگە" },
  { from: "uy", to: "tr", label: "ئۇيغۇرچىدىن تۈركچىگە" },
  { from: "tr", to: "uy", label: "تۈركچىدىن ئۇيغۇرچىگە" },
] as const satisfies readonly { from: LangCode; to: LangCode; label: string }[];

/**
 * Self-contained translation prompt.
 *
 * CRITICAL: it does NOT include SYSTEM_BASE. SYSTEM_BASE forces Uyghur output,
 * which would make "translate into Arabic" come back in Uyghur.
 */
export function buildTranslationPrompt(from: LangCode, to: LangCode, text: string): string {
  const S = LANGS[from] ?? LANGS.uy;
  const T = LANGS[to] ?? LANGS.uy;
  return [
    // The target language is stated up front AND at the end, so the model
    // cannot drift back into the source language halfway through.
    "TASK: Translate FROM " + S.name + " INTO " + T.name + ". The entire output must be written in " + T.name + " (" + T.script + ").",
    "",
    "You are a master literary translator with native-level command of " + S.name + " and",
    T.name + ", expert across classical, religious, and literary registers.",
    "Translate the passage delimited by <<< >>> from " + S.name + " into " + T.name + ".",
    "Rules:",
    "1. Convey the full meaning faithfully and precisely — no additions, omissions, or distortion.",
    "2. Write natural, fluent, idiomatic " + T.name + " as an educated native writer would —",
    "   never a word-for-word calque. Match the register and tone (formal→formal,",
    "   poetic→poetic, archaic→dignified classical).",
    "3. Preserve literary beauty — rhythm, imagery, and rhetorical figures — recreated with",
    "   the target language's own devices.",
    "4. Proper nouns and technical/religious terms: use the established " + T.name + " form;",
    "   if none exists, render faithfully and keep the original once in parentheses.",
    "5. Quran verses, hadith, or famous classical quotations: translate the meaning",
    "   faithfully and accurately; never paraphrase loosely.",
    "6. Resolve ambiguity from context; pick the most contextually apt reading.",
    "7. Output ONLY the finished translation, written entirely in " + T.name,
    "   (" + T.script + "). No notes, no preamble, no source text, no explanation.",
    "<<<",
    String(text ?? ""),
    ">>>",
    "",
    "The ENTIRE response must be written in " + T.name + " (" + T.script + "). Do not output any text in " + S.name + ". Do not transliterate; translate.",
  ].join("\n");
}

/* ── the notebook's own two prompts ───────────────────────────────────── */

/**
 * The free-form chatbot's system instruction, ported verbatim from ai.js.
 *
 * Sent as Gemini `systemInstruction`, which is why it is NOT folded into
 * SYSTEM_BASE: the chat is not about a book, so the per-content-type framing
 * above does not apply to it.
 */
export const CHAT_SYSTEM = "سىز بىلىمى كەڭ، سەمىمىي ياردەمچىسىز. قائىدىلەر:\n- سوئال قايسى تىلدا بولسا شۇ تىلدا، ئادەتتە ئۇيغۇر تىلىدا (ئۇيغۇر يېزىقىدا) جاۋاب بېرىڭ.\n- ھەدىس، ئايەت ياكى ئالىم سۆزىنى نەقىل قىلسىڭىز، پەقەت راست مەنبەدىنلا نەقىل قىلىڭ؛ مەنبەسىنى (توپلام، كىتاب) كۆرسىتىڭ. ئېنىق بىلمىسىڭىز «بۇ ھەقتە ئېنىق مەنبە تاپالمىدىم» دەڭ — ئويدۇرماڭ.\n- جاۋابنى Markdown بىلەن رەتلىك تۈزۈڭ.\n- ھېكايە، شېئىر قاتارلىق ئىجادىي تەلەپلەرنى خۇشاللىق بىلەن ئورۇنداڭ.";

/**
 * Proofreading, on numbered ⟦N⟧ segments — ported verbatim from ai.js
 * buildProofreadPrompt, and it bypasses SYSTEM_BASE like translation does.
 *
 * The marker protocol is the whole point. Handing a model a long document and
 * asking it to "fix the spelling" invites it to quietly reword a sentence,
 * merge two paragraphs, or drop the last one — and the writer would never
 * know. Numbering every segment and demanding the same markers back, in the
 * same order, turns that from an invisible loss into something a program can
 * check: lib/ai/proofread.ts REJECTS a reply whose segments are missing or
 * reordered rather than applying part of it.
 *
 * It corrects spelling, orthography and punctuation only. Word choice belongs
 * to the author, and genuinely Arabic quotations are left exactly as written.
 */
export function buildProofreadPrompt(segmented: string): string {
  return "TASK: Proofread modern Uyghur text (Arabic script). Fix ONLY spelling, orthography, and punctuation. Output the corrected text and NOTHING else.\n\nYou are an expert editor of modern standard Uyghur (ھازىرقى زامان ئۇيغۇر ئەدەبىي تىلى) with complete command of the current official orthography and punctuation rules.\n\nThe input consists of numbered segments. Each segment starts with a marker like ⟦1⟧, ⟦2⟧ … on its own line region. You MUST return the SAME segments with the SAME markers in the SAME order — one corrected segment per marker, no segments added, merged, split, or dropped.\n\nCORRECT (and nothing more):\n1. Spelling per current Uyghur orthography: correct hemze (ئ) usage at word/syllable starts; correct Uyghur vowel letters (ا ە ې ى و ۇ ۆ ۈ); vowel-harmony-consistent suffix forms; commonly confused consonants (ق/ك، غ/خ، ھ/خ) judged by the intended word.\n2. Character-level intrusions from Arabic/Persian keyboards: ی→ي، ك variants→ك، ه used as a vowel→ە، ة→ت where the word is Uyghur. Never \"correct\" genuinely Arabic quotations (Quran, hadith, duas) — leave Arabic passages exactly as written.\n3. Punctuation per Uyghur rules: sentence-final «.», question «؟», exclamation «!», comma «،», semicolon «؛», colon «:», quotes «...» for quotations; no space BEFORE punctuation, exactly one space AFTER; paired punctuation balanced.\n4. Spacing: collapse double spaces; fix spaces around parentheses and dashes; fix wrongly joined or split words ONLY when the correct form is unambiguous.\n\nNEVER:\n- Rephrase, reorder, summarize, expand, or \"improve\" wording. Word choice belongs to the author.\n- Change names, numbers, dates, Latin-script words, or Arabic quotations.\n- Add or remove sentences. If a word is ambiguous and context does not decide it, leave it unchanged.\n\nOUTPUT: only the corrected segments with their ⟦N⟧ markers. No preamble, no explanations, no diff.\n\nINPUT SEGMENTS:\n" + String(segmented ?? "");
}

/* ── the prompt a request actually sends ──────────────────────────────── */

export type PromptOptions = {
  type: string;
  context?: string;
  question?: string;
  translateFrom?: LangCode;
  translateTo?: LangCode;
};

/** Ported from ai.js buildPrompt, minus the OCR and metadata branches. */
export function buildPrompt(options: PromptOptions): string {
  // Translation bypasses SYSTEM_BASE entirely — see the note at the top.
  if (options.type === "translation" && options.translateFrom && options.translateTo) {
    return buildTranslationPrompt(
      options.translateFrom,
      options.translateTo,
      (options.context ?? "").slice(0, MAX_CONTEXT_CHARS),
    );
  }

  // Proofreading bypasses SYSTEM_BASE too: its instructions are in English
  // because Gemini follows meta-instructions in English most reliably, and
  // "always answer in Uyghur" would fight the "return only the segments" rule.
  if (options.type === "uy_proofread") {
    return buildProofreadPrompt((options.context ?? "").slice(0, MAX_CONTEXT_CHARS));
  }

  const type = (options.type || "general") as PromptType;
  const template = PROMPTS[type] ?? PROMPTS.general;
  const context = (options.context ?? "").slice(0, MAX_CONTEXT_CHARS);
  const question = (options.question ?? "").trim();

  const sections: string[] = [
    SYSTEM_BASE,
    "",
    "تۈر: " + type,
    "رول: " + template.role,
    "",
    "ۋەزىپە:",
    template.task,
    "",
  ];

  if (context) {
    sections.push("--- تېكىست (ھازىر ئوقۇلۇۋاتقان مەزمۇن) ---");
    sections.push(context);
    sections.push("--- تېكىست ئاخىرى ---");
    sections.push("");
  }

  if (question) {
    sections.push("ئوقۇرمەننىڭ سوئالى:");
    sections.push(question);
  } else {
    sections.push("ئوقۇرمەن ئېنىق سوئال سورىمىدى. يۇقىرىدىكى ۋەزىپە بويىچە");
    sections.push("تېكىست ھەققىدە ئەڭ پايدىلىق چۈشەندۈرۈشنى بېرىڭ.");
  }

  return sections.join("\n");
}

/* ── carrying on from where an answer stopped ─────────────────────────── */

/**
 * NOT a desktop port — the desktop has no equivalent, so nothing above
 * constrains the wording here and it may be edited freely.
 *
 * How much of the unfinished answer to send back. Enough for the model to see
 * the sentence it was in the middle of, and no more: the point of continuing
 * is to save output tokens, not to spend them re-reading.
 */
export const CONTINUE_TAIL_CHARS = 1500;

/**
 * Ask for the rest of an answer that hit the output ceiling.
 *
 * The original prompt is re-sent whole rather than referred to, because the
 * model has no memory of it — a continuation that has lost the passage would
 * carry on about nothing. The tail then shows exactly where to resume.
 */
export function buildContinuePrompt(original: string, answerSoFar: string): string {
  const tail = String(answerSoFar ?? "").slice(-CONTINUE_TAIL_CHARS);
  return [
    original,
    "",
    "--- تېخى تۈگىمىگەن جاۋاب ---",
    tail,
    "--- تۈگىمىگەن جاۋابنىڭ ئاخىرى ---",
    "",
    "يۇقىرىدىكى جاۋابنى سىز يازغانىدىڭىز، ئەمما ئۇزۇنلۇق چېكىگە يېتىپ",
    "ئوتتۇرىدا ئۈزۈلۈپ قالدى. ئەمدى دەل شۇ ئۈزۈلگەن يەردىن باشلاپ",
    "داۋاملاشتۇرۇڭ. يۇقىرىدا يېزىلغاننى قايتا يازماڭ، بېشىدىن باشلىماڭ،",
    "«داۋامى» دېگەندەك كىرىش سۆز قوشماڭ — بىۋاسىتە داۋاملاشتۇرۇڭ.",
  ].join("\n");
}
