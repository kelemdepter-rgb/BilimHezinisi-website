import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { RequestInbox } from "@/components/admin/request-inbox";
import { getServerRole } from "@/lib/admin/guards";
import { listBookRequests } from "@/lib/requests";

export const metadata: Metadata = { title: "كىتاب تەلەپلىرى" };

/**
 * Admin-only, twice over: this guard, and the RLS policy in migration 0022
 * that returns nothing at all to anyone else. An uploader manages books; an
 * inbox of readers' messages and addresses is not that.
 */
export default async function AdminRequestsPage() {
  const session = await getServerRole();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/admin");

  const requests = await listBookRequests();
  const open = requests.filter((request) => !request.handled).length;

  return (
    <>
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="mail" className="ic-lg text-am" />
        كىتاب تەلەپلىرى
      </h1>
      <p className="mt-1.5 text-[13.5px] text-ink3" data-testid="requests-summary">
        {open > 0 ? `${open} يېڭى تەلەپ` : "يېڭى تەلەپ يوق"} · جەمئىي {requests.length}
      </p>
      <p className="mt-2 max-w-2xl text-[12.5px] leading-6 text-ink3">
        بۇ تەلەپلەرنى پەقەت سىزلا كۆرەلەيسىز. بېجىرىلگەنلىرىنى ئۆچۈرۈپ تۇرۇڭ — ساندان
        بوشلۇقى چەكلىك، ھەم كۈنىگە ئەڭ كۆپ 100 تەلەپ قوبۇل قىلىنىدۇ.
      </p>

      <div className="mt-5">
        <RequestInbox requests={requests} />
      </div>
    </>
  );
}
