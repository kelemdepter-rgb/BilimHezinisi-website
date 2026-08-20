import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";

/**
 * The web app manifest — what a phone reads when someone adds the library to
 * their home screen.
 *
 * The colours are the light-theme design tokens, not new values: `--bg` for
 * the splash background and `--am` for the theme colour, so the launch screen
 * is the same paper-and-gold as the site itself (app/globals.css `:root`).
 * They cannot be `var(--bg)` here — a manifest is JSON read outside any
 * document — so they are copied literally and a unit test keeps them in step.
 */
export const BACKGROUND_COLOR = "#FBF6EC";
export const THEME_COLOR = "#B0832F";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE_NAME,
    // Home screens truncate at roughly 12 characters; the full name would be
    // cut mid-word, and «خەزىنە» on its own is the half that identifies it.
    short_name: "بىلىم خەزىنە",
    description: SITE_DESCRIPTION,
    lang: "ug",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    categories: ["books", "education", "reference"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops an icon to its own shape; the maskable cut keeps the
      // gold frame inside the safe zone so nothing important is sliced off.
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "قۇرئان كەرىم", short_name: "قۇرئان", url: "/quran" },
      { name: "ئىزدەش", short_name: "ئىزدەش", url: "/search" },
    ],
  };
}
