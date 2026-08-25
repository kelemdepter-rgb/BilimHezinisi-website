import { test as teardown } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  BATCH_PREFIX,
  READER_EMAIL,
  SEED_BOOK_HASH,
  SEED_MD_BOOK_HASH,
  SEED_REQUEST_PREFIX,
  STAFF_EMAIL,
  hasStaffTestEnv,
  loadEnvLocal,
} from "./env";

loadEnvLocal();

/** Remove the disposable accounts, book and requests so a run leaves nothing behind. */
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

  // The book requests the discovery spec sent. They go to the owner's real
  // inbox and count against the day's allowance, so they cannot be left there.
  await admin.from("book_requests").delete().like("title", `${SEED_REQUEST_PREFIX}%`);

  // Books the batch-import spec wrote. It removes its own, but a run cut
  // short partway through would otherwise leave real rows in the library.
  await admin.from("books").delete().like("title", `${BATCH_PREFIX}%`);

  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const user of data?.users ?? []) {
    // Notes cascade with the profile, which cascades with the auth user.
    if (user.email === STAFF_EMAIL || user.email === READER_EMAIL) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }
});
