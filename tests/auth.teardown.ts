import { test as teardown } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { STAFF_EMAIL, hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

/** Remove the disposable account so test runs leave nothing behind. */
teardown("remove the staff test account", async () => {
  teardown.skip(!hasStaffTestEnv(), "Supabase env not configured");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const user of data?.users ?? []) {
    if (user.email === STAFF_EMAIL) await admin.auth.admin.deleteUser(user.id);
  }
});
