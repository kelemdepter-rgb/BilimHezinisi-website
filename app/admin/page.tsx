import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import { getAdminCounts, getSessionInfo } from "@/lib/data";
import type { Role } from "@/lib/types";

const ROLE_LABELS: Record<Role, string> = {
  admin: "باش باشقۇرغۇچى",
  uploader: "كىتاب يوللىغۇچى",
  reader: "ئوقۇرمەن",
};

export default async function AdminDashboardPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");

  const counts = await getAdminCounts();

  return (
    <>
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="settings" className="ic-lg text-am" />
        باشقۇرۇش سۇپىسى
      </h1>
      <p className="mt-1.5 text-[13.5px] text-ink3">
        خۇش كەپسىز، {session.displayName || session.email}
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon="user" label="سالاھىيىتىڭىز" value={ROLE_LABELS[session.role]} />
        <StatCard icon="book" label="كىتابلار" value={String(counts.books)} />
        <StatCard icon="layers" label="تۈرلەر" value={String(counts.categories)} />
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/admin/books/new" className="btn-am">
          <Icon name="plus" />
          يېڭى كىتاب قوشۇش
        </Link>
        <Link href="/admin/books" className="hbtn">
          <Icon name="book" />
          كىتابلارنى باشقۇرۇش
        </Link>
        <Link href="/admin/categories" className="hbtn">
          <Icon name="layers" />
          تۈرلەرنى باشقۇرۇش
        </Link>
      </div>
    </>
  );
}

function StatCard({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="paper grain p-5">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius)] bg-ab text-am">
        <Icon name={icon} className="ic-lg" />
      </span>
      <p className="mt-3 text-[13px] font-semibold text-ink3">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink">{value}</p>
    </div>
  );
}
