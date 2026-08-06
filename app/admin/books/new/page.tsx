import type { Metadata } from "next";
import { Icon } from "@/components/icons";
import { UploadWizard } from "@/components/admin/upload-wizard";
import { getCategories } from "@/lib/data";

export const metadata: Metadata = { title: "يېڭى كىتاب" };

export default async function NewBookPage() {
  const categories = await getCategories();

  return (
    <>
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="plus" className="ic-lg text-am" />
        يېڭى كىتاب قوشۇش
      </h1>
      <p className="mt-1.5 text-[13.5px] text-ink3">
        ھۆججەت كومپيۇتېرىڭىزدىلا ئوقۇلىدۇ، ئاندىن تېكىستى بەتلەرگە بۆلۈنۈپ ساقلىنىدۇ.
      </p>
      <div className="mt-5">
        <UploadWizard categories={categories} />
      </div>
    </>
  );
}
