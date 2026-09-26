/**
 * Fixed DNS answers for the sign-in and registration specs.
 *
 * Loaded ONLY into the dev server the `auth-flow-*` projects start on :3300
 * (NODE_OPTIONS=--import, playwright.config.ts) — never into the ordinary dev
 * server, never into a build. lib/auth/email-dns.ts asks `node:dns`'s
 * Resolver about an address's domain; these answers make that deterministic,
 * so a spec can prove "a custom domain on Tencent Exmail is refused" or "a
 * domain that does not exist is refused" without depending on anybody's real
 * DNS. Any domain not listed here goes to the real resolver as usual.
 */
import dns from "node:dns";

const TABLE = new Map([
  // Like the real gmial.com: an address, but no mail exchanger.
  ["gmial.com", { resolveMx: "ENODATA", resolve4: ["192.0.2.10"], resolve6: "ENODATA" }],
  // Like the real gmal.com: nowhere at all to deliver to.
  ["gmal.com", { resolveMx: "ENODATA", resolve4: "ENODATA", resolve6: "ENODATA" }],
  // A company domain whose mail Tencent Exmail receives.
  [
    "exmail-customer.test",
    {
      resolveMx: [
        { exchange: "mxbiz1.qq.com", priority: 5 },
        { exchange: "mxbiz2.qq.com", priority: 10 },
      ],
    },
  ],
  // Nothing there at all.
  ["no-such-domain.test", { resolveMx: "ENOTFOUND", resolve4: "ENOTFOUND", resolve6: "ENOTFOUND" }],
  // A company domain whose mail is received outside the PRC.
  ["company.test", { resolveMx: [{ exchange: "aspmx.l.google.com", priority: 1 }] }],
  // One slip from outlook.com, but receiving mail and on no list: a typo a
  // reader may deliberately keep.
  ["outlok.com", { resolveMx: [{ exchange: "mx.outlok.com", priority: 10 }] }],
  // A throwaway-address service, for the one place it is looked up: signing
  // in to an account made before the list existed.
  ["guerrillamail.com", { resolveMx: [{ exchange: "mx.guerrillamail.com", priority: 10 }] }],
]);

const prototype = dns.promises.Resolver.prototype;

for (const method of ["resolveMx", "resolve4", "resolve6"]) {
  const real = prototype[method];
  prototype[method] = function stubbed(hostname, ...rest) {
    const entry = TABLE.get(String(hostname).toLowerCase());
    if (!entry) return real.call(this, hostname, ...rest);
    const answer = entry[method] ?? "ENODATA";
    if (typeof answer === "string") {
      return Promise.reject(Object.assign(new Error(`${method} ${answer} ${hostname}`), { code: answer }));
    }
    return Promise.resolve(answer);
  };
}
