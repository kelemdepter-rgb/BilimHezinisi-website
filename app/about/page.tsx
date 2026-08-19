import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";

export const metadata: Metadata = {
  title: "بىلىم خەزىنىسى ھەققىدە",
  description:
    "«بىلىم خەزىنىسى» نېمە، كىم تارقاتقان، قايسى مەنبەلەرنى ئىشلەتكەن ۋە ئۇلارنىڭ ئىجازەتنامىلىرى.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "بىلىم خەزىنىسى ھەققىدە",
    description: "بۇ كۇتۇپخانا ھەققىدە، مەنبەلەر ۋە ئىجازەتنامىلەر.",
    url: "/about",
  },
};

const REPO = "https://github.com/kelemdepter-rgb/BilimHezinisi-website";
const DESKTOP_REPO = "https://github.com/kelemdepter-rgb/BilimHezinisi-desktop";
const CONTACT = "kelemdepter@gmail.com";

/** Every third-party source the site serves, with the licence it is used under. */
const SOURCES: { what: string; who: string; licence: string; href?: string }[] = [
  {
    what: "قۇرئان ئەرەبچە تېكىستى (ئوسمانىي، ھەفس)",
    who: "Tanzil Project",
    licence: "CC BY 3.0 — تېكىست ھېچ ئۆزگەرتىلمىگەن",
    href: "https://tanzil.net",
  },
  {
    what: "قۇرئان ئۇيغۇرچە تەرجىمىسى",
    who: "شەيخ مۇھەممەد سالىھ — QuranEnc.com، v1.0.2-xml.1",
    licence: "QuranEnc نەشر شەرتلىرى بويىچە",
    href: "https://quranenc.com/en/browse/uyghur_saleh",
  },
  {
    what: "UKIJ خەت نۇسخىلىرى (Ekran، Tuz، Tuz Tom، Tuz Kitab)",
    who: "Uyghur Computer Science Association (ukij.org)",
    licence: "LGPL",
    href: "http://www.ukij.org",
  },
  {
    what: "Uthmanic Hafs خەت نۇسخىسى (قۇرئان ئۈچۈن)",
    who: "King Fahd Glorious Quran Printing Complex (KFGQPC)",
    licence: "ھەقسىز تارقىتىشقا بولىدۇ، ئۆزگەرتىشكە بولمايدۇ — ئەينەن ساقلانغان",
    href: "http://fonts.qurancomplex.gov.sa/",
  },
  {
    what: "ئىملا لۇغىتى",
    who: "UyghurSpell (gheyret/UyghurSpell)",
    licence: "MIT",
    href: "https://github.com/gheyret/UyghurSpell",
  },
  {
    what: "SymSpell ئىملا ئالگورىزىمى",
    who: "Wolf Garbe",
    licence: "MIT",
    href: "https://github.com/wolfgarbe/SymSpell",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-9">
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="info" className="ic-lg text-am" />
        بىلىم خەزىنىسى ھەققىدە
      </h1>

      <div className="paper grain legal mt-5 p-5 sm:p-7">
        <h2>
          <Icon name="book-open" className="text-am" />
          بۇ نېمە؟
        </h2>
        <p>
          «بىلىم خەزىنىسى» — ئۇيغۇرچە ئېلكىتابلارنى توپلىغان، ھەممەيلەنگە ئوچۇق رەقەملىك
          كۇتۇپخانا. كىتاب ئوقۇش، ئىزدەش ۋە قۇرئان كەرىمنى مۇتالىئە قىلىش ئۈچۈن
          <strong> ھېسابات ئېچىش تەلەپ قىلىنمايدۇ</strong>. ھېسابات ئاچسىڭىز، خەتكۈچ،
          خاتىرە، ئوقۇش ئىزى ۋە خاتىرە دەپتەر قوشۇمچە ئىشلىتىلىدۇ — ئۇلارمۇ ھەقسىز.
        </p>
        <p>
          كۇتۇپخانىدا <strong>ئېلان يوق، ئىزلاش (tracking) يوق، ستاتىستىكا يوق</strong>.
          ھېچقانداق ئۈچىنچى تەرەپنىڭ كودى بۇ بەتلەردە ئىجرا بولمايدۇ. تەپسىلاتىنى{" "}
          <Link href="/privacy">مەخپىيەتلىك سىياسىتى</Link> بەتتىن ئوقۇيالايسىز.
        </p>

        <h2>
          <Icon name="users" className="text-am" />
          تارقاتقۇچى
        </h2>
        <p>
          تارقاتقۇچى ئورۇن: <strong>ئىخلاس نەشرىياتى</strong>. ياسىغۇچى:{" "}
          <strong>ئابدۇسەمەد</strong>.
        </p>
        <p>
          كومپيۇتېر ئۈچۈن تورسىز ئىشلەيدىغان Windows نۇسخىسىمۇ بار:{" "}
          <a href={DESKTOP_REPO} target="_blank" rel="noreferrer">
            بىلىم خەزىنىسى (Windows)
          </a>
          . ئۇنىڭدا سىكانېرلانغان PDF لارنى خەتكە ئايلاندۇرۇش (OCR) قاتارلىق تور نۇسخىسىدا
          يوق ئىقتىدارلار بار.
        </p>

        <h2>
          <Icon name="scale" className="text-am" />
          مەنبەلەر ۋە ئىجازەتنامىلەر
        </h2>
        <p>
          بۇ سايت تۆۋەندىكى ئەسەرلەرنى ئۇلارنىڭ ئۆز ئىجازەتنامىسى بويىچە ئىشلىتىدۇ:
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>مەنبە</th>
                <th>ئىگىسى</th>
                <th>ئىجازەتنامە</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((source) => (
                <tr key={source.what}>
                  <td>{source.what}</td>
                  <td>
                    {source.href ? (
                      <a href={source.href} target="_blank" rel="noreferrer">
                        {source.who}
                      </a>
                    ) : (
                      source.who
                    )}
                  </td>
                  <td>{source.licence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>خەت نۇسخىسى ھەققىدە بىر ئىزاھات</h3>
        <p>
          «Traditional Arabic» ۋە «Bahij Nazanin» خەت نۇسخىلىرى بۇ سايتتىن{" "}
          <strong>ھەرگىز يۈكلەنمەيدۇ</strong>، چۈنكى ئۇلارنىڭ ئىجازەتنامىسى باشقىلارغا
          تارقىتىشقا رۇخسەت قىلمايدۇ. «Traditional Arabic» ئوقۇغۇچتا تاللىنىدۇ، لېكىن ئۇ
          سىزنىڭ ئۆز كومپيۇتېرىڭىزدىكى (Windows بىلەن كەلگەن) نۇسخىدىن ئوقۇلىدۇ. ئۇ
          يوق بولسا، سايت ئۆزى تارقىتىشقا ھوقۇقلۇق بولغان UKIJ Ekran غا قايتىدۇ.
        </p>

        <h3>پروگرامما كودى</h3>
        <p>
          بۇ سايتنىڭ ئۆز كودى <strong>MIT</strong> ئىجازەتنامىسى ئاستىدا. ئىشلىتىلگەن
          npm بۆلەكلىرىنىڭ ئىجازەتنامىلىرى ئاساسەن MIT، Apache-2.0، BSD-2-Clause ۋە
          MPL-2.0 ئائىلىسىدىن. تولۇق تىزىملىك:{" "}
          <a href={`${REPO}/blob/main/THIRD-PARTY-NOTICES.md`} target="_blank" rel="noreferrer">
            THIRD-PARTY-NOTICES.md
          </a>{" "}
          ·{" "}
          <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
            LICENSE
          </a>
          .
        </p>

        <h2>
          <Icon name="book-marked" className="text-am" />
          كىتابلار ھەققىدە
        </h2>
        <p>
          كۇتۇپخانىدىكى كىتابلار ئۆز ئاپتورلىرى ۋە نەشرىياتلىرىغا تەۋە. ئۇلار بۇ يەردە
          ھەقسىز، ئېلانسىز ھالدا ئوقۇشقا سۇنۇلىدۇ.
        </p>

        <h2>
          <Icon name="mail" className="text-am" />
          ئالاقە ۋە مەزمۇن ئۆچۈرۈش تەلىپى
        </h2>
        <p>
          سوئال، تۈزىتىش ياكى تەكلىپ ئۈچۈن:{" "}
          <a href={`mailto:${CONTACT}`} dir="ltr">
            {CONTACT}
          </a>
        </p>
        <p>
          <strong>
            ئەگەر بۇ سايتتىكى بىرەر مەزمۇن سىزنىڭ ھوقۇقىڭىزغا دەخلى قىلىدۇ دەپ
            قارىسىڭىز، يۇقىرىقى ئادرېسقا خەت يېزىڭ — ئۇ مەزمۇن دەرھال تۈزىتىلىدۇ ياكى
            ئۆچۈرۈلىدۇ.
          </strong>
        </p>
      </div>
    </div>
  );
}
