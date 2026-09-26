import { describe, expect, it } from "vitest";
import { COMMON_DOMAINS } from "@/lib/auth/email";
import {
  DISPOSABLE_ALLOWLIST,
  DISPOSABLE_DOMAINS,
  isDisposableDomain,
} from "@/lib/auth/disposable-domains";
import { DISPOSABLE_DOMAINS_RAW, DISPOSABLE_LIST_SOURCE } from "@/lib/auth/disposable-domains.list";

/** Throwaway mail services, refused at registration (PROMPT-39, part C). */

describe("disposable domains", () => {
  it("refuses the well-known throwaway services, and anything beneath them", () => {
    for (const domain of ["mailinator.com", "yopmail.com", "10minutemail.com", "guerrillamail.com", "inbox.mailinator.com"]) {
      expect(isDisposableDomain(domain), domain).toBe(true);
    }
    expect(isDisposableDomain("MAILINATOR.COM.")).toBe(true);
  });

  it("never refuses the providers real readers use", () => {
    const everyday = [
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
    for (const domain of [...everyday, ...COMMON_DOMAINS, ...DISPOSABLE_ALLOWLIST]) {
      expect(isDisposableDomain(domain), domain).toBe(false);
      expect(isDisposableDomain(`mail.${domain}`), `mail.${domain}`).toBe(false);
    }
  });

  it("does not refuse an unfamiliar but ordinary domain", () => {
    expect(isDisposableDomain("my-own-family-domain.org")).toBe(false);
    expect(isDisposableDomain("university.edu.tr")).toBe(false);
  });

  it("the allowlist always wins: nothing allowed, above or below an allowed domain is listed", () => {
    const allowed = [...COMMON_DOMAINS, ...DISPOSABLE_ALLOWLIST];
    const clashes = DISPOSABLE_DOMAINS.filter((entry) =>
      allowed.some((allow) => entry === allow || entry.endsWith(`.${allow}`) || allow.endsWith(`.${entry}`)),
    );
    expect(clashes).toEqual([]);
  });

  it("comes from the vendored CC0 list and is a sensible size", () => {
    expect(DISPOSABLE_LIST_SOURCE.license).toBe("CC0-1.0");
    expect(DISPOSABLE_DOMAINS_RAW.length).toBeGreaterThan(1000);
    expect(DISPOSABLE_DOMAINS.length).toBeLessThanOrEqual(DISPOSABLE_DOMAINS_RAW.length);
  });
});
