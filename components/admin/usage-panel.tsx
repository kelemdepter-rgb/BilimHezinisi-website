import { Icon } from "@/components/icons";
import { FREE_DB_BYTES, FREE_STORAGE_BYTES, type UsageLevel, type UsageReport } from "@/lib/usage";

const LEVEL_STYLES: Record<UsageLevel, string> = {
  normal: "bg-ab text-ink",
  warning: "border border-bd2 bg-ab2 text-ink",
  critical: "border border-am bg-ab2 text-ink",
};

const DB_ADVICE: Record<UsageLevel, string> = {
  normal: "بوشلۇق يېتەرلىك — ئەندىشە قىلمىسىڭىزمۇ بولىدۇ.",
  warning: "بوشلۇق 70% تىن ئاشتى. يېڭى كىتاب قوشۇشتىن بۇرۇن كېرەكسىز كىتابلارنى ئۆچۈرۈڭ ياكى زاپاسلاپ قويۇڭ.",
  critical: "بوشلۇق 85% تىن ئاشتى! دەرھال زاپاسلاڭ ھەمدە كېرەكسىز كىتابلارنى ئۆچۈرۈڭ، بولمىسا يېڭى كىتاب قوشقىلى بولمايدۇ.",
};

const STORAGE_ADVICE: Record<UsageLevel, string> = {
  normal: "مۇقاۋا ۋە ھۆججەت بوشلۇقى يېتەرلىك.",
  warning: "ساقلاش بوشلۇقى 70% تىن ئاشتى. «ئەسلى ھۆججەتنى ساقلاش» نى ئېتىپ قويۇڭ.",
  critical: "ساقلاش بوشلۇقى 85% تىن ئاشتى! ئەسلى ھۆججەتلەرنى ئۆچۈرۈڭ.",
};

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function Gauge({ used, limit, level, label }: { used: number; limit: number; level: UsageLevel; label: string }) {
  const percent = Math.min(100, (used / limit) * 100);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink2">{label}</span>
        <span className="text-[13px] font-bold">
          {mb(used)} / {mb(limit)} ({percent.toFixed(1)}%)
        </span>
      </div>
      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-bg3">
        <div
          className={level === "normal" ? "h-full bg-am" : "h-full bg-[var(--gold)]"}
          style={{ width: `${Math.max(1, percent)}%` }}
        />
      </div>
    </div>
  );
}

/** Free-tier gauge for the admin dashboard. Server-rendered, admin only. */
export function UsagePanel({ report }: { report: UsageReport }) {
  if (!report.available) {
    return (
      <div className="paper mt-5 p-5" data-testid="usage-panel">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <Icon name="chart" className="text-am" />
          بوشلۇق ئەھۋالى
        </h2>
        <p className="mt-2 text-[13px] leading-7 text-ink2">
          ئۆلچەش ئىقتىدارى تېخى قوزغىتىلمىغان. <code>0005_usage_stats.sql</code> نى
          Supabase دا ئىجرا قىلسىڭىز، بۇ يەردە بوشلۇق ئۇچۇرى كۆرۈنىدۇ.
        </p>
      </div>
    );
  }

  return (
    <section className="paper grain mt-5 p-5" data-testid="usage-panel">
      <h2 className="flex items-center gap-2 text-[15px] font-bold">
        <Icon name="chart" className="text-am" />
        ھەقسىز بوشلۇق ئەھۋالى
      </h2>

      <div className="mt-4 space-y-4">
        <Gauge used={report.dbBytes} limit={FREE_DB_BYTES} level={report.dbLevel} label="ساندان" />
        <p className={`rounded-[var(--radius)] px-3.5 py-2.5 text-[12.5px] leading-6 ${LEVEL_STYLES[report.dbLevel]}`}>
          {DB_ADVICE[report.dbLevel]}
        </p>

        <Gauge
          used={report.storageBytes}
          limit={FREE_STORAGE_BYTES}
          level={report.storageLevel}
          label="ساقلاش (مۇقاۋا، ھۆججەت)"
        />
        <p className={`rounded-[var(--radius)] px-3.5 py-2.5 text-[12.5px] leading-6 ${LEVEL_STYLES[report.storageLevel]}`}>
          {STORAGE_ADVICE[report.storageLevel]}
        </p>
      </div>

      <dl className="mt-4 grid gap-2 text-[13px] sm:grid-cols-2">
        <Fact label="كىتاب سانى" value={String(report.books)} />
        <Fact label="بەت سانى" value={String(report.pages)} />
        <Fact
          label="ھەر كىتابقا"
          value={report.bytesPerBook > 0 ? `${(report.bytesPerBook / 1024).toFixed(0)} KB` : "—"}
        />
        <Fact
          label="يەنە سىغىدىغىنى"
          value={report.bytesPerBook > 0 ? `≈ ${report.remainingBooks} كىتاب` : "—"}
        />
      </dl>

      <p className="mt-4 text-[12.5px] leading-6 text-ink3" data-testid="last-ping">
        {report.lastPing
          ? `ئاخىرقى ئاۋتوماتىك تەكشۈرۈش: ${report.lastPing.slice(0, 16).replace("T", " ")} (UTC) — سايت ئۇخلاپ قالمايدۇ.`
          : "ئاۋتوماتىك تەكشۈرۈش تېخى ئىشلىمىدى. Vercel دا CRON_SECRET نى تەڭشەڭ."}
      </p>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 rounded-[var(--radius)] bg-bg2 px-3 py-2">
      <dt className="text-ink3">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}
