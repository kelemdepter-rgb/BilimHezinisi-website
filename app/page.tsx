import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { getSessionInfo } from "@/lib/data";

export default async function HomePage() {
  const session = await getSessionInfo();

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      <section className="paper grain relative overflow-hidden p-6 sm:p-10">
        <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--gold),var(--am),var(--gold))]" />
        <p className="flex items-center gap-2 text-[13px] font-semibold text-am">
          <Icon name="sparkles" />
          ئۇيغۇرچە رەقەملىك كۇتۇپخانا
        </p>
        <h1 className="mt-2 text-2xl font-bold leading-relaxed sm:text-3xl">
          بىلىم خەزىنىسىگە خۇش كەپسىز
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-8 text-ink2">
          «بىلىم خەزىنىسى» — ئۇيغۇرچە ئېلكىتابلارنى بىر يەرگە توپلاپ، ئوقۇش، ئىزدەش ۋە
          ساقلاشقا قولايلىق يارىتىدىغان ئوچۇق كۇتۇپخانا. ھېسابات ئاچمىسىڭىزمۇ بارلىق
          ئېلان قىلىنغان كىتابلارنى ئەركىن كۆرەلەيسىز ۋە ئوقۇيالايسىز.
        </p>
        {!session && (
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/register" className="btn-am">
              <Icon name="user" />
              تىزىمدىن ئۆتۈش
            </Link>
            <Link href="/login" className="hbtn">
              <Icon name="log-in" />
              كىرىش
            </Link>
          </div>
        )}
      </section>

      <section className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="ئاساسلىق ئىقتىدارلار">
        <FeatureCard
          icon="book-open"
          title="ئەركىن ئوقۇش"
          text="بارلىق ئېلان قىلىنغان كىتابلارنى ھېساباتسىزلا ئوقۇيالايسىز؛ كۈندۈز، سېپىيا ۋە كېچە تۈسلىرىنى خالىغانچە ئالماشتۇرالايسىز."
        />
        <FeatureCard
          icon="search"
          title="تولۇق تېكىستلىك ئىزدەش"
          text="كىتاب ماۋزۇسى، ئاپتورى ۋە پۈتۈن مەزمۇنىدىن تېز ئىزدەپ، تېپىلغان جۈملىگە بىۋاسىتە يېتىپ بارالايسىز."
        />
        <FeatureCard
          icon="bookmark"
          title="خەتكۈچ ۋە خاتىرە"
          text="ھەقسىز ھېسابات ئاچسىڭىز خەتكۈچ قويۇش، خاتىرە يېزىش ۋە ئوقۇش ئىزىڭىزنى ساقلاپ مېڭىش ئىقتىدارلىرى قوشۇلىدۇ."
        />
      </section>

      <section className="paper mt-5 p-6 text-center sm:p-8">
        <Icon name="book" className="ic-lg mx-auto text-am" />
        <h2 className="mt-3 text-lg font-bold">كۇتۇپخانا تەييارلىنىۋاتىدۇ</h2>
        <p className="mx-auto mt-2 max-w-xl text-[14px] leading-7 text-ink2">
          كىتابلار پات يېقىندا قوشۇلىدۇ. تۈرلەر ۋە كىتابلار قوشۇلغاندىن كېيىن باش بەتتە
          كىتاب كاتەكچىلىرى، يېقىندا ئوقۇلغانلار ۋە تۈر بويىچە تىزىملىك كۆرۈنىدۇ.
        </p>
      </section>
    </div>
  );
}

function FeatureCard({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <article className="paper grain p-5">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius)] bg-ab text-am">
        <Icon name={icon} className="ic-lg" />
      </span>
      <h2 className="mt-3 text-[16px] font-bold">{title}</h2>
      <p className="mt-2 text-[13.5px] leading-7 text-ink2">{text}</p>
    </article>
  );
}
