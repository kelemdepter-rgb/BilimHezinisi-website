import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { IconSprite } from "@/components/icons";
import { AppShell } from "@/components/app-shell";
import { getCategories, getSessionInfo } from "@/lib/data";
import { THEME_COLOR } from "./manifest";
import { OfflineBridge } from "@/components/pwa/offline-bridge";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/seo";
import { THEME_COOKIE, isTheme } from "@/lib/theme";

export const metadata: Metadata = {
  // Everything relative below (canonicals, OG images) resolves against this.
  metadataBase: new URL(siteUrl()),
  title: {
    default: SITE_NAME,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "ug",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
  /**
   * iOS never offers to install a site by itself — the reader has to pick
   * "Add to Home Screen" from the share sheet — so these tags are the only
   * thing standing between an iPhone shortcut that opens Safari with its
   * chrome and one that opens the library full screen. A large part of this
   * audience reads on an iPhone, which is why they are spelled out here
   * rather than left to the manifest, which Safari still only partly reads.
   */
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    // "default" keeps the status bar legible over the ivory paper; the black
    // translucent style would put white glyphs on it.
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  /**
   * Colours the browser's own chrome around the page. Light mode takes the
   * manuscript gold `--am`, the same value the manifest gives the splash
   * screen, so an installed copy and a browser tab read as one thing. Dark
   * mode takes the night theme's `--bg2` instead: gold at full strength is
   * exactly what someone reading in the dark turned the lights off to avoid.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR },
    { media: "(prefers-color-scheme: dark)", color: "#1E1910" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookieStore = await cookies();
  const rawTheme = cookieStore.get(THEME_COOKIE)?.value;
  const theme = isTheme(rawTheme) ? rawTheme : null;
  /**
   * The shell awaits the category tree — which is cached, and which the
   * sidebar cannot be drawn without — and nothing else. Who is reading is
   * handed down as a promise: it costs a look in the profiles table, and
   * every navigation used to wait for it before a single pixel could change.
   *
   * `looksSignedIn` is the mere presence of an auth cookie, not a claim about
   * it. It only decides how large a placeholder to hold open while the real
   * answer streams in, so that nothing shifts when it arrives. It is never an
   * authorisation decision, and the controls themselves come from the
   * verified session.
   */
  const categories = await getCategories();
  const sessionPromise = getSessionInfo();
  const looksSignedIn = cookieStore
    .getAll()
    .some((cookie) => /^sb-.+-auth-token(\.\d+)?$/.test(cookie.name));

  return (
    <html lang="ug" dir="rtl" suppressHydrationWarning {...(theme ? { "data-theme": theme } : {})}>
      <head>
        {/*
          Every page is set in UKIJ Ekran, but a @font-face is only discovered
          after the CSS parses, so the first paint uses a fallback and the whole
          page reflows when the real font lands. Preloading it removes that
          shift — the single biggest layout-stability win here.

          ONLY this one family is preloaded. The other reading faces (UKIJ Tuz,
          Tuz Tom, Tuz Kitab) and the Quran's Uthmanic Hafs are fetched lazily
          by the @font-face rules that reference them, so a visitor who never
          opens the reader never pays for them.
        */}
        <link
          rel="preload"
          href="/fonts/ukijekran.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/*
          Next emits the modern <meta name="mobile-web-app-capable">, which
          Safari only learned to read in iOS 17.4. Phones older than that —
          a large part of this audience — still need the apple- prefixed
          spelling, or "Add to Home Screen" produces a bookmark that opens in
          Safari with its chrome instead of a full-screen app.
        */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/*
          Feed discovery, written into the head directly rather than through
          metadata.alternates.types. A page that sets its own `alternates`
          — and every page here sets a canonical — replaces the layout's
          whole alternates object, which silently took this link away again.
          A raw tag cannot be overridden by accident.
        */}
        <link
          rel="alternate"
          type="application/atom+xml"
          title={SITE_NAME}
          href="/feed.xml"
        />
      </head>
      <body className="min-h-dvh">
        <IconSprite />
        <AppShell
          theme={theme}
          sessionPromise={sessionPromise}
          looksSignedIn={looksSignedIn}
          categories={categories}
        >
          {children}
        </AppShell>
        {/* Registers the service worker and carries the update toast. Renders
            nothing at all until there is something to say. */}
        <OfflineBridge />
      </body>
    </html>
  );
}
