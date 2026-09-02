"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { probeKey, type KeyProbe } from "@/lib/ai/client";
import { URL_GET_KEY, type ModelId } from "@/lib/ai/models";
import { KEY_SLOT_COUNT, readKeys, writeKeys } from "@/lib/ai/storage";
import { useAiState } from "@/lib/ai/use-ai-state";

/** Slot 0 is the key that is tried first; 1–3 are the backups behind it. */
const SLOT_LABELS = [
  "ئاساسىي ئاچقۇچ (ئورۇن 1)",
  "زاپاس ئاچقۇچ 2",
  "زاپاس ئاچقۇچ 3",
  "زاپاس ئاچقۇچ 4",
] as const;

function emptySlots<T>(value: T): T[] {
  return new Array<T>(KEY_SLOT_COUNT).fill(value);
}

/**
 * The four key slots.
 *
 * A saved key is never rendered back in full — the field empties and its
 * label carries the masked form, which is enough to recognise which key is
 * which without putting the secret back on screen. Each slot tests on its own,
 * because "which of my keys actually work" is the question a reader with four
 * of them is really asking.
 */
export function AiKeySlots({ model }: { model: ModelId }) {
  const { masks, lastGoodSlot } = useAiState();
  const [drafts, setDrafts] = useState<string[]>(() => emptySlots(""));
  const [probes, setProbes] = useState<(KeyProbe | null)[]>(() => emptySlots<KeyProbe | null>(null));
  const [testing, setTesting] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  /**
   * Every verdict below was measured against the model selected at the time,
   * and the same key can pass on one model and fail on another. Changing the
   * model therefore clears them during the render that notices, rather than
   * leaving a stale tick on screen.
   */
  const [probedModel, setProbedModel] = useState(model);
  if (probedModel !== model) {
    setProbedModel(model);
    setProbes(emptySlots<KeyProbe | null>(null));
  }

  /** Write one slot without disturbing the three the reader cannot see. */
  const saveSlot = (slot: number, value: string) => {
    const next = emptySlots<string | null>(null);
    next[slot] = value;
    writeKeys(next);
  };

  const save = () => {
    // null means "leave this slot alone" — a field the reader did not retype
    // must not wipe the key they cannot see.
    writeKeys(drafts.map((draft) => (draft.trim() ? draft.trim() : null)));
    setDrafts(emptySlots(""));
    setProbes(emptySlots<KeyProbe | null>(null));
    setSaved(true);
  };

  const clearSlot = (slot: number) => {
    saveSlot(slot, "");
    setDrafts((current) => current.map((value, index) => (index === slot ? "" : value)));
    setProbes((current) => current.map((value, index) => (index === slot ? null : value)));
    setSaved(false);
  };

  /**
   * Testing a slot always tests what is SAVED, so a tick means "this is what
   * will be used". Anything typed into the field is therefore saved first —
   * otherwise a reader could be told a key works and then find that a
   * different one was stored.
   */
  const test = async (slot: number) => {
    setTesting(slot);
    try {
      const typed = drafts[slot].trim();
      if (typed) {
        saveSlot(slot, typed);
        setDrafts((current) => current.map((value, index) => (index === slot ? "" : value)));
      }
      const result = await probeKey(slot, readKeys()[slot] ?? "");
      setProbes((current) => current.map((value, index) => (index === slot ? result : value)));
    } finally {
      setTesting(null);
    }
  };

  return (
    <section className="paper grain mt-4 p-5 sm:p-6" aria-labelledby="ai-keys-heading">
      <h2 id="ai-keys-heading" className="flex items-center gap-2 text-[15px] font-bold">
        <Icon name="key" className="text-am" />
        Gemini API ئاچقۇچلىرىم
      </h2>

      <p className="mt-2 text-[13px] leading-7 text-ink2">
        ھەقسىز ئاچقۇچنى{" "}
        <a
          href={URL_GET_KEY}
          target="_blank"
          rel="noopener noreferrer"
          className="text-am underline underline-offset-4"
          data-testid="ai-getkey-link"
        >
          aistudio.google.com
        </a>{" "}
        دىكى <b>«Get API key»</b> بۆلىكىدىن ھاسىل قىلىپ، بۇ يەرگە چاپلاڭ. كونا ئاچقۇچلار{" "}
        <b dir="ltr">AIza</b> بىلەن، يېڭىلىرى <b dir="ltr">AQ.</b> بىلەن باشلىنىدۇ —
        ئىككىلىسى بولىدۇ.
      </p>

      <p className="mt-2.5 text-[13px] leading-7 text-ink2">
        ئاساسىي ئاچقۇچ ئالدىراش، ھەققى توشقان ياكى ئىناۋەتسىز بولۇپ قالسا زاپاس ئاچقۇچقا{" "}
        <b>ئۆزلۈكىدىن</b> ئالمىشىدۇ — سىز ھېچنېمە قىلمايسىز ۋە جاۋابىڭىز ئۈزۈلۈپ قالمايدۇ.
        ھەر بىر زاپاس ئاچقۇچنى ھاسىل قىلغاندا چوقۇم <b>باشقا بىر Google Cloud «project»</b>{" "}
        تاللاڭ: ھەقسىز ھەق ھەر بىر project غا ئايرىم ھېسابلىنىدۇ، شۇنداق بولمىسا بىر
        project دىكى تۆت ئاچقۇچ بىر ئاچقۇچ بىلەن ئوخشاش بولۇپ قالىدۇ.
      </p>

      <div className="mt-4 space-y-4">
        {SLOT_LABELS.map((label, slot) => {
          const probe = probes[slot];
          return (
            <div key={label}>
              <label className="block">
                <span className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] font-semibold text-ink2">
                  {label}
                  {masks[slot] && (
                    <span dir="ltr" className="chip-hint" data-testid={`ai-key-mask-${slot}`}>
                      {masks[slot]}
                    </span>
                  )}
                  {lastGoodSlot === slot && (
                    <span className="text-[11.5px] font-normal text-ink3" data-testid="ai-last-good">
                      ئەڭ ئاخىرىدا ئىشلىگىنى
                    </span>
                  )}
                </span>
                <input
                  className="field"
                  type="password"
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  data-testid={`ai-key-${slot}`}
                  placeholder={masks[slot] ? "ئۆزگەرتىش ئۈچۈن يېڭىسىنى چاپلاڭ" : "AIza... / AQ..."}
                  value={drafts[slot]}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDrafts((current) =>
                      current.map((item, index) => (index === slot ? value : item)),
                    );
                    setSaved(false);
                  }}
                />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="hbtn"
                  data-testid={`ai-test-${slot}`}
                  disabled={testing !== null || (!drafts[slot].trim() && !masks[slot])}
                  onClick={() => void test(slot)}
                >
                  <Icon name="refresh" />
                  {testing === slot ? "سىنالماقتا…" : "باغلىنىشنى سىناش"}
                </button>
                {masks[slot] && (
                  <button
                    type="button"
                    className="hbtn"
                    data-testid={`ai-clear-${slot}`}
                    disabled={testing !== null}
                    onClick={() => clearSlot(slot)}
                  >
                    <Icon name="x" />
                    بۇ ئاچقۇچنى ئۆچۈرۈش
                  </button>
                )}
              </div>
              {probe && (
                <p
                  role="status"
                  data-testid={`ai-result-${slot}`}
                  data-status={probe.status}
                  className={`mt-2 text-[12.5px] leading-6 ${probe.keyOk ? "text-ink2" : "text-danger"}`}
                >
                  {probe.message}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-am"
          data-testid="ai-save"
          disabled={!drafts.some((draft) => draft.trim())}
          onClick={save}
        >
          <Icon name="save" />
          ساقلاش
        </button>
        {saved && (
          <span role="status" className="text-[13px] text-ink2" data-testid="ai-saved">
            ساقلاندى.
          </span>
        )}
      </div>
    </section>
  );
}
