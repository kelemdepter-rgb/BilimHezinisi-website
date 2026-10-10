import { NOTE_QUOTA_MAX_NOTES } from "@/lib/notes/limits";
import { QUOTA_MEGABYTES, formatMegabytes, type NotebookUsage } from "@/lib/notes/usage";

/** Said once the notebook is full, under either limit. */
export const USAGE_FULL_HINT = "كېرەكسىز خاتىرىلەرنى ئۆچۈرسىڭىز، ئورۇن بوشايدۇ.";

/** The line's id, for «يېڭى خاتىرە» to point at when no new note fits. */
export const NOTES_USAGE_ID = "notes-usage";

const TONE = {
  ok: "text-ink3",
  near: "rounded-[var(--radius)] bg-ab px-3 py-1.5 text-ink2",
  full: "rounded-[var(--radius)] bg-ab2 px-3 py-1.5 text-ink",
} as const;

/**
 * Where the writer stands against the notebook's quota (PROMPT-44): how many
 * notes of 200, how many megabytes of 5. Plain at first, the warning colour
 * from 90 % of either limit, the strong one — and what to do — at the limit.
 *
 * Each «… MB» is isolated as a left-to-right unit: left to the paragraph's
 * right-to-left order, the Latin «MB» pulls the numbers around it into its
 * own run and the line reads out of order.
 */
export function NotesUsage({ usage }: { usage: NotebookUsage }) {
  return (
    <p
      id={NOTES_USAGE_ID}
      data-testid="notes-usage"
      data-level={usage.level}
      className={`mt-2 inline-block max-w-full text-[13px] leading-6 ${TONE[usage.level]}`}
    >
      {usage.count} / {NOTE_QUOTA_MAX_NOTES} خاتىرە · <bdi>{formatMegabytes(usage.bytes)} MB</bdi> /{" "}
      <bdi>{QUOTA_MEGABYTES} MB</bdi>
      {usage.level === "full" && (
        <span className="block font-semibold" data-testid="notes-usage-hint">
          {USAGE_FULL_HINT}
        </span>
      )}
    </p>
  );
}
