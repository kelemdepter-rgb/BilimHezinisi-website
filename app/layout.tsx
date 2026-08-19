import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { IconSprite } from "@/components/icons";
import { AppShell } from "@/components/app-shell";
import { getCategories, getSessionInfo } from "@/lib/data";
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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookieStore = await cookies();
  const rawTheme = cookieStore.get(THEME_COOKIE)?.value;
  const theme = isTheme(rawTheme) ? rawTheme : null;
  const [session, categories] = await Promise.all([getSessionInfo(), getCategories()]);

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
      </head>
      <body className="min-h-dvh">
        <IconSprite />
        <AppShell theme={theme} session={session} categories={categories}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
