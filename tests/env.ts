import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Playwright does not read .env.local, so load it here. Values already in the
 * environment win, which keeps CI overrides working.
 */
export function loadEnvLocal(root = process.cwd()): void {
  let raw: string;
  try {
    raw = readFileSync(join(root, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

/** Admin-area tests need a real session, which needs the service-role key. */
export function hasStaffTestEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export const STAFF_STATE_PATH = "tests/.auth/staff.json";
export const STAFF_EMAIL = "bh-e2e-uploader@mailinator.com";
export const STAFF_PASSWORD = "bh-e2e-password-8842";
