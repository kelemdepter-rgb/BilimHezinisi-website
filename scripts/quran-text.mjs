/**
 * Pure text helpers for the Quran seeder, ported 1:1 from the desktop app's
 * `scripts/seed-quran.js` so the web and the desktop hold byte-identical text.
 *
 * Kept free of I/O and of the Supabase client so `scripts/seed-quran.mjs` and
 * `tests/unit/quran-text.test.ts` can both import it. The JSDoc types below
 * are what the TypeScript test file sees, so they are load-bearing.
 *
 * @typedef {Record<number, Record<number, string>>} VerseMap
 *   sura number → aya number → text
 * @typedef {{ sura: number, aya: number, text_ar: string, text_ar_simple: string, text_ug: string }} AyaRow
 * @typedef {{ number: number, name_ar: string, name_ug: string, name_translit: string, revelation: string, aya_count: number }} SuraRow
 */

/** 114 suras: Arabic name, Uyghur name, transliteration, revelation, aya count. */
export const SURA_META = [
  { n: 1, ar: 'الفاتحة', ug: 'فاتىھە', tr: 'Al-Fatiha', rev: 'meccan', count: 7 },
  { n: 2, ar: 'البقرة', ug: 'بەقەرە', tr: 'Al-Baqara', rev: 'medinan', count: 286 },
  { n: 3, ar: 'آل عمران', ug: 'ئال ئىمران', tr: 'Al-Imran', rev: 'medinan', count: 200 },
  { n: 4, ar: 'النساء', ug: 'نىسا', tr: 'An-Nisa', rev: 'medinan', count: 176 },
  { n: 5, ar: 'المائدة', ug: 'مائىدە', tr: 'Al-Maida', rev: 'medinan', count: 120 },
  { n: 6, ar: 'الأنعام', ug: 'ئەنئام', tr: 'Al-Anam', rev: 'meccan', count: 165 },
  { n: 7, ar: 'الأعراف', ug: 'ئەئراف', tr: 'Al-Araf', rev: 'meccan', count: 206 },
  { n: 8, ar: 'الأنفال', ug: 'ئەنفال', tr: 'Al-Anfal', rev: 'medinan', count: 75 },
  { n: 9, ar: 'التوبة', ug: 'تەۋبە', tr: 'At-Tawba', rev: 'medinan', count: 129 },
  { n: 10, ar: 'يونس', ug: 'يۇنۇس', tr: 'Yunus', rev: 'meccan', count: 109 },
  { n: 11, ar: 'هود', ug: 'ھۇد', tr: 'Hud', rev: 'meccan', count: 123 },
  { n: 12, ar: 'يوسف', ug: 'يۇسۇف', tr: 'Yusuf', rev: 'meccan', count: 111 },
  { n: 13, ar: 'الرعد', ug: 'رەئد', tr: 'Ar-Rad', rev: 'medinan', count: 43 },
  { n: 14, ar: 'إبراهيم', ug: 'ئىبراھىم', tr: 'Ibrahim', rev: 'meccan', count: 52 },
  { n: 15, ar: 'الحجر', ug: 'ھىجر', tr: 'Al-Hijr', rev: 'meccan', count: 99 },
  { n: 16, ar: 'النحل', ug: 'نەھل', tr: 'An-Nahl', rev: 'meccan', count: 128 },
  { n: 17, ar: 'الإسراء', ug: 'ئىسرا', tr: 'Al-Isra', rev: 'meccan', count: 111 },
  { n: 18, ar: 'الكهف', ug: 'كەھف', tr: 'Al-Kahf', rev: 'meccan', count: 110 },
  { n: 19, ar: 'مريم', ug: 'مەريەم', tr: 'Maryam', rev: 'meccan', count: 98 },
  { n: 20, ar: 'طه', ug: 'تاھا', tr: 'Taha', rev: 'meccan', count: 135 },
  { n: 21, ar: 'الأنبياء', ug: 'ئەنبىيا', tr: 'Al-Anbiya', rev: 'meccan', count: 112 },
  { n: 22, ar: 'الحج', ug: 'ھەج', tr: 'Al-Hajj', rev: 'medinan', count: 78 },
  { n: 23, ar: 'المؤمنون', ug: 'مۆئمىنۇن', tr: 'Al-Muminun', rev: 'meccan', count: 118 },
  { n: 24, ar: 'النور', ug: 'نۇر', tr: 'An-Nur', rev: 'medinan', count: 64 },
  { n: 25, ar: 'الفرقان', ug: 'فۇرقان', tr: 'Al-Furqan', rev: 'meccan', count: 77 },
  { n: 26, ar: 'الشعراء', ug: 'شۇئەرا', tr: 'Ash-Shuara', rev: 'meccan', count: 227 },
  { n: 27, ar: 'النمل', ug: 'نەمل', tr: 'An-Naml', rev: 'meccan', count: 93 },
  { n: 28, ar: 'القصص', ug: 'قەسەس', tr: 'Al-Qasas', rev: 'meccan', count: 88 },
  { n: 29, ar: 'العنكبوت', ug: 'ئەنكەبۇت', tr: 'Al-Ankabut', rev: 'meccan', count: 69 },
  { n: 30, ar: 'الروم', ug: 'رۇم', tr: 'Ar-Rum', rev: 'meccan', count: 60 },
  { n: 31, ar: 'لقمان', ug: 'لوقمان', tr: 'Luqman', rev: 'meccan', count: 34 },
  { n: 32, ar: 'السجدة', ug: 'سەجدە', tr: 'As-Sajda', rev: 'meccan', count: 30 },
  { n: 33, ar: 'الأحزاب', ug: 'ئەھزاب', tr: 'Al-Ahzab', rev: 'medinan', count: 73 },
  { n: 34, ar: 'سبأ', ug: 'سەبەئ', tr: 'Saba', rev: 'meccan', count: 54 },
  { n: 35, ar: 'فاطر', ug: 'فاتىر', tr: 'Fatir', rev: 'meccan', count: 45 },
  { n: 36, ar: 'يس', ug: 'ياسىن', tr: 'Yasin', rev: 'meccan', count: 83 },
  { n: 37, ar: 'الصافات', ug: 'سافات', tr: 'As-Saffat', rev: 'meccan', count: 182 },
  { n: 38, ar: 'ص', ug: 'ساد', tr: 'Sad', rev: 'meccan', count: 88 },
  { n: 39, ar: 'الزمر', ug: 'زۇمەر', tr: 'Az-Zumar', rev: 'meccan', count: 75 },
  { n: 40, ar: 'غافر', ug: 'غافىر', tr: 'Ghafir', rev: 'meccan', count: 85 },
  { n: 41, ar: 'فصلت', ug: 'فۇسسىلەت', tr: 'Fussilat', rev: 'meccan', count: 54 },
  { n: 42, ar: 'الشورى', ug: 'شۇرا', tr: 'Ash-Shura', rev: 'meccan', count: 53 },
  { n: 43, ar: 'الزخرف', ug: 'زۇخرۇف', tr: 'Az-Zukhruf', rev: 'meccan', count: 89 },
  { n: 44, ar: 'الدخان', ug: 'دۇخان', tr: 'Ad-Dukhan', rev: 'meccan', count: 59 },
  { n: 45, ar: 'الجاثية', ug: 'جاسىيە', tr: 'Al-Jathiya', rev: 'meccan', count: 37 },
  { n: 46, ar: 'الأحقاف', ug: 'ئەھقاف', tr: 'Al-Ahqaf', rev: 'meccan', count: 35 },
  { n: 47, ar: 'محمد', ug: 'مۇھەممەد', tr: 'Muhammad', rev: 'medinan', count: 38 },
  { n: 48, ar: 'الفتح', ug: 'فەتىھ', tr: 'Al-Fath', rev: 'medinan', count: 29 },
  { n: 49, ar: 'الحجرات', ug: 'ھۇجۇرات', tr: 'Al-Hujurat', rev: 'medinan', count: 18 },
  { n: 50, ar: 'ق', ug: 'قاف', tr: 'Qaf', rev: 'meccan', count: 45 },
  { n: 51, ar: 'الذاريات', ug: 'زارىيات', tr: 'Adh-Dhariyat', rev: 'meccan', count: 60 },
  { n: 52, ar: 'الطور', ug: 'تۇر', tr: 'At-Tur', rev: 'meccan', count: 49 },
  { n: 53, ar: 'النجم', ug: 'نەجم', tr: 'An-Najm', rev: 'meccan', count: 62 },
  { n: 54, ar: 'القمر', ug: 'قەمەر', tr: 'Al-Qamar', rev: 'meccan', count: 55 },
  { n: 55, ar: 'الرحمن', ug: 'رەھمان', tr: 'Ar-Rahman', rev: 'medinan', count: 78 },
  { n: 56, ar: 'الواقعة', ug: 'ۋاقىئە', tr: 'Al-Waqia', rev: 'meccan', count: 96 },
  { n: 57, ar: 'الحديد', ug: 'ھەدىد', tr: 'Al-Hadid', rev: 'medinan', count: 29 },
  { n: 58, ar: 'المجادلة', ug: 'مۇجادەلە', tr: 'Al-Mujadila', rev: 'medinan', count: 22 },
  { n: 59, ar: 'الحشر', ug: 'ھەشر', tr: 'Al-Hashr', rev: 'medinan', count: 24 },
  { n: 60, ar: 'الممتحنة', ug: 'مۇمتەھىنە', tr: 'Al-Mumtahina', rev: 'medinan', count: 13 },
  { n: 61, ar: 'الصف', ug: 'سەف', tr: 'As-Saff', rev: 'medinan', count: 14 },
  { n: 62, ar: 'الجمعة', ug: 'جۈمە', tr: 'Al-Jumua', rev: 'medinan', count: 11 },
  { n: 63, ar: 'المنافقون', ug: 'مۇنافىقۇن', tr: 'Al-Munafiqun', rev: 'medinan', count: 11 },
  { n: 64, ar: 'التغابن', ug: 'تەغابۇن', tr: 'At-Taghabun', rev: 'medinan', count: 18 },
  { n: 65, ar: 'الطلاق', ug: 'تالاق', tr: 'At-Talaq', rev: 'medinan', count: 12 },
  { n: 66, ar: 'التحريم', ug: 'تەھرىم', tr: 'At-Tahrim', rev: 'medinan', count: 12 },
  { n: 67, ar: 'الملك', ug: 'مۈلك', tr: 'Al-Mulk', rev: 'meccan', count: 30 },
  { n: 68, ar: 'القلم', ug: 'قەلەم', tr: 'Al-Qalam', rev: 'meccan', count: 52 },
  { n: 69, ar: 'الحاقة', ug: 'ھاققە', tr: 'Al-Haqqa', rev: 'meccan', count: 52 },
  { n: 70, ar: 'المعارج', ug: 'مەئارىج', tr: 'Al-Maarij', rev: 'meccan', count: 44 },
  { n: 71, ar: 'نوح', ug: 'نۇھ', tr: 'Nuh', rev: 'meccan', count: 28 },
  { n: 72, ar: 'الجن', ug: 'جىن', tr: 'Al-Jinn', rev: 'meccan', count: 28 },
  { n: 73, ar: 'المزمل', ug: 'مۇززەممىل', tr: 'Al-Muzzammil', rev: 'meccan', count: 20 },
  { n: 74, ar: 'المدثر', ug: 'مۇددەسسىر', tr: 'Al-Muddaththir', rev: 'meccan', count: 56 },
  { n: 75, ar: 'القيامة', ug: 'قىيامە', tr: 'Al-Qiyama', rev: 'meccan', count: 40 },
  { n: 76, ar: 'الإنسان', ug: 'ئىنسان', tr: 'Al-Insan', rev: 'medinan', count: 31 },
  { n: 77, ar: 'المرسلات', ug: 'مۇرسەلات', tr: 'Al-Mursalat', rev: 'meccan', count: 50 },
  { n: 78, ar: 'النبأ', ug: 'نەبەئ', tr: 'An-Naba', rev: 'meccan', count: 40 },
  { n: 79, ar: 'النازعات', ug: 'نازىئات', tr: 'An-Naziat', rev: 'meccan', count: 46 },
  { n: 80, ar: 'عبس', ug: 'ئەبەسە', tr: 'Abasa', rev: 'meccan', count: 42 },
  { n: 81, ar: 'التكوير', ug: 'تەكۋىر', tr: 'At-Takwir', rev: 'meccan', count: 29 },
  { n: 82, ar: 'الانفطار', ug: 'ئىنفىتار', tr: 'Al-Infitar', rev: 'meccan', count: 19 },
  { n: 83, ar: 'المطففين', ug: 'مۇتەففىفىن', tr: 'Al-Mutaffifin', rev: 'meccan', count: 36 },
  { n: 84, ar: 'الانشقاق', ug: 'ئىنشىقاق', tr: 'Al-Inshiqaq', rev: 'meccan', count: 25 },
  { n: 85, ar: 'البروج', ug: 'بۇرۇج', tr: 'Al-Buruj', rev: 'meccan', count: 22 },
  { n: 86, ar: 'الطارق', ug: 'تارىق', tr: 'At-Tariq', rev: 'meccan', count: 17 },
  { n: 87, ar: 'الأعلى', ug: 'ئەئلا', tr: 'Al-Ala', rev: 'meccan', count: 19 },
  { n: 88, ar: 'الغاشية', ug: 'غاشىيە', tr: 'Al-Ghashiya', rev: 'meccan', count: 26 },
  { n: 89, ar: 'الفجر', ug: 'فەجر', tr: 'Al-Fajr', rev: 'meccan', count: 30 },
  { n: 90, ar: 'البلد', ug: 'بەلەد', tr: 'Al-Balad', rev: 'meccan', count: 20 },
  { n: 91, ar: 'الشمس', ug: 'شەمس', tr: 'Ash-Shams', rev: 'meccan', count: 15 },
  { n: 92, ar: 'الليل', ug: 'لەيل', tr: 'Al-Layl', rev: 'meccan', count: 21 },
  { n: 93, ar: 'الضحى', ug: 'زۇھا', tr: 'Ad-Duha', rev: 'meccan', count: 11 },
  { n: 94, ar: 'الشرح', ug: 'ئىنشىراھ', tr: 'Ash-Sharh', rev: 'meccan', count: 8 },
  { n: 95, ar: 'التين', ug: 'تىن', tr: 'At-Tin', rev: 'meccan', count: 8 },
  { n: 96, ar: 'العلق', ug: 'ئەلەق', tr: 'Al-Alaq', rev: 'meccan', count: 19 },
  { n: 97, ar: 'القدر', ug: 'قەدر', tr: 'Al-Qadr', rev: 'meccan', count: 5 },
  { n: 98, ar: 'البينة', ug: 'بەييىنە', tr: 'Al-Bayyina', rev: 'medinan', count: 8 },
  { n: 99, ar: 'الزلزلة', ug: 'زەلزەلە', tr: 'Az-Zalzala', rev: 'medinan', count: 8 },
  { n: 100, ar: 'العاديات', ug: 'ئادىيات', tr: 'Al-Adiyat', rev: 'meccan', count: 11 },
  { n: 101, ar: 'القارعة', ug: 'قارىئە', tr: 'Al-Qaria', rev: 'meccan', count: 11 },
  { n: 102, ar: 'التكاثر', ug: 'تەكاسۇر', tr: 'At-Takathur', rev: 'meccan', count: 8 },
  { n: 103, ar: 'العصر', ug: 'ئەسر', tr: 'Al-Asr', rev: 'meccan', count: 3 },
  { n: 104, ar: 'الهمزة', ug: 'ھۇمەزە', tr: 'Al-Humaza', rev: 'meccan', count: 9 },
  { n: 105, ar: 'الفيل', ug: 'فىل', tr: 'Al-Fil', rev: 'meccan', count: 5 },
  { n: 106, ar: 'قريش', ug: 'قۇرەيش', tr: 'Quraysh', rev: 'meccan', count: 4 },
  { n: 107, ar: 'الماعون', ug: 'ماھۇن', tr: 'Al-Maun', rev: 'meccan', count: 7 },
  { n: 108, ar: 'الكوثر', ug: 'كەۋسەر', tr: 'Al-Kawthar', rev: 'meccan', count: 3 },
  { n: 109, ar: 'الكافرون', ug: 'كافىرۇن', tr: 'Al-Kafirun', rev: 'meccan', count: 6 },
  { n: 110, ar: 'النصر', ug: 'نەسر', tr: 'An-Nasr', rev: 'medinan', count: 3 },
  { n: 111, ar: 'المسد', ug: 'مەسەد', tr: 'Al-Masad', rev: 'meccan', count: 5 },
  { n: 112, ar: 'الإخلاص', ug: 'ئىخلاس', tr: 'Al-Ikhlas', rev: 'meccan', count: 4 },
  { n: 113, ar: 'الفلق', ug: 'فەلەق', tr: 'Al-Falaq', rev: 'meccan', count: 5 },
  { n: 114, ar: 'الناس', ug: 'ناس', tr: 'An-Nas', rev: 'meccan', count: 6 },
];

