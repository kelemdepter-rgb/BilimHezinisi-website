"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import {
  deleteHandledRequestsAction,
  deleteRequestAction,
  setRequestHandledAction,
} from "@/app/admin/requests/actions";
import type { BookRequest } from "@/lib/requests";

/**
 * The admin's inbox.
 *
 * Nothing here is ever shown anywhere else on the site, so it is the only
 * place a reader's words and their address are visible at all — and deleting
 * what has been dealt with is the only thing that keeps the table small.
 */
export function RequestInbox({ requests }: { requests: BookRequest[] }) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const handled = requests.filter((request) => request.handled).length;

  function run(action: () => Promise<{ ok: boolean; message?: string }>, done: string) {
    startTransition(async () => {
      const result = await action();
      setNotice(
        result.ok
          ? { ok: true, text: done }
          : { ok: false, text: result.message ?? "مەشغۇلات مەغلۇپ بولدى." },
      );
      router.refresh();
    });
  }

  function toggle(request: BookRequest) {
    const formData = new FormData();
    formData.set("id", String(request.id));
    formData.set("handled", String(!request.handled));
    run(
      () => setRequestHandledAction(formData),
      request.handled ? "بېجىرىلمىگەنگە قايتۇرۇلدى." : "بېجىرىلدى دەپ بەلگە قويۇلدى.",
    );
  }

  function remove(request: BookRequest) {
    const formData = new FormData();
    formData.set("id", String(request.id));
    run(() => deleteRequestAction(formData), "تەلەپ ئۆچۈرۈلدى.");
  }

  if (requests.length === 0) {
    return (
      <div className="paper grain p-8 text-center" data-testid="requests-empty">
        <Icon name="mail" className="ic-lg mx-auto text-ink3" />
        <p className="mt-3 text-[13.5px] leading-7 text-ink2">تېخى كىتاب تەلىپى كەلمىدى.</p>
      </div>
    );
  }

  return (
    <div>
      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          data-testid="request-notice"
          className={`mb-4 rounded-[var(--radius)] px-3.5 py-3 text-[13px] leading-6 ${
            notice.ok ? "bg-ab text-ink" : "border border-bd2 bg-ab2 text-ink"
          }`}
        >
          {notice.text}
        </p>
      )}

      {handled > 0 && (
        <button
          type="button"
          className="hbtn mb-4"
          data-testid="delete-handled"
          disabled={pending}
          onClick={() =>
            run(() => deleteHandledRequestsAction(), "بېجىرىلگەن تەلەپلەر ئۆچۈرۈلدى.")
          }
        >
          <Icon name="trash" />
          بېجىرىلگەن {handled} تەلەپنى ئۆچۈرۈش
        </button>
      )}

      <ul className="space-y-2.5" data-testid="request-list">
        {requests.map((request) => (
          <li
            key={request.id}
            data-testid="request-row"
            data-handled={request.handled ? "true" : "false"}
            className={`paper grain p-4 ${request.handled ? "opacity-65" : ""}`}
          >
            <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
              <h2 className="min-w-0 flex-1 break-words text-[15px] font-bold text-ink">
                {request.title}
              </h2>
              <span className="shrink-0 text-[12px] text-ink3" dir="ltr">
                {request.created_at.slice(0, 10)}
              </span>
            </div>

            {request.author && (
              <p className="mt-1 break-words text-[13px] text-ink2">{request.author}</p>
            )}
            {request.note && (
              <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-7 text-ink2">
                {request.note}
              </p>
            )}
            {request.contact && (
              <p className="mt-2 break-all text-[12.5px] text-ink3">
                <Icon name="mail" className="text-am" />{" "}
                <a href={`mailto:${request.contact}`} className="text-am hover:underline" dir="ltr">
                  {request.contact}
                </a>
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={request.handled ? "hbtn" : "hbtn on"}
                data-testid="toggle-handled"
                disabled={pending}
                onClick={() => toggle(request)}
              >
                <Icon name={request.handled ? "undo" : "check"} />
                {request.handled ? "قايتا ئېچىش" : "بېجىرىلدى"}
              </button>
              <button
                type="button"
                className="hbtn"
                data-testid="delete-request"
                disabled={pending}
                onClick={() => remove(request)}
              >
                <Icon name="trash" />
                ئۆچۈرۈش
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
