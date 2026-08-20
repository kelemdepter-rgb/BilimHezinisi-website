import type { Metadata } from "next";
import { OfflineNotice } from "@/components/pwa/offline-notice";

/**
 * The page the service worker serves when a request fails and nothing is
 * stored for it.
 *
 * It is precached at install time, so it has to be a real route rather than a
 * client-rendered fallback: whatever this returns is the whole document a
 * reader gets with no network at all.
 *
 * Not indexed — it describes a broken connection, not part of the library.
 */
export const metadata: Metadata = {
  title: "تور ئۇلىنىشى يوق",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return <OfflineNotice />;
}
