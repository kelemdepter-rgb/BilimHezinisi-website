import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { IconSprite } from "@/components/icons";
import { AppShell } from "@/components/app-shell";
import { getCategories, getSessionInfo } from "@/lib/data";
import { THEME_COOKIE, isTheme } from "@/lib/theme";

export const metadata: Metadata = {
  title: {
    default: "بىلىم خەزىنىسى",
    template: "%s — بىلىم خەزىنىسى",
  },
  description:
    "«بىلىم خەزىنىسى» — ئۇيغۇرچە ئېلكىتابلارنى ئوقۇش، ئىزدەش ۋە ساقلاشقا قولايلىق ئوچۇق كۇتۇپخانا.",
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
