"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/guards";
import { MSG, failureMessage, type ActionResult } from "@/lib/admin/messages";
import {
  REGISTRATION_PAUSED_KEY,
  SWEEP_ENABLED_KEY,
  writeSwitch,
} from "@/lib/auth/account-security";

/**
 * The /admin security card's two switches (PROMPT-39, parts D and E).
 *
 * Admin only — never an uploader — and re-verified from the database on every
 * call (lib/admin/guards.ts), whatever the page showed. The write itself goes
 * through the service role only after that check.
 */

async function flip(key: typeof REGISTRATION_PAUSED_KEY | typeof SWEEP_ENABLED_KEY, on: unknown): Promise<ActionResult> {
  try {
    await requireAdmin();
    await writeSwitch(key, on === true);
    revalidatePath("/admin");
    return { ok: true, message: MSG.saved };
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/** Pause, or reopen, new registrations — the form, the resend button and the hook alike. */
export async function setRegistrationPausedAction(paused: boolean): Promise<ActionResult> {
  return flip(REGISTRATION_PAUSED_KEY, paused);
}

/** Let the daily cron delete accounts never confirmed after 7 days — or stop it. */
export async function setUnconfirmedSweepAction(enabled: boolean): Promise<ActionResult> {
  return flip(SWEEP_ENABLED_KEY, enabled);
}
