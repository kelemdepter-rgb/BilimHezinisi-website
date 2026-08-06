import { test as setup, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  STAFF_EMAIL,
  STAFF_PASSWORD,
  STAFF_STATE_PATH,
  hasStaffTestEnv,
  loadEnvLocal,
} from "./env";

loadEnvLocal();

/**
 * Provision a disposable `uploader` account and save its signed-in state, so
 * the admin specs exercise the real guard rather than a mock. Removed again by
 * auth.teardown.ts.
 */
setup("create and sign in a staff account", async ({ page }) => {
  setup.skip(!hasStaffTestEnv(), "Supabase env not configured");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const user of existing?.users ?? []) {
    if (user.email === STAFF_EMAIL) await admin.auth.admin.deleteUser(user.id);
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    email: STAFF_EMAIL,
    password: STAFF_PASSWORD,
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(`could not create test user: ${error?.message}`);
  const { error: roleError } = await admin
    .from("profiles")
    .update({ role: "uploader", display_name: "E2E سىناق" })
    .eq("id", created.user.id);
  if (roleError) throw new Error(`could not set uploader role: ${roleError.message}`);

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(STAFF_EMAIL);
  await page.locator('input[name="password"]').fill(STAFF_PASSWORD);
  await page.getByRole("button", { name: "كىرىش" }).click();

  // The admin link only renders for a staff session, so it proves the role took.
  await expect(page.getByRole("link", { name: /باشقۇرۇش/ })).toBeVisible({ timeout: 20_000 });

  mkdirSync(dirname(STAFF_STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STAFF_STATE_PATH });
});