/** Total ayas in the Quran — the seeder refuses to write anything else. */
export const TOTAL_AYAS = 6236;

/**
 * Strip tashkil and unify alif variants, producing the `text_ar_simple`
 * column that search runs against.
 */
/**
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function stripTashkil(text) {
  if (!text) return '';
  return String(text)
    .replace(/[ً-ٰٟۖ-ۭ࣓-ࣿـ]/g, '')
    // Normalize alif variants to plain alif so a typed query still matches.
    .replace(/[ٱآأإ]/g, 'ا')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Character-level diacritic detector. Unlike stripTashkil it neither trims
 * nor collapses whitespace, so it is safe during a position-by-position walk.
 */
function isStrippableDiacritic(ch) {
  const code = ch.charCodeAt(0);
  return (code >= 0x064b && code <= 0x065f)
    || code === 0x0670
    || (code >= 0x06d6 && code <= 0x06ed)
    || (code >= 0x08d3 && code <= 0x08ff)
    || code === 0x0640;
}

function normalizeCharForBasmala(ch) {
  if (isStrippableDiacritic(ch)) return '';
  if (ch === 'ٱ' || ch === 'آ' || ch === 'أ' || ch === 'إ') {
    return 'ا';
  }
  return ch;
}

const BASMALA_NORMALIZED = 'بسم الله الرحمن الرحيم';

