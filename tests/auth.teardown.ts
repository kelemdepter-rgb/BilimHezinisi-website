import { test as teardown } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BATCH_PREFIX, SEED_BOOK_HASH, SEED_MD_BOOK_HASH, hasStaffTestEnv, loadEnvLocal } from "./env";
import { sweepTestAccounts } from "./fixtures/accounts";

loadEnvLocal();

/**
 * Remove the disposable accounts and books so a run leaves nothing behind.
 *
 * The accounts go by prefix, the same sweep the setup opens with: the run's
 * two shared accounts, any throwaway a spec created and did not get to
 * remove, and whatever an earlier run left behind.
 */
teardown("remove the test accounts and seeded book", async () => {
  teardown.skip(!hasStaffTestEnv(), "Supabase env not configured");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Pages cascade with the book row.
  await admin.from("books").delete().eq("file_hash", SEED_BOOK_HASH);
  await admin.from("books").delete().eq("file_hash", SEED_MD_BOOK_HASH);

  // Books the batch-import spec wrote. It removes its own, but a run cut
  // short partway through would otherwise leave real rows in the library.
  await admin.from("books").delete().like("title", `${BATCH_PREFIX}%`);

  const removed = await sweepTestAccounts(admin);
  console.log(`removed ${removed} test account(s)`);
});
