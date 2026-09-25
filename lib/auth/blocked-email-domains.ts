/**
 * Email addresses the library refuses: anything under the jurisdiction of the
 * People's Republic of China, Hong Kong and Macau included (PROMPT-38, the
 * owner's rule).
 *
 * HOW TO EDIT. Add or remove a line below, lower case, no leading dot. Every
 * entry also covers everything beneath it: "qq.com" catches "vip.qq.com", and
 * "cn" catches "sina.com.cn" — so a sub-domain never needs a line of its own.
 * lib/auth/email.ts is the only reader of these lists.
 *
 * WHAT IS NOT HERE, on purpose. Taiwan (`tw`) and every other country are
 * allowed. So are international providers that merely have Chinese users —
 * Gmail, Outlook, Yahoo, iCloud, Proton. The rule is about who holds the
 * mailbox, not about who reads it.
 */

/**
 * Country-code top-level domains, in both spellings. The internationalised
 * forms are listed as the ASCII (punycode) labels DNS actually uses, because
 * an address is converted to that form before it is judged — otherwise
 * `x@例子.中国` would slip past a rule written as "cn".
 *
 * Source: the IANA root zone database (iana.org/domains/root/db), where each
 * is delegated as a country-code TLD.
 */
export const BLOCKED_TLDS: readonly string[] = [
  "cn", // China
  "hk", // Hong Kong
  "mo", // Macau
  "xn--fiqs8s", // .中国 — China, simplified (CNNIC)
  "xn--fiqz9s", // .中國 — China, traditional (CNNIC)
  "xn--j6w193g", // .香港 — Hong Kong (HKIRC)
  "xn--mix891f", // .澳門 — Macau (MONIC)
];

/**
 * Mail services run from the PRC on generic TLDs, where the TLD alone says
 * nothing.
 *
 * The first block is the list the owner's prompt gave. The second was found
 * while writing this, each with where it came from; "MX 2026-09-25" means the
 * domain's own mail exchangers were looked up that day and point at the
 * provider named.
 */
export const BLOCKED_PROVIDER_DOMAINS: readonly string[] = [
  // From PROMPT-38.
  "qq.com", // Tencent QQ Mail (vip.qq.com is covered by this line)
  "foxmail.com", // Tencent — Foxmail was bought by Tencent in 2005; MX → mx*.qq.com
  "163.com", // NetEase
  "126.com", // NetEase
  "yeah.net", // NetEase
  "188.com", // NetEase (paid mailbox)
  "netease.com", // NetEase's own and its enterprise mail exchangers
  "sina.com", // Sina
  "sina.net", // Sina enterprise mail
  "sohu.com", // Sohu
  "aliyun.com", // Alibaba Mail (personal and qiye.aliyun.com enterprise)
  "139.com", // China Mobile
  "tom.com", // TOM Group
  "21cn.com", // China Telecom's 21CN — also receives mail for 189.cn
  "263.net", // 263 Network Communications
  "2980.com", // 2980 mailbox (Guangzhou)
  "china.com", // China.com; MX 2026-09-25 → mx-china-com.icoremail.net
  "chinaren.com", // ChinaRen, owned by Sohu

  // Added while researching.
  "sohu.net", // Sohu enterprise mail; MX 2026-09-25 → mx.mail.sohu.net
  "sogou.com", // Sogou (Sohu, then Tencent); MX 2026-09-25 → mx.sogou.com
  "163.net", // TOM Group's older 163.net mailbox; MX 2026-09-25 → 163mx.cdn.163.net
  "eyou.com", // eYou (亿邮), a Beijing mail provider; MX 2026-09-25 → extmx.eyou.com
];

/**
 * Where PRC-hosted mail for OTHER domains is received.
 *
 * A company on Tencent Exmail, NetEase's enterprise mail or Alibaba Mail keeps
 * its own innocent-looking domain; only its MX records give it away. The MX
 * check in lib/auth/email-dns.ts blocks a domain when EVERY one of its mail
 * exchangers falls under an entry here, under BLOCKED_PROVIDER_DOMAINS, or
 * under BLOCKED_TLDS. A domain with even one exchanger elsewhere is allowed.
 *
 * Parents cover children here too, so "qq.com" already includes
 * "exmail.qq.com" and "mxbiz1.qq.com", and "163.com" includes "qiye.163.com".
 */
export const PRC_MAIL_HOSTING_SUFFIXES: readonly string[] = [
  // Tencent Exmail: mxbiz1.qq.com / mxbiz2.qq.com (and the older mx.exmail.qq.com)
  // — covered by "qq.com" above; tencent.com itself: MX 2026-09-25 → cloudmx.qq.com.
  // NetEase enterprise mail: qiye163mx01.mxmail.netease.com — covered by "netease.com".
  // Alibaba Mail, older exchangers (help: mailhelp.mxhichina.com): mxn/mxw.mxhichina.com.
  // Its newer ones, mx1–mx3.qiye.aliyun.com, are covered by "aliyun.com".
  "mxhichina.com",
  // Sina enterprise mail; sina.net's own MX 2026-09-25 → mx.sinanet.com, mx.entmail.sina.com.
  "sinanet.com",
  // 263 enterprise mail (263.net help centre): mxwcom.263xmail.com, mxcom.263xmail.com.
  "263xmail.com",
  // Coremail's hosted service; china.com's own MX 2026-09-25 → mx-china-com.icoremail.net.
  "icoremail.net",
];
