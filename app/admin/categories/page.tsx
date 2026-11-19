import type { Metadata } from "next";
import { Icon } from "@/components/icons";
import { CATEGORY_SYMBOL_NAMES, CategoryIconSprite } from "@/components/category-icons";
import { CategoryTree } from "@/components/admin/category-tree";
import { getCategories } from "@/lib/data";

export const metadata: Metadata = { title: "تۈرلەر" };

export default async function AdminCategoriesPage() {
  const categories = await getCategories();
  /*
   * The root layout already holds the pictures these categories wear, read
   * from this same request-cached list; the picker's preview needs the rest.
   */
  const worn = new Set(categories.map((category) => category.icon));
  const unworn = CATEGORY_SYMBOL_NAMES.filter((name) => !worn.has(name));

  return (
    <>
      <CategoryIconSprite names={unworn} />
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="layers" className="ic-lg text-am" />
        تۈرلەرنى باشقۇرۇش
      </h1>
      <p className="mt-1.5 text-[13.5px] text-ink3">
        تۈر قوشۇڭ، ئىسمى ۋە سىنبەلگىسىنى ئۆزگەرتىڭ، تەرتىپلەڭ ياكى تارماق تۈر قىلىڭ.
      </p>

      <div className="mt-5">
        <CategoryTree initial={categories} />
      </div>
    </>
  );
}