/**
 * If `text` opens with the basmala, return the rest of the aya without it —
 * every encoding variant, matched on the diacritic/alif-normalized form.
 * Text that does not open with the basmala comes back untouched.
 */
/**
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function stripBasmalaPrefix(text) {
  if (!text) return text;

  // Normalized form plus a map back to the original index of each surviving
  // character, so the cut lands on a real offset in the source string.
  let normalized = '';
  const origIndexAt = [];
  for (let i = 0; i < text.length; i++) {
    const n = normalizeCharForBasmala(text[i]);
    if (n) {
      normalized += n;
      origIndexAt.push(i);
    }
  }

  const idx = normalized.indexOf(BASMALA_NORMALIZED);
  if (idx === -1 || idx > 5) return text;

  const cutNormEnd = idx + BASMALA_NORMALIZED.length;
  const cutOrig = cutNormEnd >= origIndexAt.length ? text.length : origIndexAt[cutNormEnd];

  // Drop the whitespace, bidi marks and pause marks left between the basmala
  // and the aya proper.
  return text
    .slice(cutOrig)
    .replace(/^[\s‏‎  ۚۖۗۘۙۛ]+/, '');
}

// ── Verse markers and translation groups (desktop 3.6) ──────────────────────
// Each translation in the QuranEnc file ends with its verse number in
// parentheses: «…ئىگىسىدۇر(4).». Runs of consecutive verses that the
// translator rendered as one sentence carry the same text under each verse
// and a range marker: «(160ـ161)», separated by a tatweel (U+0640) in most,
// by a hyphen in a few, sometimes backwards («(56- 55)»), with stray
// separators or a zero-width joiner in some single markers («(54 ـ )»,
// «(‍88)»). Parentheses that hold words are translation text and stay
// (58:4 «(60 مىسكىنگە بىر ۋاخ تاماق بېرىشى لازىم)»).

/** A parenthesised group of digits and separators only, with the space before it. */
export const VERSE_MARKER = /\s*\(([\s0-9٠-٩\-–ـ،,‌‍]*)\)/g;
export const MARKER_DIGIT = /[0-9٠-٩]/;
// After a removed marker, a space is kept only before more words: never
// before punctuation, and never at the end.
export const NO_SPACE_BEFORE = /[\s.،؛:!?؟»)\]]/;

