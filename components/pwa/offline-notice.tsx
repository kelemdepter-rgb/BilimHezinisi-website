"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { readableOffline, type OfflineBook } from "@/lib/pwa/offline-books";

/**
 * What the reader sees when the network is gone.
 *
 * Two things have to happen here. It has to say, in plain Uyghur, which parts
 * of the library still work and which do not — a blank page or an English
 * browser error tells a reader nothing. And it has to offer a way onwards:
 * the books already stored on the device, listed by name.
 *
 * The heading adapts to what was actually being asked for, because the
 * browser keeps the original address in the bar: "search needs a connection"
 * is a different sentence from "this book is not saved on your phone", and
 * showing the wrong one sends the reader looking for the wrong fix.
 */

/** The address never changes while this page is up — nothing to subscribe to. */
function subscribeToLocation() {
  return () => {};
}

type Kind = "search" | "book" | "quran" | "page";

function kindOf(pathname: string): Kind {
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/books/")) return "book";
  if (pathname.startsWith("/quran")) return "quran";
  return "page";
}

const HEADINGS: Record<Kind, string> = {
  search: "ئىزدەش ئۈچۈن تور ئۇلىنىشى كېرەك",
  book: "بۇ كىتاب تېلېفونىڭىزغا ساقلانمىغان",
  quran: "بۇ بۆلۈم تېلېفونىڭىزغا ساقلانمىغان",
  page: "تور ئۇلىنىشى يوق",
};

const EXPLANATIONS: Record<Kind, string> = {
  search:
    "ئىزدەش سانلىق مەلۇمات ئامبىرىدا ئېلىپ بېرىلىدۇ، شۇڭا تورسىز ئىشلىمەيدۇ. تور كەلگەندە قايتا سىناڭ.",
  book: "تورسىز چاغدا سىز ئىلگىرى ئېچىپ باققان كىتابلارلا ئېچىلىدۇ. بۇ كىتابنى تور بار چاغدا بىر قېتىم ئېچىڭ، ئاندىن تورسىزمۇ ئوقۇيالايسىز.",
  quran: "تورسىز چاغدا سىز ئىلگىرى ئېچىپ باققان بۆلۈملەرلا ئېچىلىدۇ.",
  page: "بۇ بەتنى ئېچىش ئۈچۈن تور ئۇلىنىشى كېرەك.",
};

export function OfflineNotice() {
  const [books, setBooks] = useState<OfflineBook[]>([]);
  const [checked, setChecked] = useState(false);

  /**
   * What the reader was actually asking for. The service worker hands this
   * document back for a failed request without changing the address, so the
   * bar still says /search?q=… or /books/41/read — which is the only clue
   * available about what to explain.
   */
  const kind = useSyncExternalStore(
    subscribeToLocation,
    () => kindOf(window.location.pathname),
    () => "page" as Kind,
  );

  useEffect(() => {
    void readableOffline(window.location.origin)
      .then(setBooks)
      .finally(() => setChecked(true));
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="flex items-center gap-2.5 text-xl font-bold" data-testid="offline-heading">
        <Icon name="globe" className="ic-lg text-am" />
        {HEADINGS[kind]}
      </h1>
      <p className="mt-3 text-[14px] leading-8 text-ink2" data-testid="offline-explanation">
        {EXPLANATIONS[kind]}
      </p>

      <section className="paper grain mt-5 p-5 sm:p-6" aria-labelledby="offline-works">
        <h2 id="offline-works" className="flex items-center gap-2 text-[15px] font-bold">
          <Icon name="check" className="text-am" />
          تورسىز ئىشلەيدىغانلىرى
        </h2>
        <ul className="legal mt-2">
          <li>ئىلگىرى ئېچىپ باققان كىتابلار — توختىغان بېتىڭىزدىن داۋاملىشىدۇ.</li>
          <li>خەت چوڭلۇقى، قۇر ئارىلىقى ۋە تۈس تاللىشىڭىز.</li>
          <li>ئىلگىرى چۈشۈرۈۋالغان Word ياكى تېكىست ھۆججەتلىرىڭىز.</li>
        </ul>
        <h2 className="mt-5 flex items-center gap-2 text-[15px] font-bold">
          <Icon name="x" className="text-ink3" />
          تور كەلگەندە ئىشلەيدىغانلىرى
        </h2>
        <ul className="legal mt-2">
          <li>ئىزدەش (كۇتۇپخانا ۋە كىتاب ئىچى).</li>
          <li>تېخى ئېچىپ باقمىغان كىتابلار.</li>
          <li>ھېساباتقا كىرىش، خەتكۈچ ۋە خاتىرە ساقلاش.</li>
        </ul>
      </section>

      {checked && books.length > 0 && (
        <section className="mt-5" aria-labelledby="offline-books">
          <h2 id="offline-books" className="flex items-center gap-2 text-[15px] font-bold">
            <Icon name="book-open" className="text-am" />
            تېلېفونىڭىزدا ساقلانغان كىتابلار
          </h2>
          <ul className="mt-3 space-y-2" data-testid="offline-book-list">
            {books.map((book) => (
              <li key={book.id}>
                <Link
                  href={`/books/${book.id}/read`}
                  data-testid="offline-book-link"
                  className="paper grain flex min-h-11 items-center gap-2.5 px-3.5 py-3 text-[14px] hover:border-am"
                >
                  <Icon name="book" className="shrink-0 text-am" />
                  <span className="min-w-0 break-words">{book.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          className="btn-am"
          data-testid="offline-retry"
          onClick={() => window.location.reload()}
        >
          <Icon name="refresh" />
          قايتا سىناش
        </button>
        <Link href="/" className="hbtn">
          باش بەت
        </Link>
      </div>
    </div>
  );
}
