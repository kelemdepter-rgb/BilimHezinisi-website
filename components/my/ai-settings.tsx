"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { AiAskBox } from "@/components/my/ai-ask-box";
import { AiKeySlots } from "@/components/my/ai-keys";
import {
  MODEL_INFO,
  SELECTABLE_MODELS,
  URL_PRICING,
  isSelectableModel,
  modelOptionLabel,
} from "@/lib/ai/models";
import { clearAiState, writeEnabled, writeModel } from "@/lib/ai/storage";
import { useAiState } from "@/lib/ai/use-ai-state";

/**
 * The AI settings screen.
 *
 * The switch gates everything: until a reader turns it on there is no key
 * field, no model picker and no way to send anything anywhere. A reader who
 * never touches the switch is never asked again.
 */
export function AiSettings() {
  const { enabled, model, usage, hasKey } = useAiState();
  const [erased, setErased] = useState(false);

  const toggle = (on: boolean) => {
    writeEnabled(on);
    setErased(false);
  };

  const changeModel = (next: string) => {
    if (isSelectableModel(next)) writeModel(next);
  };

  const eraseEverything = () => {
    clearAiState();
    setErased(true);
  };

  return (
    <>
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="sparkles" className="ic-lg text-am" />
        سۈنئىي ئىدراك ياردەمچىسى
      </h1>
      <p className="mt-2 text-[13px] leading-7 text-ink2">
        بۇ ئىقتىدار <b>ئىختىيارىي</b>. ئۇنى ئىشلىتىش ئۈچۈن ئۆزىڭىزنىڭ ھەقسىز Google Gemini
        ئاچقۇچى كېرەك. ئاچقۇچىڭىز پەقەت مۇشۇ توركۆرگۈڭىزدە ساقلىنىدۇ ۋە سوئالىڭىز
        توركۆرگۈڭىزدىن بىۋاسىتە Google غا بارىدۇ — بۇ كۇتۇپخانىنىڭ مۇلازىمېتىرىغا
        كەلمەيدۇ.
      </p>

      {/* ── The explicit action ──────────────────────────────────────────── */}
      <section className="paper grain mt-4 p-5 sm:p-6" aria-labelledby="ai-switch">
        <h2 id="ai-switch" className="flex items-center gap-2 text-[15px] font-bold">
          <Icon name="power" className="text-am" />
          سۈنئىي ئىدراكنى ئىشلىتىش
        </h2>
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className="size-5 shrink-0 accent-[var(--am)]"
            data-testid="ai-enable"
            checked={enabled}
            onChange={(event) => toggle(event.target.checked)}
          />
          <span className="text-[14px] font-semibold">
            {enabled ? "ئوچۇق" : "ئېتىك"} — يۇقىرىدىكىنى ئوقۇدۇم، ئاچىمەن
          </span>
        </label>
        {!enabled && (
          <p className="mt-2 text-[12.5px] leading-6 text-ink3" data-testid="ai-off-note">
            ئېتىك تۇرغاندا ھېچقانداق ئۇچۇر Google غا ئەۋەتىلمەيدۇ.
          </p>
        )}
      </section>

      {enabled && (
        <>
          <AiKeySlots model={model} />

          {/* ── Model ─────────────────────────────────────────────────────── */}
          <section className="paper grain mt-4 p-5 sm:p-6" aria-labelledby="ai-model-heading">
            <h2 id="ai-model-heading" className="flex items-center gap-2 text-[15px] font-bold">
              <Icon name="layers" className="text-am" />
              مودېل
            </h2>
            <p className="mt-2 text-[13px] leading-7 text-ink2">
              تاللىغان مودېلىڭىز <b>ھەمىشە شۇ پېتى</b> ئىشلىتىلىدۇ. ئاچقۇچ ئىشلىمەي قالسا
              زاپاس ئاچقۇچقا ئالمىشىدۇ، ئەمما <b>مودېل ھەرگىز ئۆزگەرتىلمەيدۇ</b>.
            </p>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-[13px] font-semibold text-ink2">
                ئىشلىتىدىغان مودېل
              </span>
              <select
                className="field cursor-pointer"
                dir="ltr"
                data-testid="ai-model"
                value={model}
                onChange={(event) => changeModel(event.target.value)}
              >
                {SELECTABLE_MODELS.map((id) => (
                  <option key={id} value={id}>
                    {modelOptionLabel(id)}
                  </option>
                ))}
              </select>
            </label>
            <ul className="mt-3 space-y-1.5" data-testid="ai-model-info">
              {SELECTABLE_MODELS.map((id) => (
                <li key={id} className="text-[12px] leading-6 text-ink3">
                  <b dir="ltr" className="font-mono text-[11px] text-ink2">
                    {id}
                  </b>{" "}
                  — {MODEL_INFO[id]}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] leading-6 text-ink3">
              «ھەقسىز» مودېللار Google نىڭ ھەقسىز ھەققى بىلەن ئىشلەيدۇ. «پۇللۇق» مودېل ئۈچۈن
              Google ھېساباتىڭىزدا billing ئوچۇق بولۇشى شەرت. باھالار ئۆزگىرىپ تۇرىدۇ —{" "}
              <a
                href={URL_PRICING}
                target="_blank"
                rel="noopener noreferrer"
                className="text-am underline underline-offset-4"
                data-testid="ai-pricing-link"
              >
                Google نىڭ باھا بېتى
              </a>
              .
            </p>
          </section>

          {/* ── Usage ─────────────────────────────────────────────────────── */}
          <section className="paper grain mt-4 p-5 sm:p-6" aria-labelledby="ai-usage-heading">
            <h2 id="ai-usage-heading" className="flex items-center gap-2 text-[15px] font-bold">
              <Icon name="chart" className="text-am" />
              بۈگۈنكى ئىشلىتىش
            </h2>
            <dl className="mt-3 grid grid-cols-3 gap-2.5 text-center" data-testid="ai-usage">
              <div className="rounded-[var(--radius)] bg-ab px-2 py-3">
                <dt className="text-[11.5px] text-ink3">سوئال</dt>
                <dd dir="ltr" className="mt-1 text-[17px] font-bold" data-testid="ai-usage-requests">
                  {usage.requests}
                </dd>
              </div>
              <div className="rounded-[var(--radius)] bg-ab px-2 py-3">
                <dt className="text-[11.5px] text-ink3">كىرگەن token</dt>
                <dd dir="ltr" className="mt-1 text-[17px] font-bold">
                  {usage.tokensIn}
                </dd>
              </div>
              <div className="rounded-[var(--radius)] bg-ab px-2 py-3">
                <dt className="text-[11.5px] text-ink3">چىققان token</dt>
                <dd dir="ltr" className="mt-1 text-[17px] font-bold">
                  {usage.tokensOut}
                </dd>
              </div>
            </dl>
          </section>

          <AiAskBox />
        </>
      )}

      {/* ── Erase ────────────────────────────────────────────────────────── */}
      <section
        className="mt-4 rounded-[var(--radius-lg)] border border-bd2 p-5 sm:p-6"
        aria-labelledby="ai-erase-heading"
      >
        <h2 id="ai-erase-heading" className="flex items-center gap-2 text-[15px] font-bold">
          <Icon name="trash" className="text-danger" />
          ھەممىنى ئۆچۈرۈش
        </h2>
        <p className="mt-2 text-[13px] leading-7 text-ink2">
          تۆتىلا ئاچقۇچ، تاللىغان مودېل، ئىشلىتىش سانلىرى ۋە ئېچىش/ئېتىش ھالىتى — ھەممىسى
          مۇشۇ توركۆرگۈدىن تولۇق ئۆچۈرۈلىدۇ. ئورتاق ئىشلىتىلىدىغان ياكى ئۆزىڭىزنىڭ
          بولمىغان كومپيۇتېردا ئىشلىگەن بولسىڭىز، چىقىشتىن بۇرۇن مۇشۇنى بېسىڭ.
        </p>
        {erased && (
          <p role="status" className="mt-3 text-[13px] text-ink2" data-testid="ai-erased">
            ئاچقۇچلىرىڭىز ۋە بارلىق سۈنئىي ئىدراك ئۇچۇرلىرى بۇ توركۆرگۈدىن ئۆچۈرۈلدى.
          </p>
        )}
        <button
          type="button"
          className="btn-danger mt-4"
          data-testid="ai-erase"
          disabled={!hasKey && !enabled && usage.requests === 0}
          onClick={eraseEverything}
        >
          <Icon name="trash" />
          ئاچقۇچلىرىمنى ۋە ھەممە ئۇچۇرنى ئۆچۈرۈش
        </button>
      </section>
    </>
  );
}