/**
 * The translation without its verse markers. Nothing else is removed or
 * changed — not a letter, not a punctuation mark; only the whitespace is
 * collapsed, as before.
 */
/**
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function cleanUyghurTranslation(text) {
  if (!text) return '';
  return String(text)
    .replace(VERSE_MARKER, function (m, inner, at, s) {
      if (!MARKER_DIGIT.test(inner)) return m;
      const after = s.charAt(at + m.length);
      return at > 0 && after && !NO_SPACE_BEFORE.test(after) ? ' ' : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {string} s */
function westernDigits(s) {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * The verses a translation's marker names, if one of its markers holds this
 * verse: { from, to } in order («56- 55» is 55–56). 6:5 carries «(4)» from a
 * copy of 6:4's sentence before its own «(5)», so only a marker that holds
 * the verse counts.
 */
/**
 * @param {string} text
 * @param {number} aya
 * @returns {{ from: number, to: number } | null}
 */
function markerRange(text, aya) {
  for (const m of String(text || '').matchAll(VERSE_MARKER)) {
    const nums = (westernDigits(m[1]).match(/\d+/g) || []).map(Number);
    if (!nums.length) continue;
    const from = Math.min(...nums);
    const to = Math.max(...nums);
    if (from <= aya && aya <= to) return { from, to };
  }
  return null;
}

/**
 * Which verses share one translation, from the RAW text of the bundled file
 * (never from the cleaned column): consecutive verses with identical text,
 * joined with the range in their marker. 53:13 and 53:14 both end «(13ـ14)»
 * though 53:14's text is a shortened copy of 53:13's — the marker makes them
 * one group. A verse on its own is { from: aya, to: aya }.
 */
/**
 * @param {VerseMap} ugMap sura → aya → raw text
 * @returns {Record<number, Record<number, { from: number, to: number }>>}
 */
export function uyghurGroups(ugMap) {
  /** @type {Record<number, Record<number, { from: number, to: number }>>} */
  const out = {};
  for (const sura of Object.keys(ugMap).map(Number)) {
    const texts = ugMap[sura];
    const ayas = Object.keys(texts).map(Number).sort((a, b) => a - b);
    if (!ayas.length) continue;
    const last = ayas[ayas.length - 1];
    // Union-find over the verses of the sura; every union joins an
    // interval, so each group comes out as a run of consecutive verses.
    /** @type {Record<number, number>} */
    const parent = {};
    /** @param {number} a @returns {number} */
    const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
    /** @param {number} a @param {number} b */
    const join = (a, b) => {
      parent[find(a)] = find(b);
    };
    for (const a of ayas) parent[a] = a;
    for (let i = 1; i < ayas.length; i++) {
      if (ayas[i] === ayas[i - 1] + 1 && texts[ayas[i]] === texts[ayas[i - 1]]) join(ayas[i], ayas[i - 1]);
    }
    for (const a of ayas) {
      const r = markerRange(texts[a], a);
      if (!r) continue;
      for (let b = Math.max(1, r.from); b <= Math.min(last, r.to); b++) {
        if (parent[b] !== undefined) join(b, a);
      }
    }
    /** @type {Record<number, { from: number, to: number }>} */
    const span = {};
    for (const a of ayas) {
      const root = find(a);
      const s = span[root] || (span[root] = { from: a, to: a });
      if (a < s.from) s.from = a;
      if (a > s.to) s.to = a;
    }
    out[sura] = {};
    for (const a of ayas) {
      const s = span[find(a)];
      out[sura][a] = { from: s.from, to: s.to };
    }
  }
  return out;
}

/**
 * The groups of more than one verse, in mushaf order, as `[sura, from, to]`,
 * with the verse whose cleaned text is the group's (the longest; the first on
 * a tie) and whether every verse of the group carries that same text. The
 * identical runs do; 53:13–14 does not, and its text is 53:13's.
 */
/**
 * @param {VerseMap} ugMap sura → aya → raw text
 * @returns {{ sura: number, from: number, to: number, textAya: number, same: boolean }[]}
 */
export function multiVerseGroups(ugMap) {
  const groups = uyghurGroups(ugMap);
  /** @type {{ sura: number, from: number, to: number, textAya: number, same: boolean }[]} */
  const out = [];
  for (const sura of Object.keys(groups).map(Number).sort((a, b) => a - b)) {
    const seen = new Set();
    for (const aya of Object.keys(groups[sura]).map(Number).sort((a, b) => a - b)) {
      const { from, to } = groups[sura][aya];
      if (to === from || seen.has(from)) continue;
      seen.add(from);
      const text = (/** @type {number} */ a) => cleanUyghurTranslation(ugMap[sura][a]);
      let textAya = from;
      let same = true;
      for (let a = from + 1; a <= to; a++) {
        if (text(a) !== text(from)) same = false;
        if (text(a).length > text(textAya).length) textAya = a;
      }
      out.push({ sura, from, to, textAya, same });
    }
  }
  return out;
}

/**
 * Parse the Tanzil plain-text format: `sura|aya|text`, one per line, with
 * `#` comment lines. Returns `{ [sura]: { [aya]: text } }`.
 */
/**
 * @param {string} content
 * @returns {VerseMap}
 */
export function parseTanzil(content) {
  /** @type {VerseMap} */
  const map = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\d+)\|(\d+)\|(.+)$/);
    if (!m) continue;
    const sura = parseInt(m[1], 10);
    const aya = parseInt(m[2], 10);
    if (!map[sura]) map[sura] = {};
    map[sura][aya] = m[3].trim();
  }
  return map;
}

