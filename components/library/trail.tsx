import Link from "next/link";

export type Crumb = {
  href: string;
  label: string;
  testId?: string;
};

/**
 * The path above a book or an author: «كۇتۇپخانا», then one link per step,
 * with `‹` between them.
 *
 * One component for both pages, so their trails cannot drift apart again —
 * they were two copies of the same markup until PROMPT-37. Every link is a
 * 44 px tap box around one line of 12.5 px text (the Mobile Rules); the nav
 * is that tall too, and keeps `flex-wrap` so a long trail folds on a phone
 * into rows that do not overlap. The margin beneath it is half what the
 * 19 px trail had, so the title under it moves by less than the box grew.
 */
const CRUMB = "inline-flex min-h-11 items-center hover:text-ink";

export function Trail({ label, crumbs }: { label: string; crumbs: Crumb[] }) {
  return (
    <nav aria-label={label} className="mb-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink3">
      <Link href="/" className={CRUMB}>
        كۇتۇپخانا
      </Link>
      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          <span aria-hidden="true">‹</span>
          <Link
            href={crumb.href}
            className={CRUMB}
            {...(crumb.testId ? { "data-testid": crumb.testId } : {})}
          >
            {crumb.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
