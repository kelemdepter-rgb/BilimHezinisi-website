import { test as teardown } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  READER_EMAIL,
  SEED_BOOK_HASH,
  SEED_MD_BOOK_HASH,
  STAFF_EMAIL,
  hasStaffTestEnv,
  loadEnvLocal,
} from "./env";

loadEnvLocal();

/** Remove the disposable accounts and book so test runs leave nothing behind. */
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

  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const user of data?.users ?? []) {
    // Notes cascade with the profile, which cascades with the auth user.
    if (user.email === STAFF_EMAIL || user.email === READER_EMAIL) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }
});
