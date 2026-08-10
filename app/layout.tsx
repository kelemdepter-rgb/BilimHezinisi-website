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
      <body className="min-h-dvh">
        <IconSprite />
        <AppShell theme={theme} session={session} categories={categories}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
