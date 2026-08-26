import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AiSettings } from "@/components/my/ai-settings";
import { getAccountOwner } from "@/lib/my/account";

export const metadata: Metadata = {
  title: "سۈنئىي ئىدراك",
  robots: { index: false, follow: false },
};

/**
 * Where a reader sets up AI with their OWN Gemini key.
 *
 * Everything on this screen lives in the reader's browser: the key, the
 * switch, the model and the usage counters. The server renders the frame and
 * nothing else — it has no key to send down and no usage to look up, which is
 * exactly the point of the design.
 *
 * Signed in only, for one honest reason: AI belongs with the other personal
 * settings, and a page that offers to remember something needs somebody to
 * remember it for. Reading, searching and the rest of the library still need
 * no account at all.
 */
export default async function AiSettingsPage() {
  const owner = await getAccountOwner();
  if (!owner) redirect("/login");

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <AiSettings />
    </div>
  );
}
