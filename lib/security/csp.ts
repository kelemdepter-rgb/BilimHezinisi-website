/**
 * The site's Content Security Policy.
 *
 * Built per request in proxy.ts, because the script policy is nonce-based:
 * Next's bootstrap is an inline script, and the alternative to a nonce is
 * `'unsafe-inline'` on script-src, which would let any injected `<script>`
 * run and make the whole policy decorative. Next picks the nonce out of this
 * header itself and stamps it onto its own scripts, so nothing here has to be
 * threaded through the component tree — except the two JSON-LD blocks, which
 * are ours and read `x-nonce` from the request headers.
 */

/** Where the Supabase project lives, if it is configured. */
function supabaseOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy(nonce: string, isDev: boolean): string {
  const supabase = supabaseOrigin();
  // Realtime and the auth token refresh both open sockets to the same host.
  const supabaseSocket = supabase ? supabase.replace(/^https:/, "wss:") : null;

  const directives: string[] = [
    "default-src 'self'",

    /**
     * 'strict-dynamic' lets the nonced bootstrap load the rest of the bundle
     * without every chunk needing its own nonce, and makes host allowlists
     * irrelevant to an attacker who cannot forge the nonce. 'self' stays for
     * browsers that do not understand 'strict-dynamic'.
     *
     * 'unsafe-eval' is dev-only: React uses eval there to rebuild server
     * stack traces in the browser. Production needs neither eval nor the
     * dev-overlay machinery.
     */
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,

    /**
     * Styles keep 'unsafe-inline', deliberately and with the reasoning
     * written down: the reader and the mushaf set font-size, line-height and
     * font-family through the `style` attribute, which is what a reader's own
     * typography controls change. A nonce cannot authorise a style ATTRIBUTE
     * — only a `<style>` element — so the choice is between this and taking
     * the typography controls away. Injected CSS is a far smaller problem
     * than injected script, and script-src above is strict.
     */
    "style-src 'self' 'unsafe-inline'",

    // data: for the paper-grain SVG in the design tokens, blob: for the cover
    // preview an admin sees before the upload finishes.
    `img-src 'self' data: blob:${supabase ? ` ${supabase}` : ""}`,

    // Self-hosted only. No CDN has ever been allowed to serve this site a font.
    "font-src 'self'",

    /**
     * Supabase is the only outside host the browser talks to: PostgREST,
     * Auth, Storage uploads, and the websocket the auth client keeps.
     *
     * WHEN THE AI LAYER LANDS, add https://generativelanguage.googleapis.com
     * here — and nothing else. Do not relax the policy to make one request
     * work; a missing origin is a one-line fix in this list.
     */
    [
      "connect-src 'self'",
      supabase,
      supabaseSocket,
      // The dev server's HMR socket and its own origin.
      isDev ? "ws: http://localhost:* http://127.0.0.1:*" : null,
    ]
      .filter(Boolean)
      .join(" "),

    // The spellcheck worker is bundled by Next and served from this origin.
    "worker-src 'self' blob:",

    "media-src 'self'",
    "manifest-src 'self'",
    // Nothing on this site is a plugin, an applet or an iframe.
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    // Forms post to this site: Server Actions and the search box, nothing else.
    "form-action 'self'",
    // Only this site may frame these pages.
    "frame-ancestors 'self'",
  ];

  // Harmless over https, and over plain http on localhost it would break the
  // dev server, so it is production-only.
  if (!isDev) directives.push("upgrade-insecure-requests");

  return directives.join("; ");
}

/**
 * Headers that are the same on every response and need no per-request value.
 * Set in next.config.ts so they also cover the files in public/, which the
 * proxy deliberately does not run on.
 */
export const STATIC_SECURITY_HEADERS = [
  // Never let a browser guess that a .json export is really HTML.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send the full URL within this site, only the origin when leaving it — so
  // a link out of a book never tells the other site which book it was.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // A library needs none of these, and saying so stops an embedded frame from
  // asking on our behalf.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // frame-ancestors above is the modern form; this is for browsers that
  // predate it.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
] as const;
