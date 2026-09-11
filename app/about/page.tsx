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

const DESKTOP_REPO = "https://apps.microsoft.com/detail/9N2T15L4DX86?hl=en-us&gl=TR&ocid=pdpshare";
const CONTACT = "kelemdepter@gmail.com";

/**
 * Every third-party source the site serves, with the licence it is used under.
 * `name` is the source itself and is set in bold; `qualifier` is the aside that
 * follows it and stays at normal weight.
 */
const SOURCES: {
  name: string;
  qualifier?: string;
  who: string;
  licence: string;
  href?: string;
}[] = [
  {
    name: "قۇرئان ئەرەبچە تېكىستى",
    qualifier: "(ئوسمانىي، ھەفس)",
    who: "Tanzil Project",
    licence: "CC BY 3.0 — تېكىستكە ھېچقانداق ئۆزگەرتىش كىرگۈزۈلمىگەن",
    href: "https://tanzil.net",
  },
  {
    name: "قۇرئان ئۇيغۇرچە تەرجىمىسى",
    who: "شەيخ مۇھەممەد سالىھ — QuranEnc.com, v1.0.2-xml.1",
    licence: "QuranEnc نەشر شەرتلىرى بويىچە",
    href: "https://quranenc.com/en/browse/uyghur_saleh",
  },
  {
    name: "UKIJ خەت نۇسخىلىرى",
    qualifier: "(Ekran, Tuz, Tuz Tom, Tuz Kitab)",
    who: "Uyghur Computer Science Association (ukij.org)",
    licence: "LGPL",
    href: "http://www.ukij.org",
  },
  {
    name: "Uthmanic Hafs خەت نۇسخىسى",
    qualifier: "(قۇرئان ئۈچۈن)",
    who: "King Fahd Glorious Quran Printing Complex (KFGQPC)",
    licence: "ھەقسىز تارقىتىشقا رۇخسەت قىلىنىدۇ، لېكىن ئۆزگەرتىشكە بولمايدۇ — ئەينەن ساقلانغان",
    href: "http://fonts.qurancomplex.gov.sa/",
  },
  {
    name: "ئىملا لۇغىتى",
    who: "UyghurSpell (gheyret/UyghurSpell)",
    licence: "MIT",
    href: "https://github.com/gheyret/UyghurSpell",
  },
  {
    name: "SymSpell ئىملا ئالگورىزىمى",
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
        <p>
          «بىلىم خەزىنىسى» — ئۇيغۇرچە ئېلېكتىرونلۇق كىتابلار جەملەنگەن، كەڭ ئۇيغۇر
          خەلقىمىزنىڭ پايدىلىنىشى ئۈچۈن ئېچىۋېتىلگەن رەقەملىك تور كۇتۇپخانىسىدۇر. كىتاب
          ئوقۇش، ماتېرىيال ئىزدەش ۋە قۇرئان كەرىمنى مۇتالىئە قىلىش ئۈچۈن
          ھېچقانداق ھېسابات ئېچىش تەلەپ قىلىنمايدۇ. ئەگەر ھېسابات
          ئاچسىڭىز، خەتكۈش، شەخسىي خاتىرە، ئوقۇش ئىزى ۋە خاتىرە دەپتەر قاتارلىق قوشۇمچە
          ئىقتىدارلاردىنمۇ ھەقسىز بەھرىمەن بولالايسىز.
        </p>
        <p>
          مەزكۇر كۇتۇپخانىدا ئېلان، ئىز قوغلاش (Tracking) ۋە سىتاتىستىكا قىلىش قاتارلىقلار
          پۈتۈنلەي چەكلەنگەن
          بولۇپ، بۇ بەتلەردە ھېچقانداق ئۈچىنچى تەرەپ كودى ئىجرا قىلىنمايدۇ. تەپسىلاتىنى{" "}
          <Link href="/privacy">«مەخپىيەتلىك ۋە بىخەتەرلىك»</Link> بېتىدىن كۆرەلەيسىز.
        </p>

        <h2>
          <Icon name="users" className="text-am" />
          تارقاتقۇچى
        </h2>
        <ul>
          <li>
            <strong>تارقاتقۇچى ئورۇن:</strong> ئىخلاس نەشرىياتى
          </li>
          <li>
            <strong>تۈزگۈچى:</strong> ئابدۇسەمەد
          </li>
        </ul>
        <p>
          كۇتۇپخانىنىڭ تورسىز ھالەتتىمۇ ئىشلەيدىغان{" "}
          <a href={DESKTOP_REPO} target="_blank" rel="noreferrer">
            «بىلىم خەزىنىسى» (Windows)
          </a>{" "}
          نۇسخىسىمۇ تارقىتىلدى. ئۇنىڭغا سىكاننېرلانغان PDF ھۆججەتلەرنى تېكىستكە
          ئايلاندۇرۇش (OCR) قاتارلىق، تور نۇسخىسىدا يوق قۇلايلىق ئىقتىدارلارمۇ قوشۇلغان.
        </p>

        <h2>
          <Icon name="scale" className="text-am" />
          مەنبەلەر ۋە ئىجازەتنامىلەر
        </h2>
        <p>
          مەزكۇر تور بېكەت تۆۋەندىكى مەنبەلەرنى ئۆز ئالدىغا بېكىتىلگەن ئىجازەتنامە
          شەرتلىرىگە ئاساسەن ئىشلىتىدۇ:
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>مەنبە</th>
                <th>ئىگىسى</th>
                <th>ئىجازەتنامە شەرتى</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((source) => (
                <tr key={source.name}>
                  <td>
                    <strong>{source.name}</strong>
                    {source.qualifier ? ` ${source.qualifier}` : null}
                  </td>
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

        <h2>
          <Icon name="book-marked" className="text-am" />
          كىتابلار ھەققىدە
        </h2>
        <p>
          كۇتۇپخانىدىكى بارلىق كىتابلارنىڭ نەشر ھوقۇقى ئۆز ئاپتورلىرى ۋە نەشرىياتلىرىغا
          تەۋە. بۇ كىتابلار تور بېكىتىمىزدە ئوقۇرمەنلەرنىڭ ھەقسىز ۋە ئېلانسىز
          پايدىلىنىشى ئۈچۈن سۇنۇلدى.
        </p>

        <h2>
          <Icon name="mail" className="text-am" />
          ئالاقە ۋە مەزمۇن ئۆچۈرۈش تەلىپى
        </h2>
        <p>
          ھەر قانداق سوئال، تۈزىتىش پىكرى ياكى تەكلىپ-مەسلىھەتلىرىڭىز بولسا تۆۋەندىكى
          ئېلخەت ئارقىلىق بىز بىلەن ئالاقىلىشىڭ:
        </p>
        <p>
          <strong>
            <a href={`mailto:${CONTACT}`} dir="ltr">
              {CONTACT}
            </a>
          </strong>
        </p>
        <p>
          ئەگەر مەزكۇر تور بېكەتتىكى مەلۇم بىر مەزمۇننى نەشر ھوقۇقىڭىزغا دەخلى-تەرۇز
          قىلدى دەپ قارىسىڭىز، يۇقىرىقى ئېلخەت ئادرېسىغا ئۇچۇر قىلىڭ. مۇناسىۋەتلىك
          مەزمۇنلار دەرھال تۈزىتىلىدۇ ياكى سىستېمىدىن ئۆچۈرۈلىدۇ.
        </p>
      </div>
    </div>
  );
}