/**
 * Parse the quranenc Uyghur translation XML. The desktop uses
 * node-html-parser; this walks the same `<sura>/<aya>/<translation>` shape
 * directly, because the file is machine-generated and the web project should
 * not carry an HTML parser for one script. Returns `{ [sura]: { [aya]: text } }`,
 * each text as the file has it — its verse markers still in it.
 */
/**
 * @param {string} xmlContent
 * @returns {VerseMap}
 */
export function parseUyghurXml(xmlContent) {
  /** @type {VerseMap} */
  const map = {};
  const suraPattern = /<sura\b[^>]*\bnumber="(\d+)"[^>]*>([\s\S]*?)<\/sura>/g;
  const ayaPattern = /<aya\b[^>]*\bnumber="(\d+)"[^>]*>([\s\S]*?)<\/aya>/g;
  const translationPattern = /<translation\b[^>]*>([\s\S]*?)<\/translation>/;

  let suraMatch;
  while ((suraMatch = suraPattern.exec(xmlContent)) !== null) {
    const suraNum = parseInt(suraMatch[1], 10);
    if (!suraNum) continue;
    map[suraNum] = {};

    const suraBody = suraMatch[2];
    ayaPattern.lastIndex = 0;
    let ayaMatch;
    while ((ayaMatch = ayaPattern.exec(suraBody)) !== null) {
      const ayaNum = parseInt(ayaMatch[1], 10);
      const translation = translationPattern.exec(ayaMatch[2]);
      if (!ayaNum || !translation) continue;
      let text = translation[1].trim();
      // Unwrap the CDATA section the exporter writes around every verse.
      text = text.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
      // The text as the file has it, verse markers included: uyghurGroups()
      // reads them, and cleanUyghurTranslation() takes them out.
      map[suraNum][ayaNum] = text;
    }
  }
  return map;
}

