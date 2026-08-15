"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Snippet } from "@/components/search/snippet";
import { listBookMatchesAction, type BookMatch } from "@/app/search-actions";
import type { SearchHit } from "@/lib/search";

export type BookGroup = {
  bookId: number;
  title: string;
  author: string;
  hits: SearchHit[];
};

/** Shown inline before the reader has to ask for the rest. */
const PREVIEW_HITS = 3;
/**
 * How many places the expander lists. A word can sit on hundreds of pages, and
 * unrolling all of them buries every other book under one — the rest belong to
 * the reader's own ↑ ↓ navigator, which walks the whole book anyway.
 */
const EXPANDED_HITS = 10;

/**
 * The page number, labelled and in a column of its own width. Bare digits of
 * different lengths beside multi-line snippets read as stray numbers rather
 * than as pages.
 */
function PageChip({ pageNo }: { pageNo: number }) {
  return (
    <span
      className="mt-0.5 w-14 shrink-0 rounded bg-bg2 px-1.5 py-0.5 text-center text-[11.5px] tabular-nums text-ink2"
      data-testid="page-chip"
    >
      {pageNo}-بەت
    </span>
  );
}

/**
 * Search results grouped by book, with the desktop's "+" expander: one tap
 * lists every place the word appears in that book, and each one opens the
 * reader at exactly that occurrence.
 *
 * The flat list this replaces made a book with forty matches look like forty
 * unrelated results, and gave no way to see the rest of them.
 */
export function BookResults({ groups, term }: { groups: BookGroup[]; term: string }) {
  return (
    <ul className="mt-3 space-y-3" data-testid="search-results">
      {groups.map((group) => (
        <li key={group.bookId} className="paper p-3.5" data-testid="search-book-group">
          <BookGroupRow group={group} term={term} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Every result carries the occurrence it points at (m=) and the fact that it
 * came from a search (from=search) — the first lands the reader on the exact
 * word, the second makes the back control return to these results.
 */
function readerHref(bookId: number, pageNo: number, term: string, matchIndex = 0) {
  const page = Math.max(1, pageNo);
  return `/books/${bookId}/read?page=${page}&q=${encodeURIComponent(term)}&m=${matchIndex}&from=search`;
}

function BookGroupRow({ group, term }: { group: BookGroup; term: string }) {
  const [expanded, setExpanded] = useState<BookMatch[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function expand() {
    if (expanded) {
      setExpanded(null);
      return;
    }
    startTransition(async () => {
      const result = await listBookMatchesAction({ bookId: group.bookId, query: term });
      setFailed(result.failed);
      setTruncated(result.truncated);
      setExpanded(result.matches);
    });
  }

  // Ordered by page, not by rank: someone scanning one book's hits reads them
  // as a walk through the book, and 184 · 138 · 575 looks like a fault.
  const pageHits = group.hits
    .filter((hit) => hit.page_no > 0)
    .sort((a, b) => a.page_no - b.page_no);
  const preview = pageHits.slice(0, PREVIEW_HITS);
  const shown = expanded?.slice(0, EXPANDED_HITS) ?? [];
  const remaining = (expanded?.length ?? 0) - shown.length;

  return (
    <>
      <h2 className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Link
          href={`/books/${group.bookId}`}
          className="text-[15px] font-bold text-ink hover:underline"
          data-testid="search-book-title"
        >
          {group.title}
        </Link>
        {group.author && <span className="text-[12.5px] text-ink3">{group.author}</span>}
      </h2>

      <ul className="mt-2 space-y-1.5">
        {preview.map((hit) => (
          <li key={hit.page_no}>
            <Link
              href={readerHref(group.bookId, hit.page_no, term)}
              data-testid="search-result"
              className="flex gap-2 rounded-[var(--radius)] px-2 py-1.5 hover:bg-bg2"
            >
              <PageChip pageNo={hit.page_no} />
              <span className="min-w-0 text-[13.5px] leading-7 text-ink2">
                <Snippet snippet={hit.snippet} />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* The book's own occurrences, on request — the same idea as the
          desktop's "+ show every place in this book". */}
      {pageHits.length > 0 && (
        <button
          type="button"
          className="hbtn mt-2"
          data-testid="expand-book-matches"
          aria-expanded={Boolean(expanded)}
          disabled={pending}
          onClick={expand}
        >
          <Icon name={expanded ? "x" : "plus"} />
          {pending
            ? "ئىزدەۋاتىدۇ…"
            : expanded
              ? "يىغىش"
              : "بۇ كىتابتىكى بارلىق ئورۇنلارنى كۆرۈش"}
        </button>
      )}

      {failed && (
        <p role="alert" className="mt-2 text-[12.5px] text-ink3">
          بۇ كىتابنىڭ ئىچىنى ئاچقىلى بولمىدى.
        </p>
      )}

      {expanded && expanded.length === 0 && !failed && (
        <p className="mt-2 text-[12.5px] text-ink3">باشقا ئورۇن تېپىلمىدى.</p>
      )}

      {expanded && expanded.length > 0 && (
        <>
          <p className="mt-2 text-[12px] text-ink3" data-testid="expanded-count">
            بۇ كىتابتا {expanded.length}
            {truncated ? "+" : ""} ئورۇندا بار
          </p>
          <ol className="mt-1 space-y-1" data-testid="expanded-matches">
            {shown.map((item) => (
              <li key={`${item.pageNo}-${item.matchIndex}`}>
                <Link
                  href={readerHref(group.bookId, item.pageNo, term, item.matchIndex)}
                  data-testid="expanded-match"
                  className="flex gap-2 rounded-[var(--radius)] px-2 py-1.5 hover:bg-bg2"
                >
                  <PageChip pageNo={item.pageNo} />
                  <span className="min-w-0 text-[13px] leading-7 text-ink2">
                    {item.before}
                    <mark className="rounded bg-ab2 px-0.5 font-semibold text-ink">
                      {item.match}
                    </mark>
                    {item.after}
                  </span>
                </Link>
              </li>
            ))}
          </ol>

          {/* The rest are not listed on purpose. Opening any of these and
              using the ↑ ↓ arrows walks every occurrence in the book. */}
          {remaining > 0 && (
            <p className="mt-1.5 px-2 text-[12px] leading-6 text-ink3" data-testid="expanded-more">
              يەنە {remaining} ئورۇن بار — بىرىنى ئېچىپ، يۇقىرىدىكى{" "}
              <span dir="ltr">↑ ↓</span> بىلەن ھەممىسىنى كۆرەلەيسىز.
            </p>
          )}
        </>
      )}
    </>
  );
}
