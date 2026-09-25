import { describe, expect, it } from "vitest";
import {
  BLOCKED_PROVIDER_DOMAINS,
  BLOCKED_TLDS,
} from "@/lib/auth/blocked-email-domains";
import {
  COMMON_DOMAINS,
  editDistance,
  isBlockedJurisdiction,
  isPrcMailHost,
  parseEmail,
  suggestDomain,
  withDomain,
} from "@/lib/auth/email";

/**
 * Judging an address before an email is spent on it (PROMPT-38 B1). Every
 * case the prompt names is here, verbatim.
 */

describe("syntax", () => {
  const accepted = [
    "name@gmail.com",
    "a.b+tag@outlook.com",
    "x@yandex.ru",
    "me@icloud.com",
    "n@mail.ru",
    "s@university.edu.tr",
    "p@sub.company.co.uk",
    "k@yahoo.co.jp",
    "h@hotmail.co.uk",
    "o@outlook.com.tr",
    "t@school.edu.tw",
  ];
  for (const address of accepted) {
    it(`accepts ${address}`, () => {
      expect(parseEmail(address)?.email).toBe(address);
    });
  }

  const rejected: Array<[string, string]> = [
    ["no @", "name.gmail.com"],
    ["two @", "a@b@gmail.com"],
    ["a space inside", "na me@gmail.com"],
    ["a space in the domain", "name@gm ail.com"],
    ["consecutive dots", "a..b@x.com"],
    ["no dot in the domain", "a@x"],
    ["a one-letter TLD", "a@x.c"],
    ["a trailing dot", "a@x.com."],
    ["a leading dot", ".a@x.com"],
    ["a dot before the @", "a.@x.com"],
    ["nothing before the @", "@x.com"],
    ["nothing after the @", "a@"],
    // 255 characters, every label within DNS's own 63.
    [
      "more than 254 characters",
      `${"a".repeat(64)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.eee.com`,
    ],
  ];
  for (const [why, address] of rejected) {
    it(`rejects ${why}: ${address}`, () => {
      expect(parseEmail(address)).toBeNull();
    });
  }

  it("normalises: trims, lower-cases the domain, keeps the local part as typed", () => {
    expect(parseEmail("  Ali.Veli@GMail.COM ")).toEqual({
      email: "Ali.Veli@gmail.com",
      local: "Ali.Veli",
      domain: "gmail.com",
    });
  });

  it("converts an internationalised domain to its ASCII form before anything else", () => {
    expect(parseEmail("a@例子.中国")?.domain).toBe("xn--fsqu00a.xn--fiqs8s");
    expect(parseEmail("a@bücher.de")?.domain).toBe("xn--bcher-kva.de");
  });

  it("accepts a long TLD", () => {
    expect(parseEmail("a@example.photography")?.domain).toBe("example.photography");
  });

  it("is not a whitelist: an unfamiliar domain is fine", () => {
    expect(parseEmail("reader@my-own-family-domain.org")).not.toBeNull();
  });
});