/**
 * Turn the two parsed maps into the rows the database expects, applying the
 * basmala rule: every sura but Al-Fatiha opens with the basmala in the
 * Uthmani source, and it is rendered as a heading rather than as part of
 * aya 1.
 *
 * Throws when the Arabic side is incomplete — a missing verse must never be
 * written as an empty string.
 */
/**
 * @param {VerseMap} arMap
 * @param {VerseMap} ugMap
 * @returns {AyaRow[]}
 */
export function buildAyaRows(arMap, ugMap) {
  /** @type {AyaRow[]} */
  const rows = [];
  for (const meta of SURA_META) {
    for (let an = 1; an <= meta.count; an++) {
      let ar = (arMap[meta.n] && arMap[meta.n][an]) || '';
      const ug = (ugMap[meta.n] && ugMap[meta.n][an]) || '';
      if (!ar) throw new Error(`Missing Arabic text for ${meta.n}:${an}`);
      if (an === 1 && meta.n !== 1) ar = stripBasmalaPrefix(ar);
      rows.push({
        sura: meta.n,
        aya: an,
        text_ar: ar,
        text_ar_simple: stripTashkil(ar),
        text_ug: cleanUyghurTranslation(ug),
      });
    }
  }
  return rows;
}

/** The 114 sura rows, in the shape `quran_suras` stores. */
/** @returns {SuraRow[]} */
export function buildSuraRows() {
  return SURA_META.map((s) => ({
    number: s.n,
    name_ar: s.ar,
    name_ug: s.ug,
    name_translit: s.tr,
    revelation: s.rev,
    aya_count: s.count,
  }));
}

