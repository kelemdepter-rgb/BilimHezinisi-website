import type { Metadata } from "next";
import { Icon } from "@/components/icons";
import { BatchImport } from "@/components/admin/batch-import";
import { getCategories } from "@/lib/data";

export const metadata: Metadata = { title: "توپلاپ كىتاب قوشۇش" };

export default async function BatchImportPage() {
  const categories = await getCategories();

  return (
    <>
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="layers" className="ic-lg text-am" />
        توپلاپ كىتاب قوشۇش
      </h1>
      <p className="mt-1.5 text-[13.5px] leading-7 text-ink3">
        بىر قانچە كىتابنى بىراقلا تاللاڭ، ھەر بىرىگە ئايرىم ماۋزۇ، ئاپتور، چۈشەندۈرۈش، تۈر ۋە
        ھالەت بېرىڭ، ئاندىن ھەممىسىنى بىر قېتىمدا ئەكىرىڭ. ھۆججەتلەر كومپيۇتېرىڭىزدىلا
        ئوقۇلىدۇ.
      </p>
      <div className="mt-5">
        <BatchImport categories={categories} />
      </div>
    </>
  );
}
