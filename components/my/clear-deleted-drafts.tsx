"use client";

import { useEffect } from "react";
import { finishPendingDeletion } from "@/lib/notes/drafts";
import { noteHistory } from "@/lib/notes/history";

/**
 * Rendered only on the page the server sends a browser to once an account is
 * gone: that account's unsaved notebook copies leave this browser too, and
 * so do the earlier versions of notes kept here (PROMPT-46). See
 * components/my/delete-account.tsx.
 */
export function ClearDeletedDrafts() {
  useEffect(() => {
    if (finishPendingDeletion()) void noteHistory.clearAll();
  }, []);
  return null;
}
