import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkMailDomain } from "@/lib/auth/email-dns";

/**
 * What DNS says about an address's domain (lib/auth/email-dns.ts), with
 * `node:dns` replaced — no lookup leaves this machine. The rule under test:
 * refuse only on a clear answer, and let everything else through, because a
 * slow resolver must never lock a real person out.
 */

type Answer = unknown[] | string | "hang";
const answers: Record<"resolveMx" | "resolve4" | "resolve6", Answer> = {
  resolveMx: "ENODATA",
  resolve4: "ENODATA",
  resolve6: "ENODATA",
};

function reply(kind: keyof typeof answers): Promise<unknown[]> {
  const answer = answers[kind];
  if (answer === "hang") return new Promise(() => {});
  if (typeof answer === "string") {
    return Promise.reject(Object.assign(new Error(`${kind} ${answer}`), { code: answer }));
  }
  return Promise.resolve(answer);
}

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    resolveMx() {
      return reply("resolveMx");
    }
    resolve4() {
      return reply("resolve4");
    }
    resolve6() {
      return reply("resolve6");
    }
    cancel() {}
  },
}));

const mx = (...hosts: string[]) => hosts.map((exchange, index) => ({ exchange, priority: index * 10 }));

beforeEach(() => {
  answers.resolveMx = "ENODATA";
  answers.resolve4 = "ENODATA";
  answers.resolve6 = "ENODATA";
});

describe("the MX jurisdiction check", () => {
  it("blocks a domain whose every exchanger is PRC-hosted", async () => {
    answers.resolveMx = mx("mxbiz1.qq.com", "mxbiz2.qq.com");
    expect(await checkMailDomain("innocent-company.com")).toBe("blocked");
    answers.resolveMx = mx("mxw.mxhichina.com", "mxn.mxhichina.com");
    expect(await checkMailDomain("another.org")).toBe("blocked");
    answers.resolveMx = mx("qiye163mx01.mxmail.netease.com.");
    expect(await checkMailDomain("third.net")).toBe("blocked");
  });

  it("allows a domain with even one exchanger outside the PRC", async () => {
    answers.resolveMx = mx("mxbiz1.qq.com", "aspmx.l.google.com");
    expect(await checkMailDomain("mixed.com")).toBe("ok");
  });

  it("allows a domain whose mail is received abroad", async () => {
    answers.resolveMx = mx("company-com.mail.protection.outlook.com");
    expect(await checkMailDomain("company.com")).toBe("ok");
  });
});

describe("does the domain exist at all", () => {
  it("refuses a domain DNS says does not exist", async () => {
    answers.resolveMx = "ENOTFOUND";
    expect(await checkMailDomain("no-such-domain.example")).toBe("undeliverable");
  });

  it("refuses a domain that publishes the null MX — it accepts no mail", async () => {
    answers.resolveMx = mx("");
    expect(await checkMailDomain("example.com")).toBe("undeliverable");
  });

  it("allows a domain with no MX but an address, which receives mail itself", async () => {
    answers.resolve4 = ["192.0.2.1"];
    expect(await checkMailDomain("gmial.com")).toBe("ok");
    answers.resolve4 = "ENODATA";
    answers.resolve6 = ["2001:db8::1"];
    expect(await checkMailDomain("v6-only.example")).toBe("ok");
  });

  it("refuses a domain with neither exchangers nor an address", async () => {
    expect(await checkMailDomain("gmal.com")).toBe("undeliverable");
  });
});

describe("failing open", () => {
  it("allows the request when the lookup times out", async () => {
    answers.resolveMx = "hang";
    const started = Date.now();
    expect(await checkMailDomain("slow.example", 80)).toBe("unknown");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("allows it when the fallback lookup times out", async () => {
    answers.resolve4 = "hang";
    answers.resolve6 = "hang";
    expect(await checkMailDomain("slow-fallback.example", 80)).toBe("unknown");
  });

  it("allows it on any other resolver error", async () => {
    for (const code of ["ESERVFAIL", "ECONNREFUSED", "EREFUSED", "ETIMEOUT", "EBADRESP"]) {
      answers.resolveMx = code;
      expect(await checkMailDomain("broken.example"), code).toBe("unknown");
    }
  });

  it("allows it when the fallback answers with an error that is not 'absent'", async () => {
    answers.resolve4 = "ESERVFAIL";
    expect(await checkMailDomain("half-broken.example")).toBe("unknown");
  });
});
