/**
 * The shapes a page holds while its own content is still on its way.
 *
 * Every route that fetches anything has a loading.tsx built from these, so a
 * click changes the screen in the same frame it happens rather than leaving
 * the old page sitting there. They are plain server components — a skeleton
 * that shipped JavaScript would be slower than the thing it stands in for.
 *
 * The rule they all follow: same box, same spacing, same grid as the real
 * content, so nothing jumps when the page lands. Everything here is built
 * from `.skel` (app/globals.css), which is a grey block first and a shimmer
 * second — a reader who asked for less movement gets the block, standing
 * still.
 */

/** The page padding every non-bare page uses. */
export function PageSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8" data-testid="page-skeleton" aria-busy="true">
      {/* One announcement for the whole page: a screen reader should hear
          that something is loading, not read out a wall of empty boxes. */}
      <span className="sr-only" role="status">
        يۈكلىنىۋاتىدۇ…
      </span>
      {children}
    </div>
  );
}

/** An icon-and-text page heading, the size of the real `h1`. */
export function HeadingSkeleton({ width = "w-52" }: { width?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="skel h-[22px] w-[22px] shrink-0 rounded-full" />
      <span className={`skel skel-line h-5 ${width}`} />
    </div>
  );
}

/** One line of prose. */
export function LineSkeleton({ width = "w-full" }: { width?: string }) {
  return <span className={`skel skel-line block ${width}`} />;
}

/**
 * One book card, matching BookCard's grid view exactly: a 3:4 cover, then a
 * two-line title and one line of author inside the same padding.
 */
export function BookCardSkeleton() {
  return (
    <li className="paper grain flex h-full flex-col overflow-hidden">
      <span className="skel block aspect-[3/4] w-full rounded-none border-0 border-b border-bd" />
      <span className="flex flex-1 flex-col gap-2 p-3">
        <LineSkeleton />
        <LineSkeleton width="w-2/3" />
      </span>
    </li>
  );
}

/** A page of book cards on the same grid the real one uses. */
export function BookGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <ul
      data-testid="book-grid-skeleton"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      {Array.from({ length: count }, (_, index) => (
        <BookCardSkeleton key={index} />
      ))}
    </ul>
  );
}

/** The library's count / sort / view-toggle row. */
export function LibraryControlsSkeleton() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="skel skel-line me-auto w-24" />
      <span className="skel h-11 w-32" />
      <span className="skel h-11 w-11 sm:w-24" />
      <span className="skel h-11 w-11 sm:w-24" />
    </div>
  );
}

/** A stack of full-width rows — note lists, author lists, search results. */
export function RowsSkeleton({ count = 6, height = "h-20" }: { count?: number; height?: string }) {
  return (
    <ul className="mt-5 space-y-2.5" data-testid="rows-skeleton">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className={`skel w-full ${height}`} />
      ))}
    </ul>
  );
}

/**
 * A reading surface: the bare full-height pages (the reader, the mushaf, the
 * note editor) that carry their own toolbar instead of the site header.
 */
export function ReadingSkeleton({ lines = 12 }: { lines?: number }) {
  return (
    <div className="flex min-h-dvh flex-col" data-testid="page-skeleton" aria-busy="true">
      <span className="sr-only" role="status">
        يۈكلىنىۋاتىدۇ…
      </span>
      <div className="safe-top safe-x sticky top-0 z-30 border-b border-bd bg-bg2">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-2 px-3">
          <span className="skel h-11 w-11 shrink-0" />
          <span className="skel skel-line w-40" />
          <span className="skel ms-auto h-11 w-11 shrink-0" />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3.5 px-4 py-6">
        {Array.from({ length: lines }, (_, index) => (
          <LineSkeleton key={index} width={index % 4 === 3 ? "w-2/3" : "w-full"} />
        ))}
      </div>
    </div>
  );
}

/**
 * A page of prose — «ھەققىدە», «مەخپىيەتلىك», the sign-in card, the book
 * request form.
 *
 * These fetch nothing, but they still sit under a loading boundary, because
 * the root layout reads cookies and so every navigation is a server round
 * trip. Without one of their own they would inherit the library's grid
 * skeleton and briefly promise a shelf of books that is not coming.
 */
export function ProseLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8" data-testid="page-skeleton" aria-busy="true">
      <span className="sr-only" role="status">
        يۈكلىنىۋاتىدۇ…
      </span>
      <HeadingSkeleton width="w-48" />
      <div className="mt-5 flex flex-col gap-3">
        <LineSkeleton />
        <LineSkeleton />
        <LineSkeleton width="w-4/5" />
        <LineSkeleton width="w-2/3" />
      </div>
    </div>
  );
}
