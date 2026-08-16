"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { SpellChecker, type SpellStatus } from "@/lib/spellcheck/client";
import { tokenize } from "@/lib/spellcheck/dictionary";

const PERSONAL_KEY = "bh-personal-dictionary";

/**
 * The personal dictionary lives in this browser, not in Postgres.
 *
 * It is a list of words one person considers correct — a few dozen at most,
 * worth a few hundred bytes. A table for it would add a migration, a row per
 * word, an RLS policy and a round trip on every note open, to store less than
 * a single page of a book. If it is ever needed across devices it can move
 * into the profile row; until then this costs the free tier nothing.
 */
function readPersonal(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PERSONAL_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writePersonal(words: string[]) {
  try {
    window.localStorage.setItem(PERSONAL_KEY, JSON.stringify(words));
  } catch {
    // Private mode: the additions last for this session only.
  }
}

const STATUS_LABEL: Record<SpellStatus, string> = {
  off: "",
  loading: "لۇغەت يۈكلىنىۋاتىدۇ…",
  ready: "",
  failed: "لۇغەتنى يۈكلىگىلى بولمىدى — خاتىرە يېزىش داۋاملىشىدۇ.",
};

export function SpellPanel({
  getText,
  onClose,
}: {
  getText: () => string;
  onClose: () => void;
}) {
  const checker = useRef<SpellChecker | null>(null);
  const [status, setStatus] = useState<SpellStatus>("off");
  const [wrong, setWrong] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [openWord, setOpenWord] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // Read at first render, not in an effect: it is a plain synchronous read of
  // this browser's own storage, and the value is never rendered, so there is
  // nothing for hydration to disagree about.
  const [personal, setPersonal] = useState<string[]>(readPersonal);

  useEffect(() => {
    const instance = new SpellChecker(setStatus);
    checker.current = instance;
    instance.start();
    instance.setPersonal(readPersonal());
    return () => {
      instance.stop();
      checker.current = null;
    };
  }, []);

  const run = useCallback(async () => {
    const instance = checker.current;
    if (!instance || instance.status !== "ready") return;
    setChecking(true);
    // One pass over the text, unique words only — checking the same word
    // fifty times costs fifty binary searches for one answer.
    const words = [...new Set(tokenize(getText()).map((token) => token.word))];
    setWrong(await instance.check(words));
    setChecking(false);
  }, [getText]);

  // Check as soon as the dictionary is in, then leave it to the button: a
  // re-scan on every keystroke would fight the caret for no gain.
  useEffect(() => {
    if (status === "ready") void run();
  }, [run, status]);

  async function openSuggestions(word: string) {
    if (openWord === word) {
      setOpenWord(null);
      return;
    }
    setOpenWord(word);
    setSuggestions([]);
    const list = await checker.current?.suggest(word);
    setSuggestions(list ?? []);
  }

  function accept(word: string) {
    const next = [...new Set([...personal, word])];
    setPersonal(next);
    writePersonal(next);
    checker.current?.setPersonal(next);
    setWrong((current) => current.filter((item) => item !== word));
    setOpenWord(null);
  }

  return (
    <aside
      data-testid="spell-panel"
      className="safe-bottom safe-x sticky bottom-0 z-20 max-h-[45dvh] overflow-y-auto overscroll-contain border-t border-bd bg-bg2/95 backdrop-blur print:hidden"
    >
      <div className="mx-auto w-full max-w-4xl px-3 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <h2 className="flex items-center gap-2 text-[14px] font-bold">
            <Icon name="check" className="text-am" />
            ئىملا تەكشۈرۈش
          </h2>
          <button
            type="button"
            className="hbtn"
            data-testid="spell-recheck"
            disabled={status !== "ready" || checking}
            onClick={() => void run()}
          >
            {checking ? "تەكشۈرۈۋاتىدۇ…" : "قايتا تەكشۈر"}
          </button>
          <button type="button" className="ibtn ms-auto" aria-label="تاقاش" onClick={onClose}>
            <Icon name="x" className="ic-lg" />
          </button>
        </div>

        {STATUS_LABEL[status] && (
          <p className="mt-2 text-[12.5px] text-ink3" data-testid="spell-status">
            {STATUS_LABEL[status]}
          </p>
        )}

        {status === "ready" && wrong.length === 0 && !checking && (
          <p className="mt-2 text-[13px] text-ink2" data-testid="spell-clean">
            خاتالىق تېپىلمىدى.
          </p>
        )}

        {wrong.length > 0 && (
          <>
            <p className="mt-2 text-[12.5px] text-ink3" data-testid="spell-count">
              {wrong.length} سۆز لۇغەتتە يوق — بىرىنى چېكىپ تەكلىپلەرنى كۆرۈڭ.
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="spell-words">
              {wrong.map((word) => (
                <li key={word}>
                  <button
                    type="button"
                    className={openWord === word ? "hbtn on" : "hbtn"}
                    data-testid="spell-word"
                    aria-expanded={openWord === word}
                    onClick={() => void openSuggestions(word)}
                  >
                    <span className="underline decoration-wavy decoration-2 underline-offset-4">
                      {word}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {openWord && (
          <div
            className="mt-3 rounded-[var(--radius)] border border-bd bg-bg p-3"
            data-testid="spell-suggestions"
          >
            <p className="text-[12.5px] text-ink3">
              «{openWord}» ئۈچۈن تەكلىپلەر
            </p>
            {suggestions.length === 0 ? (
              <p className="mt-2 text-[13px] text-ink2">تەكلىپ تېپىلمىدى.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {suggestions.map((suggestion) => (
                  <li key={suggestion}>
                    {/* Suggestions are shown, not auto-applied: the text lives
                        in a contentEditable and replacing a word behind the
                        writer's back would move their caret. */}
                    <span
                      className="hbtn cursor-default"
                      data-testid="spell-suggestion"
                    >
                      {suggestion}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="hbtn mt-2"
              data-testid="spell-accept"
              onClick={() => accept(openWord)}
            >
              <Icon name="plus" />
              بۇ سۆز توغرا — لۇغىتىمگە قوش
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
