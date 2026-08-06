"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Icon, type IconName } from "@/components/icons";
import {
  createCategoryAction,
  deleteCategoryAction,
  reorderCategoriesAction,
  updateCategoryAction,
} from "@/app/admin/categories/actions";
import type { Category } from "@/lib/types";

/** Icons offered for categories — all already in the shared sprite. */
const CATEGORY_ICONS: IconName[] = [
  "folder", "book", "book-open", "book-marked", "scroll", "mosque", "landmark",
  "scale", "feather", "languages", "star", "smile", "bookmark", "layers",
  "file-text", "globe", "tag", "notebook-pen",
];

type FlatNode = { category: Category; depth: number; index: number };

/** Depth-first order, mirroring how the tree is displayed. */
function flatten(categories: Category[]): FlatNode[] {
  const byParent = new Map<number | null, Category[]>();
  for (const category of categories) {
    const list = byParent.get(category.parent_id) ?? [];
    list.push(category);
    byParent.set(category.parent_id, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }
  const out: FlatNode[] = [];
  const walk = (parentId: number | null, depth: number) => {
    for (const category of byParent.get(parentId) ?? []) {
      out.push({ category, depth, index: out.length });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return out.map((node, index) => ({ ...node, index }));
}

/** Renumber every row so sort_order matches the displayed order. */
function renumber(categories: Category[]): Category[] {
  const byParent = new Map<number | null, Category[]>();
  for (const category of categories) {
    const list = byParent.get(category.parent_id) ?? [];
    list.push(category);
    byParent.set(category.parent_id, list);
  }
  const next = categories.map((c) => ({ ...c }));
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    list.forEach((category, order) => {
      const target = next.find((c) => c.id === category.id);
      if (target) target.sort_order = order;
    });
  }
  return next;
}

function descendantsOf(categories: Category[], id: number): Set<number> {
  const out = new Set<number>();
  const walk = (parentId: number) => {
    for (const category of categories) {
      if (category.parent_id === parentId && !out.has(category.id)) {
        out.add(category.id);
        walk(category.id);
      }
    }
  };
  walk(id);
  return out;
}

export function CategoryTree({ initial }: { initial: Category[] }) {
  const [categories, setCategories] = useState<Category[]>(initial);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const dragId = useRef<number | null>(null);

  const flat = useMemo(() => flatten(categories), [categories]);

  function persist(next: Category[]) {
    const numbered = renumber(next);
    setCategories(numbered);
    startTransition(async () => {
      const result = await reorderCategoriesAction(
        numbered.map((c) => ({ id: c.id, parent_id: c.parent_id, sort_order: c.sort_order })),
      );
      if (!result.ok) {
        setNotice({ ok: false, text: result.error });
        setCategories(initial);
      } else {
        setNotice(null);
      }
    });
  }

  function siblingsOf(parentId: number | null): Category[] {
    return categories
      .filter((c) => c.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }

  function move(id: number, direction: -1 | 1) {
    const category = categories.find((c) => c.id === id);
    if (!category) return;
    const siblings = siblingsOf(category.parent_id);
    const at = siblings.findIndex((c) => c.id === id);
    const swapWith = siblings[at + direction];
    if (!swapWith) return;
    const next = categories.map((c) => {
      if (c.id === category.id) return { ...c, sort_order: swapWith.sort_order };
      if (c.id === swapWith.id) return { ...c, sort_order: category.sort_order };
      return c;
    });
    persist(next);
  }

  /** Indent: become a child of the previous sibling. */
  function indent(id: number) {
    const category = categories.find((c) => c.id === id);
    if (!category) return;
    const siblings = siblingsOf(category.parent_id);
    const at = siblings.findIndex((c) => c.id === id);
    const newParent = siblings[at - 1];
    if (!newParent) return;
    const lastOrder = siblingsOf(newParent.id).length;
    persist(
      categories.map((c) =>
        c.id === id ? { ...c, parent_id: newParent.id, sort_order: lastOrder } : c,
      ),
    );
  }

  /** Outdent: become a sibling of the current parent. */
  function outdent(id: number) {
    const category = categories.find((c) => c.id === id);
    if (!category || category.parent_id === null) return;
    const parent = categories.find((c) => c.id === category.parent_id);
    if (!parent) return;
    persist(
      categories.map((c) =>
        c.id === id
          ? { ...c, parent_id: parent.parent_id, sort_order: parent.sort_order + 0.5 }
          : c,
      ),
    );
  }

  function handleDrop(targetId: number, asChild: boolean) {
    const sourceId = dragId.current;
    dragId.current = null;
    if (!sourceId || sourceId === targetId) return;
    if (descendantsOf(categories, sourceId).has(targetId)) {
      setNotice({ ok: false, text: "بىر تۈرنى ئۆز تارمىقىنىڭ ئاستىغا يۆتكىگىلى بولمايدۇ." });
      return;
    }
    const target = categories.find((c) => c.id === targetId);
    if (!target) return;
    if (asChild) {
      const lastOrder = siblingsOf(targetId).length;
      persist(
        categories.map((c) =>
          c.id === sourceId ? { ...c, parent_id: targetId, sort_order: lastOrder } : c,
        ),
      );
    } else {
      persist(
        categories.map((c) =>
          c.id === sourceId
            ? { ...c, parent_id: target.parent_id, sort_order: target.sort_order + 0.5 }
            : c,
        ),
      );
    }
  }

  function runForm(action: (fd: FormData) => Promise<{ ok: boolean; error?: string; message?: string }>, formData: FormData, after?: () => void) {
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        setNotice({ ok: true, text: result.message ?? "ساقلاندى." });
        after?.();
        // Server revalidation refreshes `initial`; mirror it locally too.
        window.location.reload();
      } else {
        setNotice({ ok: false, text: result.error ?? "مەشغۇلات مەغلۇپ بولدى." });
      }
    });
  }

  return (
    <div>
      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          data-testid="category-notice"
          className={`mb-4 rounded-[var(--radius)] px-3.5 py-3 text-[13px] leading-6 ${
            notice.ok ? "bg-ab text-ink" : "border border-bd2 bg-ab2 text-ink"
          }`}
        >
          {notice.text}
        </p>
      )}

      <AddCategoryForm categories={categories} pending={pending} onSubmit={(fd) => runForm(createCategoryAction, fd)} />

      <ul className="mt-5 space-y-1.5" data-testid="category-list">
        {flat.map((node) => {
          const siblings = siblingsOf(node.category.parent_id);
          const at = siblings.findIndex((c) => c.id === node.category.id);
          const isEditing = editingId === node.category.id;
          return (
            <li
              key={node.category.id}
              data-testid="category-row"
              data-category-id={node.category.id}
              style={{ marginInlineStart: `${node.depth * 20}px` }}
              draggable={!isEditing}
              onDragStart={() => {
                dragId.current = node.category.id;
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                handleDrop(node.category.id, event.shiftKey);
              }}
              className="paper flex flex-wrap items-center gap-2 p-2.5"
            >
              {isEditing ? (
                <EditCategoryForm
                  category={node.category}
                  pending={pending}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(fd) => runForm(updateCategoryAction, fd, () => setEditingId(null))}
                />
              ) : (
                <>
                  <Icon name={(node.category.icon || "folder") as IconName} className="text-am" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                    {node.category.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="ibtn"
                      title="ئۈستىگە"
                      aria-label={`${node.category.name} — ئۈستىگە يۆتكەش`}
                      data-testid="category-up"
                      disabled={pending || at <= 0}
                      onClick={() => move(node.category.id, -1)}
                    >
                      <Icon name="undo" />
                    </button>
                    <button
                      type="button"
                      className="ibtn"
                      title="ئاستىغا"
                      aria-label={`${node.category.name} — ئاستىغا يۆتكەش`}
                      data-testid="category-down"
                      disabled={pending || at < 0 || at >= siblings.length - 1}
                      onClick={() => move(node.category.id, 1)}
                    >
                      <Icon name="redo" />
                    </button>
                    <button
                      type="button"
                      className="ibtn"
                      title="تارماق تۈر قىلىش"
                      aria-label={`${node.category.name} — تارماق تۈر قىلىش`}
                      data-testid="category-indent"
                      disabled={pending || at <= 0}
                      onClick={() => indent(node.category.id)}
                    >
                      <Icon name="align-right" />
                    </button>
                    <button
                      type="button"
                      className="ibtn"
                      title="يۇقىرى دەرىجىگە"
                      aria-label={`${node.category.name} — يۇقىرى دەرىجىگە چىقىرىش`}
                      data-testid="category-outdent"
                      disabled={pending || node.category.parent_id === null}
                      onClick={() => outdent(node.category.id)}
                    >
                      <Icon name="align-left" />
                    </button>
                    <button
                      type="button"
                      className="ibtn"
                      title="تەھرىرلەش"
                      aria-label={`${node.category.name} — تەھرىرلەش`}
                      onClick={() => setEditingId(node.category.id)}
                    >
                      <Icon name="pencil" />
                    </button>
                    <form
                      action={(fd) => {
                        if (!window.confirm(`«${node.category.name}» ئۆچۈرۈلسۇنمۇ؟`)) return;
                        runForm(deleteCategoryAction, fd);
                      }}
                    >
                      <input type="hidden" name="id" value={node.category.id} />
                      <button
                        type="submit"
                        className="ibtn"
                        title="ئۆچۈرۈش"
                        aria-label={`${node.category.name} — ئۆچۈرۈش`}
                        disabled={pending}
                      >
                        <Icon name="trash" />
                      </button>
                    </form>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {flat.length === 0 && (
        <p className="paper mt-5 p-5 text-center text-[13.5px] text-ink2">
          تۈر تېخى يوق. يۇقىرىدىكى رامكىدىن بىرىنچى تۈرنى قوشۇڭ.
        </p>
      )}

      <p className="mt-4 text-[12.5px] leading-6 text-ink3">
        تەرتىپنى ئۆزگەرتىش ئۈچۈن كۇنۇپكىلارنى ئىشلىتىڭ، ياكى كومپيۇتېردا تۈرنى سۆرەپ
        يۆتكەڭ (Shift بېسىپ تاشلىسىڭىز تارماق تۈر بولىدۇ).
      </p>
    </div>
  );
}

function IconPicker({ name, defaultValue }: { name: string; defaultValue: string }) {
  return (
    <select className="field w-auto" name={name} defaultValue={defaultValue} aria-label="سىنبەلگە">
      {CATEGORY_ICONS.map((icon) => (
        <option key={icon} value={icon}>
          {icon}
        </option>
      ))}
    </select>
  );
}

function AddCategoryForm({
  categories,
  pending,
  onSubmit,
}: {
  categories: Category[];
  pending: boolean;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <form action={onSubmit} className="paper grain flex flex-wrap items-end gap-3 p-4">
      <label className="min-w-40 flex-1">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink2">يېڭى تۈر ئىسمى</span>
        <input className="field" name="name" required maxLength={80} placeholder="مەسىلەن: تارىخ" />
      </label>
      <label>
        <span className="mb-1.5 block text-[13px] font-semibold text-ink2">سىنبەلگە</span>
        <IconPicker name="icon" defaultValue="folder" />
      </label>
      <label>
        <span className="mb-1.5 block text-[13px] font-semibold text-ink2">ئاتا تۈر</span>
        <select className="field w-auto" name="parent_id" defaultValue="">
          <option value="">— يوق (باش تۈر) —</option>
          {flatten(categories).map((node) => (
            <option key={node.category.id} value={node.category.id}>
              {"— ".repeat(node.depth)}
              {node.category.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn-am" disabled={pending} data-testid="category-add">
        <Icon name="plus" />
        قوشۇش
      </button>
    </form>
  );
}

function EditCategoryForm({
  category,
  pending,
  onCancel,
  onSubmit,
}: {
  category: Category;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <form action={onSubmit} className="flex w-full flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={category.id} />
      <input
        className="field min-w-40 flex-1"
        name="name"
        defaultValue={category.name}
        required
        maxLength={80}
        aria-label="تۈر ئىسمى"
      />
      <IconPicker name="icon" defaultValue={category.icon || "folder"} />
      <button type="submit" className="btn-am" disabled={pending}>
        <Icon name="save" />
        ساقلاش
      </button>
      <button type="button" className="hbtn" onClick={onCancel} disabled={pending}>
        بىكار قىلىش
      </button>
    </form>
  );
}
