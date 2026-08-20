/**
 * How many bytes a visit actually costs, with and without the service worker.
 *
 * The offline work in PROMPT 14 is only worth having if it also spends less of
 * the free plan's allowances, so the claim has to be measured rather than
 * asserted. Two different budgets are at stake and they are reported apart,
 * because the same change moves them by very different amounts:
 *
 *   site        bytes between the reader and Vercel — the app shell, the CSS,
 *               the fonts, the HTML. Vercel Hobby allows 100 GB a month.
 *   supabase    bytes between the reader's browser and Supabase — book text
 *               fetched as the reader scrolls or jumps. This is the 5 GB
 *               allowance CLAUDE.md is careful about.
 *
 * What this CANNOT see: the first window of pages is fetched by the server
 * while rendering the reader, so those bytes go Supabase → Vercel and never
 * touch the browser. No service worker can remove them; they are the floor.
 *
 *   npm run build && npx next start -p 3100
 *   node scripts/measure-egress.mjs [http://localhost:3100]
 *
 * "before" runs the context with serviceWorkers: "block" — the site exactly as
 * it was, with the browser's ordinary HTTP cache still doing its job. That is
 * the honest baseline: the gain reported here is the gain ON TOP of HTTP
 * caching. It must NOT be done by routing /sw.js to abort: turning on request
 * interception also turns off the browser's disk cache, which would flatter
 * the result by making every "before" repeat visit a cold one.
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const base = (process.argv[2] ?? "http://localhost:3100").replace(/\/+$/, "");

function env(key) {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(raw);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
}

const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SUPABASE_HOST = new URL(SUPABASE_URL).host;

/** The longest published book — the worst case a download has to survive. */
async function biggestBook() {
  const url = `${SUPABASE_URL}/rest/v1/books?select=id,title,page_count&status=eq.published&order=page_count.desc&limit=1`;
  const response = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const rows = await response.json();
  return rows[0] ?? null;
}

/**
 * Wire bytes for everything the page and its worker fetched, split by host and
 * attributed to the step that was running when the request finished.
 *
 * The step label is captured synchronously in the listener and request.sizes()
 * is resolved later: awaiting inside the listener would let a request land in
 * whichever step happened to be current when the promise settled, which is how
 * an earlier version of this script reported book text being fetched before
 * anything had asked for it.
 */
function meter(context) {
  const pending = [];
  const marker = { step: "setup" };
  context.on("requestfinished", (request) => {
    pending.push({ step: marker.step, host: new URL(request.url()).host, sizes: request.sizes() });
  });
  return {
    marker,
    async totals() {
      const steps = {};
      for (const entry of pending) {
        let bytes = 0;
        try {
          /**
           * Raced against a timeout on purpose. A request the service worker
           * answered out of its own cache never produced a network response,
           * and asking Playwright for its size simply never returns — which
           * hung this script for twenty minutes before the race was added.
           * A size that cannot be learned is zero bytes on the wire, which is
           * also the truth for a cache hit.
           */
          const sizes = await Promise.race([
            entry.sizes,
            new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
          ]);
          if (!sizes) continue;
          bytes = sizes.responseBodySize + sizes.responseHeadersSize;
        } catch {
          continue; // The context closed before the size was known.
        }
        const step = (steps[entry.step] ??= { site: 0, supabase: 0, requests: 0 });
        if (entry.host === SUPABASE_HOST) step.supabase += bytes;
        else step.site += bytes;
        step.requests += 1;
      }
      return steps;
    },
  };
}

const EMPTY = { site: 0, supabase: 0, requests: 0 };

const settle = (page) => page.waitForTimeout(2000);

/** Read further into the book, the way someone working through it would. */
async function readDeeper(page, pages) {
  for (const pageNo of pages) {
    await page.getByTestId("page-jump").fill(String(pageNo));
    await page.getByTestId("page-jump-go").click();
    await page.waitForTimeout(900);
  }
}

