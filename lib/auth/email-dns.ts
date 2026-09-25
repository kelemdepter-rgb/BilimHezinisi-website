import "server-only";
import { Resolver } from "node:dns/promises";
import { isPrcMailHost } from "./email";

/**
 * What DNS says about an address's domain, before an email is spent on it.
 *
 * Runs in the Server Actions (Node.js runtime on Vercel, where `node:dns` is
 * available — the auth routes never opt into the Edge runtime). Every lookup
 * is bounded, and anything short of a clear answer lets the request through:
 * a slow or broken resolver must never lock a real person out. The price of
 * failing open is written down in PROMPT-38's honest limits — a custom domain
 * on PRC hosting can slip past while DNS is slow.
 */
export type MailDomainVerdict =
  /** Somewhere to receive mail, not all of it PRC-hosted. */
  | "ok"
  /**
   * Nowhere to deliver: the domain does not exist (NXDOMAIN), publishes the
   * RFC 7505 "null MX" that says it accepts no mail, or has neither mail
   * exchangers nor an address to fall back on.
   */
  | "undeliverable"
  /** Every mail exchanger is PRC-hosted (Tencent Exmail, NetEase, Alibaba…). */
  | "blocked"
  /** No clear answer in time — allowed. */
  | "unknown";

/** The whole budget for one domain, MX and fallback lookups together. */
export const DNS_TIMEOUT_MS = 2000;

/** The resolver codes that mean "definitely nothing there". */
const ABSENT = new Set(["ENOTFOUND", "ENODATA"]);

function codeOf(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}

type MxRecord = { exchange: string; priority: number };

function judgeExchangers(records: MxRecord[]): MailDomainVerdict {
  const hosts = records.map((record) => record.exchange.trim().toLowerCase().replace(/\.$/, ""));
  // Node reports the null MX's "." target as an empty exchange.
  if (hosts.length > 0 && hosts.every((host) => host === "")) return "undeliverable";
  const real = hosts.filter(Boolean);
  if (real.length === 0) return "unknown";
  return real.every(isPrcMailHost) ? "blocked" : "ok";
}

export async function checkMailDomain(
  domain: string,
  timeoutMs: number = DNS_TIMEOUT_MS,
): Promise<MailDomainVerdict> {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("dns timeout"), { code: "ETIMEOUT" })), timeoutMs);
  });
  const bounded = <T>(lookup: Promise<T>) => Promise.race([lookup, deadline]);

  try {
    try {
      return judgeExchangers(await bounded(resolver.resolveMx(domain)));
    } catch (error) {
      const code = codeOf(error);
      if (code === "ENOTFOUND") return "undeliverable";
      if (code !== "ENODATA") return "unknown";
    }

    // No MX records: RFC 5321 §5.1 delivers to the domain's own address
    // instead, so an A or AAAA record still means mail can arrive.
    const [v4, v6] = await Promise.allSettled([
      bounded(resolver.resolve4(domain)),
      bounded(resolver.resolve6(domain)),
    ]);
    const answered = [v4, v6].some((result) => result.status === "fulfilled" && result.value.length > 0);
    if (answered) return "ok";
    const bothAbsent = [v4, v6].every(
      (result) => result.status === "rejected" && ABSENT.has(codeOf(result.reason)),
    );
    return bothAbsent ? "undeliverable" : "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
    resolver.cancel();
  }
}