/**
 * Integrity report for a parsed pair of sources. Returns hard `errors` (the
 * seeder refuses to write when any are present) and soft `warnings` (missing
 * translations, which are reported rather than hidden).
 */
/**
 * @param {VerseMap} arMap
 * @param {VerseMap} ugMap
 * @returns {{ errors: string[], warnings: string[], totalAr: number }}
 */
export function checkIntegrity(arMap, ugMap) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  let totalAr = 0;
  for (const sura of Object.keys(arMap)) totalAr += Object.keys(arMap[sura]).length;
  if (totalAr !== TOTAL_AYAS) {
    errors.push(`Arabic: expected ${TOTAL_AYAS} ayas, got ${totalAr}`);
  }

  for (const meta of SURA_META) {
    const arCount = arMap[meta.n] ? Object.keys(arMap[meta.n]).length : 0;
    if (arCount !== meta.count) {
      errors.push(`Sura ${meta.n} (${meta.ar}): expected ${meta.count} Arabic ayas, got ${arCount}`);
    }
    for (let an = 1; an <= meta.count; an++) {
      if (!(arMap[meta.n] && arMap[meta.n][an])) errors.push(`Missing Arabic text for ${meta.n}:${an}`);
      const ug = ugMap[meta.n] && ugMap[meta.n][an];
      if (!ug || !cleanUyghurTranslation(ug)) warnings.push(`Missing Uyghur translation for ${meta.n}:${an}`);
    }
  }

  return { errors, warnings, totalAr };
}
