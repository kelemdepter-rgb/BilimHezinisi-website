import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { FAILED_RENDER_SOURCE } from "@/lib/pwa/constants";

/**
 * A page that failed on the server must never become the offline copy of the
 * page that was asked for (PROMPT-40, Part C5).
 *
 * Once a route's loading skeleton has streamed, the 200 has gone out; a
 * database that then does not answer ends the stream with React's
 * `$RX("B:0","<digest>")` — "render this part in the browser", which shows
 * app/error.tsx. That is a 200, marked cacheable by proxy.ts like any
 * anonymous page. Stored, it would replace a good book page with "the library
 * is not answering" for as long as the reader stayed offline.
 *
 * The fragments below are copied from what a local production build of this
 * site actually sent for /books/22 with its database blackholed, and for the
 * same page with the database answering (2026-10-06).
 *
 * The worker is RUN here, in a VM with a stand-in Cache Storage — not read
 * as text — so what is proved is what it does.
 */

const source = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");

const FAILED_PAGE =
  '<!DOCTYPE html><html lang="ug" dir="rtl"><body><!--$?--><template id="B:0"></template>' +
  '<div class="skeleton"></div><!--/$--><script>$RX=function(b,c,d,e,f){var a=document.getElementById(b)}' +
  ';$RX("B:0","1454628011")</script></body></html>';
const OUR_ERROR_PAGE = '<html><body><div data-testid="error-page" data-bh-error-page="">…</div></body></html>';
const OLDER_REACT_FAILURE = '<html><body><!--$!--><template data-dgst="1454628011"></template><!--/$--></body></html>';
const GOOD_PAGE =
  '<!DOCTYPE html><html lang="ug" dir="rtl"><body><!--$--><h1>سەھىھ ھەدىسلەر توپلىمى</h1><!--/$-->' +
  '<script>self.__next_f.push([1,"0:{\\"P\\":null}"])</script></body></html>';

function loadWorker() {
  const stored = new Map<string, string>();
  const cache = {
    put: async (key: string, response: Response) => void stored.set(String(key), await response.text()),
    keys: async () => [...stored.keys()],
    delete: async (key: string) => stored.delete(String(key)),
    match: async () => undefined,
  };
  const context = vm.createContext({
    self: {
      location: { href: "https://bilimhezinisi.com/sw.js" },
      addEventListener: () => undefined,
    },
    caches: { open: async () => cache, match: async () => undefined, keys: async () => [], delete: async () => true },
    fetch: async () => {
      throw new Error("no network in this test");
    },
    Response,
    Headers,
    Request,
    URL,
    console,
  });
  vm.runInContext(`${source}\n;globalThis.__keepDocument = keepDocument;`, context);
  const keep = context.__keepDocument as (key: string, response: Response) => Promise<void>;
  return { keep, stored };
}

const html = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html", "x-bilim-cacheable": "1" } });

describe("the service worker's offline copies", () => {
  it("keeps a page that rendered", async () => {
    const { keep, stored } = loadWorker();
    await keep("https://bilimhezinisi.com/books/22", html(GOOD_PAGE));
    expect(stored.get("https://bilimhezinisi.com/books/22")).toBe(GOOD_PAGE);
  });

  it.each([
    ["React's client-render instruction after a streamed failure", FAILED_PAGE],
    ["the site's own error page", OUR_ERROR_PAGE],
    ["the older React form of the same failure", OLDER_REACT_FAILURE],
  ])("never keeps %s — the good copy stays", async (_label, body) => {
    const { keep, stored } = loadWorker();
    await keep("https://bilimhezinisi.com/books/22", html(GOOD_PAGE));
    await keep("https://bilimhezinisi.com/books/22", html(body));
    expect(stored.get("https://bilimhezinisi.com/books/22")).toBe(GOOD_PAGE);
  });

  it("uses the same pattern the app documents (lib/pwa/constants.ts)", () => {
    const literal = /const FAILED_RENDER = \/(.*)\/;/.exec(source)?.[1];
    expect(literal).toBe(FAILED_RENDER_SOURCE);
    const pattern = new RegExp(FAILED_RENDER_SOURCE);
    expect(pattern.test(FAILED_PAGE)).toBe(true);
    expect(pattern.test(GOOD_PAGE)).toBe(false);
  });

  it("routes both of its document writes through that check", () => {
    // The network-first handler and the signed-in reader's public copy.
    expect(source).toContain("event.waitUntil(keepDocument(key, response.clone()))");
    expect(source).toContain("if (isKeepableDocument(response, new URL(key))) await keepDocument(key, response)");
    expect(source).not.toMatch(/put\(DOCS, key, response/);
  });
});
