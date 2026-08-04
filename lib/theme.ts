export const THEMES = ["light", "sepia", "dark"] as const;

export type Theme = (typeof THEMES)[number];

/** Cookie persisting the visitor's theme so SSR renders it without a flash. */
export const THEME_COOKIE = "bh-theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}
