"use client";

import { useEffect } from "react";
import { finishPendingDeletion } from "@/lib/notes/drafts";

/**
 * Rendered only on the page the server sends a browser to once an account is
 * gone: that account's unsaved notebook copies leave this browser too. See
 * components/my/delete-account.tsx.
 */
export function ClearDeletedDrafts() {
  useEffect(() => {
    finishPendingDeletion();
  }, []);
  return null;
}
