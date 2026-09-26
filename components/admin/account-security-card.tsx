"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { setRegistrationPausedAction, setUnconfirmedSweepAction } from "@/app/admin/security-actions";
import type { AccountSecurityReport } from "@/lib/auth/account-security";
import type { ActionResult } from "@/lib/admin/messages";

type Report = Extract<AccountSecurityReport, { available: true }>;

/** Which switch is waiting for its second tap. */
type Pending = "pause" | "sweep" | null;

/**
 * «ھېسابات بىخەتەرلىكى» on /admin, for the admin only (PROMPT-39, parts D–F):
 * the switch that pauses new registrations, the automatic brake's state, the
 * numbers that show an attack, and the daily sweep of accounts never
 * confirmed.
 *
 * Turning a switch ON takes two taps in the page — never a native confirm(),
 * which this site avoids — because both close a door on people: a pause turns
 * away every newcomer, and the sweep deletes accounts. Turning either OFF is
 * one tap. Every change is re-checked on the server (app/admin/security-actions.ts).
 */
export function AccountSecurityCard({ report }: { report: Report }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      setPending(null);
      if (outcome.ok) router.refresh();
    });
  }

  return (
    <section className="paper grain mt-5 p-5" aria-labelledby="account-security" data-testid="security-card">
      <h2 id="account-security" className="flex items-center gap-2 text-[15px] font-bold">
        <Icon name="shield" className="text-am" />
        ھېسابات بىخەتەرلىكى
      </h2>

      {/* ── The pause switch ───────────────────────────────────────── */}
      <div className="mt-4 space-y-3">
        <p className="text-[13.5px] leading-7 text-ink" data-testid="registration-state">
          {report.registrationPaused
            ? "يېڭى تىزىملىتىش ھازىر توختىتىلغان. كىرىش، پارولنى ئەسلىگە كەلتۈرۈش ۋە كىتاب ئوقۇش ئادەتتىكىدەك ئىشلەۋاتىدۇ."
            : "يېڭى تىزىملىتىش ئوچۇق."}
        </p>

        {report.registrationPaused ? (
          <button
            type="button"
            className="btn-am"
            disabled={busy}
            onClick={() => run(() => setRegistrationPausedAction(false))}
            data-testid="resume-registration"
          >
            تىزىملىتىشنى قايتا ئېچىش
          </button>
        ) : pending === "pause" ? (
          <div
            role="group"
            aria-label="تىزىملىتىشنى توختىتىشنى جەزملەش"
            className="rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3"
            data-testid="pause-confirm-box"
          >
            <p className="text-[13px] leading-6 text-ink">
              راستتىنلا توختىتامسىز؟ يېڭى ھېسابات ئېچىش توختايدۇ؛ كىرىش، پارولنى ئەسلىگە كەلتۈرۈش ۋە كىتاب
              ئوقۇش ئادەتتىكىدەك ئىشلەۋېرىدۇ.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-danger"
                disabled={busy}
                onClick={() => run(() => setRegistrationPausedAction(true))}
                data-testid="pause-confirm"
              >
                ھەئە، توختىتىش
              </button>
              <button type="button" className="hbtn" onClick={() => setPending(null)} data-testid="pause-cancel">
                ياق
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="hbtn"
            onClick={() => {
              setResult(null);
              setPending("pause");
            }}
            data-testid="pause-registration"
          >
            <Icon name="power" />
            يېڭى تىزىملىتىشنى ۋاقىتلىق توختىتىش
          </button>
        )}
      </div>

      {/* ── The brake and the numbers ──────────────────────────────── */}
      <div className="mt-5 border-t border-bd pt-4 text-[13px] leading-7 text-ink2">
        <p className="font-semibold text-ink" data-testid="brake-state">
          {report.brakeEngaged
            ? `ئاپتوماتىك تورمۇز: ھازىر ئىشلەۋاتىدۇ (ئاخىرقى 1 سائەتتە ${report.brakeCount} يېڭى ھېسابات)`
            : "ئاپتوماتىك تورمۇز: ئىشلىمىدى"}
        </p>
        <p className="text-ink3">
          بىر سائەتتە {report.brakeLimit} جەزملەنمىگەن يېڭى ھېساباتقا يەتسە، يېڭى تىزىملىتىش ئۆزلۈكىدىن
          توختايدۇ، سان چۈشكەندە ئۆزلۈكىدىن ئېچىلىدۇ.
        </p>
        <ul className="mt-2 space-y-0.5">
          <li data-testid="new-accounts">
            يېڭى ھېسابات: ئاخىرقى 1 سائەتتە {report.newLastHour}، ئاخىرقى 24 سائەتتە {report.newLastDay}
          </li>
          <li data-testid="active-locks">ھازىر قۇلۇپلانغان كىرىش/تىزىملىتىش: {report.activeLocks}</li>
        </ul>
      </div>

      {/* ── Accounts never confirmed ───────────────────────────────── */}
      <div className="mt-5 space-y-3 border-t border-bd pt-4">
        <p className="text-[13px] leading-7 text-ink" data-testid="unconfirmed-line">
          جەزملەنمىگەن ھېساباتلار: {report.unconfirmed} —{" "}
          {report.lastSweep
            ? `ئاخىرقى تازىلاش: ${report.lastSweep.deleted} تال ئۆچۈرۈلدى (${report.lastSweep.at.slice(0, 10)})`
            : "ئاخىرقى تازىلاش: تېخى بولمىدى"}
        </p>
        <p className="text-[13px] leading-7 text-ink2" data-testid="sweep-state">
          {report.sweepEnabled
            ? `7 كۈندىن ئارتۇق جەزملەنمىگەن ھېساباتلار ھەر كۈنى ئۆچۈرۈلىدۇ. ھازىر ${report.sweepable} تال بار.`
            : `7 كۈندىن ئارتۇق جەزملەنمىگەن ھېساباتلارنى ئاپتوماتىك ئۆچۈرۈش ئېتىك. ھازىر ${report.sweepable} تال بار.`}
        </p>

        {report.sweepEnabled ? (
          <button
            type="button"
            className="hbtn"
            disabled={busy}
            onClick={() => run(() => setUnconfirmedSweepAction(false))}
            data-testid="sweep-stop"
          >
            ئاپتوماتىك ئۆچۈرۈشنى توختىتىش
          </button>
        ) : pending === "sweep" ? (
          <div
            role="group"
            aria-label="ئاپتوماتىك ئۆچۈرۈشنى جەزملەش"
            className="rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3"
            data-testid="sweep-confirm-box"
          >
            <p className="text-[13px] leading-6 text-ink">
              7 كۈندىن ئارتۇق جەزملەنمىگەن ھېساباتلار ھەر كۈنى ئەتىگەن ئۆچۈرۈلىدۇ (ھازىر {report.sweepable} تال).
              ئۇلار خالىسا قايتا تىزىمدىن ئۆتەلەيدۇ. ماقۇلمۇ؟
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-danger"
                disabled={busy}
                onClick={() => run(() => setUnconfirmedSweepAction(true))}
                data-testid="sweep-confirm"
              >
                ھەئە، ئېچىش
              </button>
              <button type="button" className="hbtn" onClick={() => setPending(null)} data-testid="sweep-cancel">
                ياق
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="hbtn"
            onClick={() => {
              setResult(null);
              setPending("sweep");
            }}
            data-testid="sweep-start"
          >
            <Icon name="trash" />
            ئاپتوماتىك ئۆچۈرۈشنى ئېچىش
          </button>
        )}
      </div>

      {result && (
        <p
          role="status"
          className="mt-4 rounded-[var(--radius)] bg-ab px-3.5 py-2.5 text-[13px] leading-6 text-ink"
          data-testid="security-result"
        >
          {result.ok ? (result.message ?? "") : result.error}
        </p>
      )}

      {!report.listsInSync && (
        <p className="mt-4 rounded-[var(--radius)] border border-am bg-ab2 px-3.5 py-2.5 text-[13px] leading-6 text-ink" data-testid="lists-out-of-sync">
          دىققەت: ساندانغا كۆچۈرۈلگەن دومېن تىزىملىكلىرى سايتنىڭكى بىلەن ئوخشاش ئەمەس.
          scripts/sync-auth-domains.mjs نى قايتا ئىجرا قىلىش كېرەك.
        </p>
      )}

      <p className="mt-4 text-[12.5px] leading-6 text-ink3">
        ئاخىرقى چارە: Supabase → Authentication → Sign In / Providers → «Allow new users to sign up» نى
        ئېتىۋەتسىڭىز، ھېچكىم يېڭى ھېسابات ئاچالمايدۇ.
      </p>
    </section>
  );
}