async function scenario({ label, withServiceWorker, book }) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    serviceWorkers: withServiceWorker ? "allow" : "block",
  });

  const page = await context.newPage();
  const { marker, totals } = meter(context);
  const deep = [50, 120, 200].filter((pageNo) => pageNo <= book.page_count);

  marker.step = "firstHome";
  await page.goto(`${base}/`, { waitUntil: "load" });
  await settle(page);

  marker.step = "firstBook";
  await page.goto(`${base}/books/${book.id}/read`, { waitUntil: "load" });
  await settle(page);

  marker.step = "firstReading";
  await readDeeper(page, deep);
  await settle(page);

  // A repeat visit the way a reader actually comes back: fresh navigations in
  // the same browser, days later, to the book they were in the middle of.
  marker.step = "repeatHome";
  await page.goto(`${base}/`, { waitUntil: "load" });
  await settle(page);

  marker.step = "repeatBook";
  await page.goto(`${base}/books/${book.id}/read`, { waitUntil: "load" });
  await settle(page);

  marker.step = "repeatReading";
  await readDeeper(page, deep);
  await settle(page);

  const steps = await totals();
  await browser.close();
  return {
    label,
    firstHome: steps.firstHome ?? EMPTY,
    firstBook: steps.firstBook ?? EMPTY,
    firstReading: steps.firstReading ?? EMPTY,
    repeatHome: steps.repeatHome ?? EMPTY,
    repeatBook: steps.repeatBook ?? EMPTY,
    repeatReading: steps.repeatReading ?? EMPTY,
  };
}

/** What one whole-book download costs, cold — nothing cached to reuse. */
async function downloadCost(book) {
  let bytes = 0;
  let requests = 0;
  const BATCH = 100;
  for (let from = 1; from <= book.page_count; from += BATCH) {
    const to = Math.min(from + BATCH - 1, book.page_count);
    const url =
      `${SUPABASE_URL}/rest/v1/book_pages?select=page_no,content&book_id=eq.${book.id}` +
      `&page_no=gte.${from}&page_no=lte.${to}&order=page_no.asc`;
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        // What the browser asks for, so this measures compressed bytes rather
        // than raw JSON nobody ever transfers.
        "Accept-Encoding": "gzip, br",
      },
    });
    const buffer = await response.arrayBuffer();
    bytes += buffer.byteLength;
    requests += 1;
  }
  return { bytes, requests };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const change = (b, a) => (b === 0 ? (a === 0 ? "—" : "new") : `${(((a - b) / b) * 100).toFixed(0)}%`);

const book = await biggestBook();
if (!book) {
  console.error("No published book to measure against.");
  process.exit(1);
}
console.log(`Longest published book: #${book.id} "${book.title}" — ${book.page_count} pages\n`);

const before = await scenario({ label: "before", withServiceWorker: false, book });
const after = await scenario({ label: "after", withServiceWorker: true, book });

const STEPS = [
  ["first visit — home", "firstHome"],
  ["first visit — open book", "firstBook"],
  ["first visit — read on", "firstReading"],
  ["repeat visit — home", "repeatHome"],
  ["repeat visit — open book", "repeatBook"],
  ["repeat visit — read on", "repeatReading"],
];

for (const budget of ["site", "supabase"]) {
  console.log(`\n${budget === "site" ? "SITE (Vercel)" : "SUPABASE (the 5 GB allowance)"}`);
  console.log("step".padEnd(26) + "before".padStart(12) + "after".padStart(12) + "change".padStart(10));
  for (const [name, key] of STEPS) {
    const b = before[key][budget];
    const a = after[key][budget];
    console.log(name.padEnd(26) + kb(b).padStart(12) + kb(a).padStart(12) + change(b, a).padStart(10));
  }
  const b = STEPS.slice(3).reduce((sum, [, key]) => sum + before[key][budget], 0);
  const a = STEPS.slice(3).reduce((sum, [, key]) => sum + after[key][budget], 0);
  console.log("repeat visit TOTAL".padEnd(26) + kb(b).padStart(12) + kb(a).padStart(12) + change(b, a).padStart(10));
}

const download = await downloadCost(book);
console.log(
  `\nwhole-book download (#${book.id}, ${book.page_count} pages, nothing cached): ` +
    `${kb(download.bytes)} of Supabase egress over ${download.requests} requests`,
);

console.log(`\n${JSON.stringify({ book, before, after, download })}`);
