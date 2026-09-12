import type { SupabaseClient, User } from "@supabase/supabase-js";
import { E2E_ACCOUNT_PREFIX } from "../env";

/**
 * Delete every account the suite ever created, and say how many there were.
 *
 * Keyed on the address prefix alone, so it reaches the accounts of this run,
 * of a run that was interrupted before its teardown, and of the older suite
 * that used fixed addresses on a public inbox — none of them may outlive the
 * next run. Every page of the listing is read before anything is deleted: the
 * project is small, but a sweep that read one page, deleted, and then asked
 * for the next would shift the pages under itself and skip accounts.
 *
 * Returns the count only. The addresses are nobody's business, and the
 * passwords are not known here at all.
 */
export async function sweepTestAccounts(admin: SupabaseClient): Promise<number> {
  const leftovers: User[] = [];
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`could not list the project's users: ${error.message}`);
    leftovers.push(...data.users.filter((user) => user.email?.startsWith(E2E_ACCOUNT_PREFIX)));
    if (!data.nextPage) break;
    page = data.nextPage;
  }

  for (const user of leftovers) {
    // Notes, bookmarks and progress cascade with the profile, which cascades
    // with the auth user.
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`could not remove a test account: ${error.message}`);
  }
  return leftovers.length;
}
