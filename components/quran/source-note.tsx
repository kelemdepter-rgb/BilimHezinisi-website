/**
 * Attribution for the two texts the Qur'an module redistributes. Both
 * licences require it, so this is not decoration:
 *
 *  - Arabic (Uthmani, Hafs): Tanzil Project, CC BY 3.0 — a verbatim copy,
 *    and the source plus a link back must be shown.
 *  - Uyghur translation: QuranEnc.com — the publisher, the translator and
 *    the version number must all be stated.
 *
 * Wording ported from the desktop app (src/quran.js) so both editions credit
 * the sources identically.
 */
export function QuranSourceNote({ className = "" }: { className?: string }) {
  return (
    <aside
      data-testid="quran-source-note"
      aria-label="مەنبە ۋە ئىجازەتنامە"
      className={`mx-auto max-w-[760px] border-t border-bd pt-3 text-center text-[11.5px] leading-[1.9] text-ink3 ${className}`}
    >
      <p className="font-semibold text-ink2">مەنبە ۋە ئىجازەتنامە</p>
      <p className="mt-1">
        ئەرەبچە ئەسلى تېكىست:{" "}
        <a
          href="https://tanzil.net"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-am"
        >
          Tanzil Project
        </a>{" "}
        (CC BY 3.0) — تېكىست ھېچ ئۆزگەرتىلمىگەن
      </p>
      <p>
        ئۇيغۇرچە تەرجىمە: شەيخ مۇھەممەد سالىھ —{" "}
        <a
          href="https://quranenc.com/en/browse/uyghur_saleh"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-am"
        >
          QuranEnc.com
        </a>{" "}
        نەشرى، نەشر نومۇرى v1.0.2-xml.1
      </p>
    </aside>
  );
}
