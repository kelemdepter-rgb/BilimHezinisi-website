"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { askStream, type StreamHandle } from "@/lib/ai/client";

/**
 * A short Uyghur system instruction, so the plumbing test answers the way the
 * rest of this library will. The full per-content-type prompt set from the
 * desktop belongs with the features that use it — the reader panel and the
 * notebook — and porting six hundred lines of templates that nothing calls yet
 * would just be dead code sitting in the bundle.
 */
const SYSTEM =
  "سىز ئۇيغۇر تىلىدا جاۋاب بېرىدىغان ياردەمچىسىز. ساپ، چۈشىنىشلىك ئۇيغۇر يېزىقىدا جاۋاب بېرىڭ. " +
  "بىلمىسىڭىز «بۇ ھەقتە ئېنىق مەلۇمات تېپىلمىدى» دەڭ — ئويدۇرما مەنبە ئاتىماڭ.";

/**
 * The one end-to-end use of the transport in this phase: type a question, watch
 * the answer arrive, stop it if you want to. It exists to prove the plumbing —
 * the reader's AI panel and the notebook's are separate work.
 */
export function AiAskBox() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [partial, setPartial] = useState(false);
  const handle = useRef<StreamHandle | null>(null);

  // A question still running when this unmounts would keep a fetch and its
  // callbacks alive against a component that no longer exists.
  useEffect(
    () => () => {
      handle.current?.abort();
      handle.current = null;
    },
    [],
  );

  const ask = () => {
    const prompt = question.trim();
    if (!prompt || streaming) return;
    setAnswer("");
    setFailure(null);
    setSlot(null);
    setPartial(false);
    setStreaming(true);

    handle.current = askStream(
      { prompt, system: SYSTEM },
      (delta) => setAnswer((current) => current + delta),
      (fullText, _model, _usage, meta) => {
        setAnswer(fullText);
        setSlot(meta.slot);
        setPartial(!!meta.partial);
        setStreaming(false);
        handle.current = null;
      },
      (error) => {
        setFailure(error.error);
        setAnswer("");
        setStreaming(false);
        handle.current = null;
      },
      // A mid-stream failover restarts the answer on the next key. Whatever is
      // on screen belongs to the attempt that just died, so it goes.
      () => setAnswer(""),
    );
  };

  /** Stopping leaves nothing half-written behind — that is the whole point. */
  const cancel = () => {
    handle.current?.abort();
    handle.current = null;
    setStreaming(false);
    setAnswer("");
    setSlot(null);
  };

  return (
    <section className="paper grain mt-4 p-5 sm:p-6" aria-labelledby="ai-ask-heading">
      <h2 id="ai-ask-heading" className="flex items-center gap-2 text-[15px] font-bold">
        <Icon name="chat" className="text-am" />
        سىناق سوئالى
      </h2>
      <p className="mt-2 text-[13px] leading-7 text-ink2">
        ئاچقۇچىڭىزنىڭ ئىشلەۋاتقانلىقىنى بۇ يەردە سىناپ كۆرەلەيسىز. جاۋاب يېزىلىۋاتقاندا
        كۆرۈنىدۇ؛ خالىسىڭىز ئوتتۇرىدا توختىتىڭ.
      </p>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink2">سوئالىڭىز</span>
        <textarea
          autoComplete="off"
          className="field min-h-24 resize-y"
          rows={3}
          data-testid="ai-question"
          placeholder="مەسىلەن: ئىلىم ئۆگىنىشنىڭ ئەھمىيىتىنى قىسقىچە چۈشەندۈرۈپ بەر."
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-am"
          data-testid="ai-send"
          disabled={streaming || !question.trim()}
          onClick={ask}
        >
          <Icon name="sparkles" />
          سوراش
        </button>
        {streaming && (
          <button type="button" className="hbtn" data-testid="ai-cancel" onClick={cancel}>
            <Icon name="x" />
            توختىتىش
          </button>
        )}
        {streaming && (
          <span role="status" className="text-[13px] text-ink3" data-testid="ai-streaming">
            جاۋاب كېلىۋاتىدۇ…
          </span>
        )}
      </div>

      {failure && (
        <p
          role="alert"
          data-testid="ai-error"
          className="mt-3 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-7 text-ink"
        >
          {failure}
        </p>
      )}

      {answer && (
        <div className="mt-3">
          <div
            data-testid="ai-answer"
            className="whitespace-pre-wrap break-words rounded-[var(--radius)] bg-ab px-3.5 py-3 text-[14px] leading-8 text-ink"
          >
            {answer}
          </div>
          {/* Which key answered, said quietly: a reader whose primary key ran
              out should be able to see why things changed, not be notified. */}
          {slot !== null && !streaming && (
            <p className="mt-2 text-[11.5px] text-ink3" data-testid="ai-slot">
              جاۋاب <span dir="ltr">{slot + 1}</span>-ئورۇندىكى ئاچقۇچتىن كەلدى.
              {partial && " (باغلىنىش ئۈزۈلۈپ، جاۋاب چالا قالدى.)"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
