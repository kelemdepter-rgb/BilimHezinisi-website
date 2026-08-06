import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { AnnotationList } from "@/components/my/annotation-list";
import { getMyAnnotations } from "@/lib/my";

export const metadata: Metadata = { title: "خاتىرىلىرىم" };

export default async function MyNotesPage() {
  const groups = await getMyAnnotations("note");
  if (groups === null) redirect("/login");

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="notebook-pen" className="ic-lg text-am" />
        خاتىرىلىرىم
      </h1>

      {groups.length === 0 ? (
        <p className="paper mt-5 p-6 text-center text-[13.5px] leading-7 text-ink2">
          تېخى خاتىرە يوق. كىتاب ئوقۇۋاتقاندا خاتىرە قوشسىڭىز مۇشۇ يەردە توپلىنىدۇ.
        </p>
      ) : (
        <div className="mt-5">
          <AnnotationList groups={groups} kind="note" />
        </div>
      )}
    </div>
  );
}