describe("the Chinese-jurisdiction block", () => {
  const blocked = [
    "1234@qq.com",
    "a@vip.qq.com",
    "a@foxmail.com",
    "a@163.com",
    "a@126.com",
    "a@yeah.net",
    "a@sina.com",
    "a@sohu.com",
    "a@aliyun.com",
    "a@company.com.cn",
    "a@x.cn",
    "a@x.com.hk",
    "a@x.hk",
    "a@x.mo",
    "a@例子.中国",
    "a@例子.中國",
    "a@例子.香港",
    "a@例子.澳門",
    "A@QQ.COM",
    "a@Mail.Sina.Com.CN",
  ];
  for (const address of blocked) {
    it(`blocks ${address}`, () => {
      const parsed = parseEmail(address);
      expect(parsed, `${address} must parse`).not.toBeNull();
      expect(isBlockedJurisdiction(parsed!.domain)).toBe(true);
    });
  }

  const allowed = [
    "a@x.tw",
    "a@gmail.com",
    "a@outlook.com",
    "a@proton.me",
    "a@icloud.com",
    "a@yahoo.com",
    "a@cnn.com",
    "a@qqq-books.org",
    "a@cn.example.com.tr",
    "a@mo.nl",
    "a@hk-shop.de",
  ];
  for (const address of allowed) {
    it(`does not block ${address}`, () => {
      expect(isBlockedJurisdiction(parseEmail(address)!.domain)).toBe(false);
    });
  }

  it("covers every entry and everything beneath it", () => {
    for (const entry of [...BLOCKED_TLDS, ...BLOCKED_PROVIDER_DOMAINS]) {
      expect(isBlockedJurisdiction(entry), entry).toBe(true);
      expect(isBlockedJurisdiction(`mail.${entry}`), `mail.${entry}`).toBe(true);
    }
  });

  it("judges a mail exchanger by the same list plus the PRC mail hosts", () => {
    expect(isPrcMailHost("mxbiz1.qq.com")).toBe(true); // Tencent Exmail
    expect(isPrcMailHost("qiye163mx01.mxmail.netease.com")).toBe(true); // NetEase enterprise
    expect(isPrcMailHost("mxw.mxhichina.com")).toBe(true); // Alibaba, older
    expect(isPrcMailHost("mx1.qiye.aliyun.com")).toBe(true); // Alibaba, newer
    expect(isPrcMailHost("mxwcom.263xmail.com")).toBe(true); // 263
    expect(isPrcMailHost("mx-china-com.icoremail.net")).toBe(true); // Coremail
    expect(isPrcMailHost("MX.SINANET.COM.")).toBe(true);
    expect(isPrcMailHost("aspmx.l.google.com")).toBe(false);
    expect(isPrcMailHost("company-com.mail.protection.outlook.com")).toBe(false);
  });
});

describe("typo suggestions", () => {
  const typos: Array<[string, string]> = [
    ["gmial.com", "gmail.com"],
    ["gmai.com", "gmail.com"],
    ["gmail.co", "gmail.com"],
    ["gmal.com", "gmail.com"],
    ["hotmial.com", "hotmail.com"],
    ["outlok.com", "outlook.com"],
    ["gamil.com", "gmail.com"],
    ["gmail.con", "gmail.com"],
    ["yahooo.com", "yahoo.com"],
    ["iclod.com", "icloud.com"],
  ];
  for (const [typed, meant] of typos) {
    it(`${typed} → ${meant}`, () => {
      expect(suggestDomain(typed)).toBe(meant);
    });
  }

  it("says nothing for an exact match", () => {
    for (const domain of COMMON_DOMAINS) expect(suggestDomain(domain), domain).toBeNull();
  });

  const realLookAlikes = [
    "yahoo.co.jp",
    "hotmail.co.uk",
    "outlook.com.tr",
    "gmx.de",
    "mail.com",
    "email.com",
    "ymail.com",
    "ttmail.com",
    "yahoo.ca",
    "hotmail.ca",
    "live.ca",
    "gmx.ch",
    "gmx.net",
    "protonmail.ch",
    "yandex.ua",
    "mac.com",
    "aim.com",
    "cnn.com",
  ];
  for (const domain of realLookAlikes) {
    it(`leaves the real ${domain} alone`, () => {
      expect(suggestDomain(domain)).toBeNull();
    });
  }

  it("says nothing for a domain that is merely unfamiliar", () => {
    expect(suggestDomain("university.edu.tr")).toBeNull();
    expect(suggestDomain("my-own-family-domain.org")).toBeNull();
  });

  it("says nothing when two common domains are equally near", () => {
    // Two edits from yahoo.com, two from yandex.com.
    expect(editDistance("yahex.com", "yahoo.com")).toBe(2);
    expect(editDistance("yahex.com", "yandex.com")).toBe(2);
    expect(suggestDomain("yahex.com")).toBeNull();
  });

  it("never suggests for a blocked address, and never suggests a blocked domain", () => {
    expect(suggestDomain("gmail.cn")).toBeNull();
    expect(suggestDomain("hotmail.com.cn")).toBeNull();
    expect(suggestDomain("qq.co")).toBeNull();
    for (const domain of COMMON_DOMAINS) expect(isBlockedJurisdiction(domain), domain).toBe(false);
  });

  it("counts a swap of neighbouring letters as one edit", () => {
    expect(editDistance("gmial.com", "gmail.com")).toBe(1);
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("", "abc")).toBe(3);
  });

  it("replaces only the domain", () => {
    expect(withDomain("Ali.Veli+x@gmial.com", "gmail.com")).toBe("Ali.Veli+x@gmail.com");
  });
});
