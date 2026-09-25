import {
  BLOCKED_PROVIDER_DOMAINS,
  BLOCKED_TLDS,
  PRC_MAIL_HOSTING_SUFFIXES,
} from "./blocked-email-domains";

/**
 * Judging an email address before an email is spent on it (PROMPT-38).
 *
 * Pure functions only, so the register page can run the same checks in the
 * browser for instant feedback that the Server Actions run for real. Nothing
 * here looks anything up: the DNS checks are server-only and live in
 * lib/auth/email-dns.ts.
 *
 * None of this is a whitelist. An address is refused only for being broken or
 * for belonging to a blocked jurisdiction — never for being unfamiliar.
 */

/** An address in the form every later check uses. */
export type ParsedEmail = {
  /** local@domain, with the domain lower-cased and in its ASCII form. */
  email: string;
  /** The part before the @, exactly as typed. */
  local: string;
  /** Lower case, internationalised labels converted to punycode. */
  domain: string;
};

/** RFC 5321's ceiling for a whole address. */
const MAX_LENGTH = 254;

/**
 * What can never stand unquoted before the @: RFC 5322's "specials",
 * whitespace and control characters. Quoted local parts are not supported by
 * any mail service a reader of this library would use.
 */
const LOCAL_FORBIDDEN = /[\s()<>[\]:;@\\,"\u0000-\u001f\u007f]/u;

/** Characters that would make URL() read more than a host name. */
const NOT_A_HOST = /[\s/\\?#@:%[\]]/;

/** A domain after conversion: letters, digits, hyphens, dots. */
const ASCII_DOMAIN = /^[a-z0-9.-]+$/;

/** The last label: two or more letters, or an internationalised TLD. */
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

function dotsAreSound(part: string): boolean {
  return !part.startsWith(".") && !part.endsWith(".") && !part.includes("..");
}

/**
 * The ASCII (punycode) form of a host name, as DNS sees it.
 *
 * URL does the IDNA mapping in the browser and in Node alike, so
 * `例子.中国` becomes `xn--fsqu00a.xn--fiqs8s` — which is what makes `.中国`
 * answer to the same rule as `.cn`. Anything that is not plainly a host name
 * is refused first: URL would otherwise percent-decode it or treat part of it
 * as a port or a path.
 */
function toAsciiDomain(domain: string): string | null {
  if (NOT_A_HOST.test(domain)) return null;
  try {
    return new URL(`http://${domain}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Normalise and check an address, or return null when it cannot be one.
 *
 * Refused: not exactly one @, nothing before it, any space, a doubled or
 * leading/trailing dot, a domain without a dot, a TLD shorter than two
 * letters, more than 254 characters in all. Plus-addressing, sub-domains and
 * long TLDs are all fine.
 */
export function parseEmail(raw: string): ParsedEmail | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/u.test(trimmed)) return null;

  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@")) return null;

  const local = trimmed.slice(0, at);
  const typedDomain = trimmed.slice(at + 1).toLowerCase();
  if (!local || LOCAL_FORBIDDEN.test(local) || !dotsAreSound(local)) return null;
  if (!typedDomain || !dotsAreSound(typedDomain)) return null;

  const domain = toAsciiDomain(typedDomain);
  if (!domain || !ASCII_DOMAIN.test(domain) || !dotsAreSound(domain)) return null;

  const labels = domain.split(".");
  if (labels.length < 2) return null;
  if (labels.some((label) => label.length > 63 || label.startsWith("-") || label.endsWith("-"))) {
    return null;
  }
  if (!TLD.test(labels[labels.length - 1])) return null;

  const email = `${local}@${domain}`;
  if (email.length > MAX_LENGTH) return null;
  return { email, local, domain };
}

/** True when `host` is `entry` itself or anything beneath it. */
function under(host: string, entry: string): boolean {
  return host === entry || host.endsWith(`.${entry}`);
}

function comparable(host: string): string {
  const lowered = host.trim().toLowerCase().replace(/\.$/, "");
  // Accept either spelling of an internationalised name.
  return /^[\x00-\x7f]*$/.test(lowered) ? lowered : (toAsciiDomain(lowered) ?? lowered);
}

const BLOCKED_NAMES: readonly string[] = [...BLOCKED_TLDS, ...BLOCKED_PROVIDER_DOMAINS];

/**
 * Whether a domain falls under Chinese (PRC) jurisdiction, Hong Kong and
 * Macau included: a blocked country TLD or a PRC mail provider, matched on
 * the domain itself or any parent — `vip.qq.com` and `mail.sina.com.cn` are
 * both caught, `cnn.com` and `qqq-books.org` are not.
 */
export function isBlockedJurisdiction(domain: string): boolean {
  const host = comparable(domain);
  return BLOCKED_NAMES.some((entry) => under(host, entry));
}

/**
 * Whether one mail exchanger is PRC-hosted: under a blocked name above or a
 * known PRC mail-hosting service (Tencent Exmail, NetEase and Alibaba
 * enterprise mail, and the rest in lib/auth/blocked-email-domains.ts).
 */
export function isPrcMailHost(host: string): boolean {
  const name = comparable(host);
  return (
    BLOCKED_NAMES.some((entry) => under(name, entry)) ||
    PRC_MAIL_HOSTING_SUFFIXES.some((entry) => under(name, entry))
  );
}

/* ── Typo suggestions ─────────────────────────────────────────────────────── */

/** The domains most readers type, and so the ones worth correcting towards. */
export const COMMON_DOMAINS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "yandex.ru",
  "yandex.com",
  "mail.ru",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "aol.com",
];

/**
 * Real mail services that sit a keystroke or two from a common domain and so
 * would otherwise be "corrected": mail.com and email.com (mail.com's own),
 * Yahoo's ymail.com, and Türk Telekom's ttmail.com — the last matters to the
 * many readers of this library who live in Turkey.
 */
const REAL_LOOKALIKES: ReadonlySet<string> = new Set([
  "mail.com",
  "email.com",
  "ymail.com",
  "ttmail.com",
]);

/**
 * Two-letter endings that are ".com" mistyped far more often than a country:
 * `gmail.co`, `gmail.cm`, `gmail.om`. Every other two-letter ending on a
 * familiar name — `yahoo.ca`, `gmx.ch`, `protonmail.ch`, `yandex.ua` — is a
 * real national service and is left alone.
 */
const COM_TYPOS: ReadonlySet<string> = new Set(["co", "cm", "om"]);

/**
 * Damerau–Levenshtein distance (the optimal-string-alignment form): how many
 * insertions, deletions, substitutions or swaps of two neighbouring letters
 * turn one string into the other. `gmial.com` → `gmail.com` is one swap.
 */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = [];
  for (let i = 0; i < rows; i += 1) {
    d.push(new Array<number>(cols).fill(0));
    d[i][0] = i;
  }
  for (let j = 0; j < cols; j += 1) d[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2][j - 2] + 1);
      }
      d[i][j] = best;
    }
  }
  return d[rows - 1][cols - 1];
}

/**
 * How far a typed domain may be from `common` and still be a typo of it.
 *
 * Two edits, TLD included — except for names of four letters or fewer (msn,
 * aol, gmx, me, live, mail), where two edits reach real, unrelated domains:
 * `cnn.com` is two from `msn.com`, `mac.com` two from `me.com`. One edit
 * there.
 */
function reach(common: string): number {
  return common.split(".")[0].length <= 4 ? 1 : 2;
}

/** `yahoo.ca` against `yahoo.com`: the same name under a real country code. */
function isCountryVariant(typed: string, common: string): boolean {
  const typedLabels = typed.split(".");
  const commonLabels = common.split(".");
  const tld = typedLabels[typedLabels.length - 1];
  return (
    typedLabels.length === commonLabels.length &&
    typedLabels.slice(0, -1).join(".") === commonLabels.slice(0, -1).join(".") &&
    tld.length === 2 &&
    !COM_TYPOS.has(tld)
  );
}

/**
 * The common domain the reader probably meant, or null.
 *
 * Offered only when exactly one common domain is the nearest within reach.
 * Never for a domain already on the list, never when two are equally near,
 * never for an unfamiliar domain that is simply far from all of them, never
 * for a real look-alike, and never for an address that is blocked anyway —
 * the block is what the reader needs to hear, and a blocked domain is never
 * offered as the correction either.
 */
export function suggestDomain(domain: string): string | null {
  const typed = comparable(domain);
  if (!typed || COMMON_DOMAINS.includes(typed) || REAL_LOOKALIKES.has(typed)) return null;
  if (isBlockedJurisdiction(typed)) return null;

  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let tied = false;
  for (const common of COMMON_DOMAINS) {
    if (isBlockedJurisdiction(common) || isCountryVariant(typed, common)) continue;
    const distance = editDistance(typed, common);
    if (distance > reach(common)) continue;
    if (distance < bestDistance) {
      best = common;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/** The same address with its domain replaced — the one-tap correction. */
export function withDomain(address: string, domain: string): string {
  const at = address.lastIndexOf("@");
  return `${at >= 0 ? address.slice(0, at) : address}@${domain}`;
}
