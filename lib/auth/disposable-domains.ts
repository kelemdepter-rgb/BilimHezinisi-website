import "server-only";
import { COMMON_DOMAINS } from "./email";
import { DISPOSABLE_DOMAINS_RAW } from "./disposable-domains.list";

/**
 * Disposable (throwaway) email domains, refused at registration (PROMPT-39,
 * part C) — here in the Server Actions, and inside Supabase by the Before
 * User Created hook for signups that skip our form (migration 0027). Both
 * read the SAME filtered list: scripts/sync-auth-domains.mjs copies
 * `DISPOSABLE_DOMAINS` below into the database, and
 * tests/unit/auth-domains-sync.test.ts fails whenever the two disagree.
 *
 * Only registration and the resend form ask. Signing in and password reset
 * never do: an account that already exists keeps working, whatever its
 * address.
 */

/**
 * Domains real people read their mail at, which must never be refused even
 * if the community list ever picked one up by mistake. Every common domain the
 * typo check knows, plus the big national and privacy services this library's
 * readers use — and the forwarding services people choose in order to keep
 * their real address private (Apple's Hide My Email, Firefox Relay, DuckDuckGo,
 * SimpleLogin, addy.io). None of these were on the list when it was vendored
 * (2026-09-26); this is insurance, and it always wins.
 */
export const DISPOSABLE_ALLOWLIST: readonly string[] = [
  // Microsoft, Yahoo, Apple, Google and Proton beyond the common list.
  "hotmail.co.uk",
  "live.co.uk",
  "outlook.fr",
  "outlook.de",
  "yahoo.co.uk",
  "yahoo.co.jp",
  "ymail.com",
  "mac.com",
  "protonmail.ch",
  "pm.me",
  "proton.ch",
  // National services — Turkey, Russia and Central Asia, Europe, Korea.
  "ttmail.com",
  "mynet.com",
  "superonline.com",
  "bk.ru",
  "inbox.ru",
  "list.ru",
  "rambler.ru",
  "ya.ru",
  "mail.kz",
  "inbox.uz",
  "umail.uz",
  "ukr.net",
  "gmx.de",
  "gmx.net",
  "web.de",
  "t-online.de",
  "mail.com",
  "email.com",
  "naver.com",
  "daum.net",
  // Private-by-design mailboxes.
  "tutanota.com",
  "tuta.io",
  "tuta.com",
  "fastmail.com",
  "posteo.de",
  "mailbox.org",
  // Forwarding services that hide a real address.
  "privaterelay.appleid.com",
  "mozmail.com",
  "duck.com",
  "simplelogin.com",
  "slmail.me",
  "addy.io",
  "anonaddy.com",
];

/** Every allowed domain: the common list the typo check uses, and the above. */
const ALLOWED: readonly string[] = [...new Set([...COMMON_DOMAINS, ...DISPOSABLE_ALLOWLIST])];

/** True when `host` is `entry` itself or anything beneath it. */
function under(host: string, entry: string): boolean {
  return host === entry || host.endsWith(`.${entry}`);
}

/**
 * The community list with every entry the allowlist overrules taken out: an
 * allowed domain itself, anything beneath one, and anything above one (a
 * listed parent would otherwise catch the allowed child). What is left is the
 * set both this module and the hook match against — by the domain or any of
 * its parents, and nothing else — so they cannot disagree about an address.
 */
export const DISPOSABLE_DOMAINS: readonly string[] = DISPOSABLE_DOMAINS_RAW.filter(
  (entry) => !ALLOWED.some((allowed) => under(allowed, entry) || under(entry, allowed)),
);

const LISTED: ReadonlySet<string> = new Set(DISPOSABLE_DOMAINS);

/** `a.b.example.com` → `a.b.example.com`, `b.example.com`, `example.com`, `com`. */
function suffixes(domain: string): string[] {
  const labels = domain.split(".");
  return labels.map((_, index) => labels.slice(index).join("."));
}

/** Whether an address's domain, or any parent of it, is a throwaway mail service. */
export function isDisposableDomain(domain: string): boolean {
  const host = domain.trim().toLowerCase().replace(/\.$/, "");
  return host !== "" && suffixes(host).some((suffix) => LISTED.has(suffix));
}
