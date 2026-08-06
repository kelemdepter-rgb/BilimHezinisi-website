"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { changeRoleAction } from "@/app/admin/users/actions";
import type { Role } from "@/lib/types";

export type UserRow = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
};

const ROLE_LABELS: Record<Role, string> = {
  admin: "باش باشقۇرغۇچى",
  uploader: "كىتاب يوللىغۇچى",
  reader: "ئوقۇرمەن",
};

export function UserTable({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function changeRole(userId: string, role: Role) {
    const formData = new FormData();
    formData.set("user_id", userId);
    formData.set("role", role);
    startTransition(async () => {
      const result = await changeRoleAction(formData);
      setNotice(
        result.ok
          ? { ok: true, text: result.message ?? "ساقلاندى." }
          : { ok: false, text: result.error ?? "مەشغۇلات مەغلۇپ بولدى." },
      );
      router.refresh();
    });
  }

  return (
    <div>
      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          data-testid="user-notice"
          className={`mb-4 rounded-[var(--radius)] px-3.5 py-3 text-[13px] leading-6 ${
            notice.ok ? "bg-ab text-ink" : "border border-bd2 bg-ab2 text-ink"
          }`}
        >
          {notice.text}
        </p>
      )}

      <ul className="space-y-2" data-testid="user-list">
        {users.map((user) => {
          const isSelf = user.id === currentUserId;
          return (
            <li key={user.id} className="paper flex flex-wrap items-center gap-3 p-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ab text-am">
                <Icon name="user" />
              </span>
              <div className="min-w-40 flex-1">
                <p className="truncate text-[14px] font-bold">
                  {user.displayName || "(ئىسىم يوق)"}
                  {isSelf && <span className="ms-2 text-[12px] font-normal text-ink3">(سىز)</span>}
                </p>
                <p className="mt-0.5 truncate text-[12.5px] text-ink3" dir="ltr">
                  {user.email}
                </p>
              </div>
              <span className="text-[12px] text-ink3">{user.createdAt}</span>
              <label className="flex items-center gap-2">
                <span className="sr-only">{user.email} — سالاھىيەت</span>
                <select
                  className="field w-auto"
                  value={user.role}
                  disabled={pending || isSelf}
                  data-testid="role-select"
                  onChange={(event) => changeRole(user.id, event.target.value as Role)}
                >
                  {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          );
        })}
      </ul>

      {users.length === 0 && (
        <p className="paper p-6 text-center text-[13.5px] text-ink2">ئەزا تېپىلمىدى.</p>
      )}

      <p className="mt-4 text-[12.5px] leading-6 text-ink3">
        ئۆز سالاھىيىتىڭىزنى ئۆزىڭىز ئۆزگەرتەلمەيسىز، ھەمدە ئاخىرقى باشقۇرغۇچىنى چۈشۈرگىلى
        بولمايدۇ — سايت باشقۇرغۇچىسىز قېلىپ قالماسلىقى ئۈچۈن.
      </p>
    </div>
  );
}
