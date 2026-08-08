"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOutAction } from "@/app/(auth)/actions";
import type { Category, SessionInfo } from "@/lib/types";
import type { Theme } from "@/lib/theme";
import brandMark from "@/public/brand.png";

type AppShellProps = {
  theme: Theme | null;
  session: SessionInfo | null;
  categories: Category[];
  children: ReactNode;
};

export function AppShell({ theme, session, categories, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  // Close the drawer on navigation (state adjustment during render).
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setDrawerOpen(false);
    setMobileSearchOpen(false);
  }

  /**
   * Reading surfaces own the whole screen: they carry their own sticky
   * toolbars, and stacking those under the site header would put two sticky
   * bars at top: 0 and cost scarce vertical space on a phone. The mushaf
   * (a single sura) reads exactly like a book, so it is bare too — /quran
   * itself keeps the shell, being an index page.
   */
  const bare = /^\/books\/[^/]+\/read$/.test(pathname) || /^\/quran\/[^/]+$/.test(pathname);

  // Lock body scroll only while the drawer is open (mobile rule: the page
  // must scroll normally again the moment it closes).
  useEffect(() => {
    if (!drawerOpen || bare) return;
    document.documentElement.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.documentElement.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen, bare]);

  if (bare) return <>{children}</>;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="grain safe-top safe-x sticky top-0 z-30 border-b border-bd bg-bg2">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-1.5 px-2 sm:gap-2 sm:px-5">
          <button
            type="button"
            className="ibtn lg:hidden"
            data-testid="menu-button"
            aria-label="تۈرلەر تىزىملىكىنى ئېچىش"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Icon name="menu" className="ic-lg" />
          </button>

          {/* The brand is the one element allowed to shrink, so adding a nav
              control can never push the row past 360 px. */}
          <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="باش بەت — بىلىم خەزىنىسى">
            <Image
              src={brandMark}
              alt=""
              width={30}
              height={30}
              priority
              className="shrink-0 rounded-[7px] shadow-sm ring-1 ring-bd"
            />
            <span className="flex min-w-0 flex-col gap-0.5 leading-none">
              <span className="truncate text-[15px] font-bold tracking-[.2px] text-ink">
                بىلىم خەزىنىسى
              </span>
              <span className="hidden font-sans text-[8px] font-bold tracking-[1.6px] text-ink3 sm:block">
                BILIM HEZINISI
              </span>
            </span>
          </Link>

          <form role="search" action="/search" className="sbox mx-2 hidden md:flex">
            <Icon name="search" className="text-ink3" />
            <input
              className="sinput"
              type="search"
              name="q"
              placeholder="كىتاب، ئاپتور ياكى مەزمۇن ئىزدەڭ…"
              aria-label="كۇتۇپخانىدىن ئىزدەش"
            />
          </form>

          <div className="ms-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
            <Link href="/quran" className="hbtn" data-testid="quran-link" title="قۇرئان كەرىم">
              <Icon name="mosque" />
              <span className="hidden sm:inline">قۇرئان</span>
            </Link>
            <button
              type="button"
              className="ibtn md:hidden"
              aria-label="ئىزدەش رامكىسىنى ئېچىش"
              aria-expanded={mobileSearchOpen}
              onClick={() => setMobileSearchOpen((open) => !open)}
            >
              <Icon name="search" className="ic-lg" />
            </button>
            <ThemeToggle initial={theme} />
            {session ? (
              <>
                {(session.role === "admin" || session.role === "uploader") && (
                  <Link href="/admin" className="hbtn" title="باشقۇرۇش سۇپىسى">
                    <Icon name="settings" />
                    <span className="hidden sm:inline">باشقۇرۇش</span>
                  </Link>
                )}
                <span
                  className="hidden max-w-36 truncate text-[13px] font-semibold text-ink2 md:inline"
                  title={session.email}
                >
                  {session.displayName}
                </span>
                <form action={signOutAction}>
                  <button type="submit" className="ibtn" title="چىقىش" aria-label="ھېساباتتىن چىقىش">
                    <Icon name="log-out" className="ic-lg" />
                  </button>
                </form>
              </>
            ) : (
              <Link href="/login" className="hbtn" data-testid="login-link">
                <Icon name="log-in" />
                <span className="hidden sm:inline">كىرىش</span>
              </Link>
            )}
          </div>
        </div>

        {mobileSearchOpen && (
          <div className="border-t border-bd px-3 pb-3 pt-2 md:hidden">
            <form role="search" action="/search" className="sbox flex">
              <Icon name="search" className="text-ink3" />
              <input
                className="sinput"
                type="search"
                name="q"
                placeholder="كىتاب، ئاپتور ياكى مەزمۇن ئىزدەڭ…"
                aria-label="كۇتۇپخانىدىن ئىزدەش (تېلېفون)"
                autoFocus
              />
            </form>
          </div>
        )}
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 items-start">
        <aside
          data-testid="sidebar-desktop"
          className="sticky top-16 hidden max-h-[calc(100dvh-4rem)] w-72 shrink-0 overflow-y-auto overscroll-contain border-e border-bd p-4 lg:block"
        >
          <SidebarContent categories={categories} />
        </aside>
        <main className="w-full min-w-0 flex-1">{children}</main>
      </div>

      <footer className="grain safe-bottom safe-x border-t border-bd bg-bg2">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-[13px] text-ink3">
          <span>«بىلىم خەزىنىسى» — ئۇيغۇرچە ئېلكىتاب خەزىنىسى</span>
          <span dir="ltr">© {new Date().getFullYear()}</span>
        </div>
      </footer>

      {/* Mobile category drawer (inline-start side, RTL-aware) */}
      <div
        data-testid="drawer-overlay"
        aria-hidden="true"
        onClick={() => setDrawerOpen(false)}
        className={`fixed inset-0 z-40 bg-black/45 transition-[opacity,visibility] duration-200 lg:hidden ${
          drawerOpen ? "visible opacity-100" : "invisible opacity-0"
        }`}
      />
      <aside
        data-testid="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="كىتاب تۈرلىرى"
        inert={!drawerOpen}
        className={`grain safe-top fixed inset-y-0 start-0 z-50 flex h-dvh w-[85vw] max-w-80 flex-col border-e border-bd bg-bg shadow-[var(--shadow-2)] transition-[transform,visibility] duration-200 lg:hidden ${
          drawerOpen ? "visible translate-x-0" : "invisible translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-bd px-3">
          <span className="flex items-center gap-2 text-[15px] font-bold">
            <Icon name="layers" className="text-am" />
            تۈرلەر
          </span>
          <button
            type="button"
            ref={closeButtonRef}
            className="ibtn"
            data-testid="drawer-close"
            aria-label="تىزىملىكنى تاقاش"
            onClick={() => setDrawerOpen(false)}
          >
            <Icon name="x" className="ic-lg" />
          </button>
        </div>
        <div className="safe-bottom flex-1 overflow-y-auto overscroll-contain p-4">
          <SidebarContent categories={categories} />
        </div>
      </aside>
    </div>
  );
}

function SidebarContent({ categories }: { categories: Category[] }) {
  const topLevel = categories.filter((category) => category.parent_id === null);
  const childrenOf = (parentId: number) =>
    categories.filter((category) => category.parent_id === parentId);

  return (
    <>
      <nav aria-label="بۆلۈملەر" className="mb-4 border-b border-bd pb-3">
        <Link
          href="/quran"
          data-testid="quran-sidebar-link"
          className="flex min-h-11 items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-[14px] font-semibold text-ink2 hover:bg-bg2 hover:text-ink"
        >
          <Icon name="mosque" className="text-am" />
          قۇرئان كەرىم
        </Link>
      </nav>

      <nav aria-label="كىتاب تۈرلىرى">
        <h2 className="mb-3 hidden items-center gap-2 text-[13px] font-bold text-ink2 lg:flex">
          <Icon name="layers" className="text-am" />
          تۈرلەر
        </h2>
        {categories.length > 0 && (
          <Link
            href="/"
            data-testid="category-all"
            className="mb-1 flex min-h-11 items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-[14px] font-semibold text-ink2 hover:bg-bg2 hover:text-ink"
          >
            <Icon name="layers" className="text-am" />
            ھەممە كىتابلار
          </Link>
        )}
        {topLevel.length === 0 ? (
          <p className="rounded-[var(--radius)] bg-ab px-3 py-3 text-[13px] leading-6 text-ink2">
            تۈرلەر تېخى قوشۇلمىغان. كىتابلار قوشۇلغاندا تۈرلەر مۇشۇ يەردە كۆرۈنىدۇ.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {topLevel.map((category) => (
              <li key={category.id}>
                <CategoryRow category={category} />
                {childrenOf(category.id).length > 0 && (
                  <ul className="ms-4 mt-0.5 space-y-0.5 border-s border-bd ps-2">
                    {childrenOf(category.id).map((child) => (
                      <li key={child.id}>
                        <CategoryRow category={child} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </nav>
    </>
  );
}

function CategoryRow({ category }: { category: Category }) {
  return (
    <Link
      href={`/?cat=${category.id}`}
      data-testid="category-link"
      data-category-id={category.id}
      className="flex min-h-11 items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-[14px] text-ink2 hover:bg-bg2 hover:text-ink"
    >
      <Icon name={(category.icon || "folder") as IconName} className="text-am" />
      <span className="min-w-0 truncate">{category.name}</span>
    </Link>
  );
}
