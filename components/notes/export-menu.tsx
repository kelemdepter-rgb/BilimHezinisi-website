"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/icons";
import {
  getExportFootnotesServerSnapshot,
  getExportFootnotesSnapshot,
  setExportFootnotes,
  subscribeExportFootnotes,
} from "@/lib/notes/export-prefs";
import type { NoteTypography } from "@/lib/notes/typography";

type ExportKind = "docx" | "print" | "md" | "txt";

/** The note as it stands on screen, as the editor lends it. */
export type ExportSource = { title: string; html: string; typography: NoteTypography };

const ITEMS: { kind: ExportKind; icon: IconName; label: string }[] = [
  { kind: "docx", icon: "file-text", label: "Word (.docx)" },
  { kind: "print", icon: "printer", label: "PDF / بېسىپ چىقىرىش" },
  { kind: "md", icon: "type", label: "Markdown (.md)" },
  { kind: "txt", icon: "file-text", label: "تېكىست (.txt)" },
];

/**
 * Write the note as `kind`, entirely in this browser. Each writer is fetched
 * when it is used — docx with JSZip is ~340 KB, turndown ~30 KB — never with
 * the editor. PDF is the browser's own print, which "Save as PDF" turns into
 * a file; nothing is generated on a server.
 */
async function exportAs(kind: ExportKind, note: ExportSource, footnotes: boolean): Promise<void> {
  if (kind === "print") window.print();
  else if (kind === "docx") {
    const { downloadDocx } = await import("@/lib/notes/export-docx");
    await downloadDocx(note.title, note.html, { typography: note.typography, footnotes });
  } else if (kind === "md") {
    const { downloadMarkdown } = await import("@/lib/notes/export-markdown");
    downloadMarkdown(note.title, note.html, { footnotes });
  } else {
    const { downloadText } = await import("@/lib/notes/export-text");
    downloadText(note.title, note.html);
  }
}

/**
 * «چىقىرىش»: the note as Word, PDF (the browser's own print), Markdown or
 * text (PROMPT-50), and the switch that makes citations footnotes.
 *
 * A row of the sticky header that takes the overflow's place, as the find bar
 * does — never a popover hanging below the overflow, which on a 375×667
 * phone would push the header past the bottom of the screen, where a sticky
 * header's last rows can never be scrolled to. Rendered only while open, and
 * loaded apart from the editor (note-editor.tsx says when). Every item is a
 * 44 px tap target, two to a row on a phone and all in one row where there is
 * room. Escape or «تاقاش» closes it; so does choosing a file.
 */
export default function ExportMenu({
  read,
  onFailed,
  onClose,
}: {
  /** The note, read when a file is chosen — never earlier, so nothing typed since is missed. */
  read: () => ExportSource;
  /** Say, under the toolbar, that a file could not be made. */
  onFailed: (message: string) => void;
  onClose: () => void;
}) {
  const footnotes = useSyncExternalStore(
    subscribeExportFootnotes,
    getExportFootnotesSnapshot,
    getExportFootnotesServerSnapshot,
  );

  // Before the menu is painted, not after: a passive effect can run a moment
  // after a lazily loaded menu appears, and an Escape in that moment was lost.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="border-t border-bd px-2 py-1.5 sm:px-4" data-testid="export-menu">
      <div
        role="menu"
        aria-label="چىقىرىش"
        className="mx-auto grid w-full max-w-4xl grid-cols-2 items-center gap-1.5 sm:flex sm:flex-wrap"
      >
        {ITEMS.map((item) => (
          <button
            key={item.kind}
            type="button"
            role="menuitem"
            className="hbtn justify-start"
            data-testid={`export-${item.kind}`}
            onClick={() => {
              const note = read();
              onClose();
              exportAs(item.kind, note, footnotes).catch(() => onFailed("ھۆججەتنى چىقارغىلى بولمىدى."));
            }}
          >
            <Icon name={item.icon} className="shrink-0" />
            <span className="min-w-0">{item.label}</span>
          </button>
        ))}
        <div className="col-span-2 flex items-center gap-1.5 sm:flex-1">
          {/* For Word and Markdown: citations at the foot of the page, not in the text. */}
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={footnotes}
            className={`${footnotes ? "hbtn on" : "hbtn"} min-w-0 flex-1 justify-start sm:flex-none`}
            data-testid="export-footnotes"
            onClick={() => setExportFootnotes(!footnotes)}
          >
            <Icon name={footnotes ? "check" : "quote"} className="shrink-0" />
            <span className="min-w-0">مەنبەلەرنى ئاستى ئىزاھات قىلىش</span>
          </button>
          <button
            type="button"
            className="ibtn sm:ms-auto"
            data-testid="export-close"
            aria-label="تاقاش"
            onClick={onClose}
          >
            <Icon name="x" className="ic-lg" />
          </button>
        </div>
      </div>
    </div>
  );
}
