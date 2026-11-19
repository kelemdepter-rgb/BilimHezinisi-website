import type { ReactNode } from "react";

/**
 * Pictures that only a CATEGORY can wear — the Kaaba, prayer beads, a
 * Ramadan lantern and the rest of what the admin can pick on
 * /admin/categories beyond the shared sprite in components/icons.tsx.
 *
 * They are NOT in <IconSprite />, because that sprite is inlined into every
 * page a reader opens (twice: once in the HTML and once in the RSC payload).
 * All of them together cost ~2.8 KB brotli per page load; most are worn by
 * no category at all. So the root layout emits only the ones the categories
 * actually use, and the categories admin page emits the rest so its picker
 * can show them.
 *
 * Same lucide stroke style and 24-unit grid as the shared sprite. Lucide
 * (ISC) for the everyday shapes; the Islamic ones — crescent and star,
 * Kaaba, prayer beads, lantern, oil lamp, palm, family — are drawn here.
 */
const SYMBOLS = {
  "crescent-star": (
    <>
      <path d="M15.6 6.29A8 8 0 1 0 15.6 17.71 6.5 6.5 0 1 1 15.6 6.29Z" fill="currentColor" strokeWidth="0.8" />
      <path d="M15.6 12 17.95 11.24 17.95 8.77 19.4 10.76 21.75 10 20.3 12 21.75 14 19.4 13.24 17.95 15.23 17.95 12.76Z" fill="currentColor" strokeWidth="0.8" />
    </>
  ),
  kaaba: (
    <>
      <path d="M12 3 21 7v10l-9 4-9-4V7z" />
      <path d="m3 7 9 4 9-4" />
      <path d="M12 11v10" />
      <path d="m3 10.5 9 4 9-4" />
      <path d="M15 19.3v-3l2.5-1.1v3" />
    </>
  ),
  tasbih: (
    <>
      <g fill="currentColor" stroke="none">
        <circle cx="8.18" cy="14.76" r="1.35" />
        <circle cx="5.82" cy="11.51" r="1.35" />
        <circle cx="5.82" cy="7.49" r="1.35" />
        <circle cx="8.18" cy="4.24" r="1.35" />
        <circle cx="12" cy="3" r="1.35" />
        <circle cx="15.82" cy="4.24" r="1.35" />
        <circle cx="18.18" cy="7.49" r="1.35" />
        <circle cx="18.18" cy="11.51" r="1.35" />
        <circle cx="15.82" cy="14.76" r="1.35" />
      </g>
      <path d="M12 15.5v3.5" />
      <path d="M10.3 22 12 19l1.7 3z" />
    </>
  ),
  lantern: (
    <>
      <path d="M12 2v2" />
      <path d="M9 7h6l-1-3h-4z" />
      <path d="M9 7 7 10v5l2 3h6l2-3v-5l-2-3" />
      <path d="M10 21h4" />
      <path d="M12 18v3" />
      <path d="M12 10.5c-1 1.2-1.5 2-1.5 2.8a1.5 1.5 0 0 0 3 0c0-.8-.5-1.6-1.5-2.8z" />
    </>
  ),
  compass: (
    <>
      <path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" />
      <circle cx="12" cy="12" r="10" />
    </>
  ),
  palm: (
    <>
      <path d="M12.5 10c.5 4 .2 8-1.5 12" />
      <path d="M12.5 10C11 6.5 7.5 5.5 4 7" />
      <path d="M12.5 10c1.5-3.5 5-4.5 8.5-3" />
      <path d="M12.5 10C10 9 6 10 4.5 13.5" />
      <path d="M12.5 10c2.5-1 6.5 0 8 3.5" />
      <path d="M12.5 10c-.5-3 .5-6 3-8" />
      <path d="M8 22h8" />
    </>
  ),
  "oil-lamp": (
    <>
      <path d="M2 12h4.5" />
      <path d="M2 12c1.5 0 3 2 5 4h9c2 0 3.5-1 3.5-2.5 0-1-.7-1.6-1.5-1.6" />
      <path d="M6.5 12a5.5 3 0 0 1 11 0z" />
      <path d="M12 9V8" />
      <path d="M9 19h6l-1-3h-4z" />
      <path d="M3.2 9.8C3.2 8.5 4.5 7.8 4.5 6.5c0 1.3 1.3 2 1.3 3.3a1.3 1.3 0 0 1-2.6 0z" />
      <path d="M19.5 13.5c2 0 2.5-2 2.5-3a2 2 0 0 0-2.5-1.9" />
    </>
  ),
  hourglass: (
    <>
      <path d="M5 22h14" />
      <path d="M5 2h14" />
      <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
      <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
    </>
  ),
  flag: (
    <path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" />
  ),
  mountain: <path d="m8 3 4 8 5-5 5 15H2L8 3z" />,
  map: (
    <>
      <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
      <path d="M15 5.764v15" />
      <path d="M9 3.236v15" />
    </>
  ),
  calendar: (
    <>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </>
  ),
  newspaper: (
    <>
      <path d="M15 18h-5" />
      <path d="M18 14h-8" />
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2" />
      <rect width="8" height="4" x="10" y="6" rx="1" />
    </>
  ),
  glasses: (
    <>
      <circle cx="6" cy="15" r="4" />
      <circle cx="18" cy="15" r="4" />
      <path d="M14 15a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
      <path d="M2.5 13 5 7c.7-1.3 1.4-2 3-2" />
      <path d="M21.5 13 19 7c-.7-1.3-1.5-2-3-2" />
    </>
  ),
  "graduation-cap": (
    <>
      <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" />
      <path d="M22 10v6" />
      <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
    </>
  ),
  flask: (
    <>
      <path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" />
      <path d="M6.453 15h11.094" />
      <path d="M8.5 2h7" />
    </>
  ),
  atom: (
    <>
      <circle cx="12" cy="12" r="1" />
      <path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z" />
      <path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z" />
    </>
  ),
  stethoscope: (
    <>
      <path d="M11 2v2" />
      <path d="M5 2v2" />
      <path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1" />
      <path d="M8 15a6 6 0 0 0 12 0v-3" />
      <circle cx="20" cy="10" r="2" />
    </>
  ),
  laptop: (
    <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16" />
  ),
  coins: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
      <path d="M7 6h1v4" />
      <path d="m16.71 13.88.7.71-2.82 2.82" />
    </>
  ),
  award: (
    <>
      <path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526" />
      <circle cx="12" cy="8" r="6" />
    </>
  ),
  family: (
    <>
      <circle cx="8" cy="5" r="2.5" />
      <path d="M3.5 21v-7a4.5 4.5 0 0 1 9 0v7" />
      <circle cx="17.5" cy="10" r="2" />
      <path d="M14.5 21v-4a3 3 0 0 1 6 0v4" />
    </>
  ),
  baby: (
    <>
      <path d="M9 12h.01" />
      <path d="M15 12h.01" />
      <path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5" />
      <path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1" />
    </>
  ),
  heart: (
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  ),
  sprout: (
    <>
      <path d="M7 20h10" />
      <path d="M10 20c5.5-2.5.8-6.4 3-10" />
      <path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" />
      <path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" />
    </>
  ),
  house: (
    <>
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  utensils: (
    <>
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
      <path d="M7 2v20" />
      <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type CategorySymbolName = keyof typeof SYMBOLS;

export const CATEGORY_SYMBOL_NAMES = Object.keys(SYMBOLS) as CategorySymbolName[];

function isCategorySymbol(name: string): name is CategorySymbolName {
  return Object.hasOwn(SYMBOLS, name);
}

/**
 * The category-only symbols among `names`, as one hidden sprite — nothing at
 * all when none of them is a category-only picture. Names the shared sprite
 * already holds (book, mosque…) and unknown names are skipped, so the same
 * id never appears twice on a page.
 */
export function CategoryIconSprite({ names }: { names: Iterable<string> }) {
  const wanted = [...new Set(names)].filter(isCategorySymbol);
  if (wanted.length === 0) return null;
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        {wanted.map((name) => (
          <symbol key={name} id={`i-${name}`} viewBox="0 0 24 24">
            {SYMBOLS[name]}
          </symbol>
        ))}
      </defs>
    </svg>
  );
}
