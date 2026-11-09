import { useState } from "react";
import { BadgeCheck, CircleAlert } from "lucide-react";
import { formatMoney } from "@shared/money";
import { available, isSound } from "@shared/rewards";
import type { LedgerEntry } from "@shared/types";
import { PoolMeter } from "@/components/deals";
import { useCatalog, useLedger } from "@/lib/api";
import { useReveal } from "@/lib/motion";
import { useAuth } from "@/lib/auth";

const KIND: Record<LedgerEntry["kind"], string> = { deposit: "Funded", reserve: "Reserved", payout: "Paid out", release: "Returned" };
const SOURCES = [
  { name: "Sponsor pools", status: "Live in the demo", body: "A sponsor deposits money into a public pot for a campaign. Rewards are paid only from that pot, up to a cap per person." },
  { name: "Affiliate commissions", status: "Not live", body: "Some merchants pay a commission on sales we send them. If a merchant agrees, a share could fund rewards. Until then, no deal claims it." },
  { name: "Referral pot", status: "Live in the demo", body: "A capped promo pot, shown in the open, pays a small reward when a friend takes their first deal." },
];

export default function FundingPage() {
  const { currency } = useAuth();
  const cat = useCatalog();
  const ledger = useLedger();
  const [kind, setKind] = useState<LedgerEntry["kind"] | "all">("all");
  const ref = useReveal<HTMLDivElement>();
  const platform = ledger.data?.platform ?? null;
  const rows = (ledger.data?.ledger ?? []).filter((l) => kind === "all" || l.kind === kind).sort((a, b) => +new Date(b.at) - +new Date(a.at));

  return (
    <div ref={ref} className="wrap pt-4 md:pt-10">
      <div className="vault vault-blue p-7 md:p-12">
        <div className="relative">
          <p className="eyebrow">Funding · the public books</p>
          <h1 className="display display-xl !text-[clamp(40px,9vw,92px)] mt-3">
            Where the money <span className="serif text-[var(--marigold)]">comes from.</span>
          </h1>
          <p className="mt-5 max-w-[54ch] text-[19px] text-[var(--vault-ink)]">
            A cashback app is only honest if the rewards are paid for. Here is every pot, how full it is, and every movement of money in and out. The rule: <strong>what is promised plus what is paid never exceeds what was deposited.</strong>
          </p>
        </div>

        <section aria-labelledby="sources" className="relative mt-14">
          <h2 id="sources" className="display display-md">
            Three possible sources
          </h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {SOURCES.map((s) => (
              <li key={s.name} data-reveal className="rounded-[24px] border border-[rgb(246_234_215/0.2)] p-6">
                <p className="display display-sm">{s.name}</p>
                <p className={`tag mt-3 ${s.status === "Not live" ? "tag-low" : "tag-ok"}`}>{s.status}</p>
                <p className="muted mt-3 text-[15.5px]">{s.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="pools" className="relative mt-16">
          <h2 id="pools" className="display display-md">
            The pots
          </h2>
          <ul className="mt-6 grid gap-5 lg:grid-cols-2">
            {cat.data?.pools.map((p) => {
              const sponsor = cat.data!.sponsors.find((s) => s.id === p.sponsorId);
              const ok = isSound(p);
              return (
                <li key={p.id} data-reveal className="rounded-[24px] border border-[rgb(246_234_215/0.2)] p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="display display-sm">{sponsor?.name}</p>
                      <p className="muted text-[15px]">{formatMoney(available(p), currency)} free to promise</p>
                    </div>
                    <span className={`tag ${ok ? "tag-ok" : "tag-off"}`}>
                      {ok ? <BadgeCheck aria-hidden="true" size={15} /> : <CircleAlert aria-hidden="true" size={15} />} {ok ? "Books balance" : "Check this pot"}
                    </span>
                  </div>
                  <div className="mt-5">
                    <PoolMeter pool={p} currency={currency} />
                  </div>
                </li>
              );
            })}
            {platform && (
              <li data-reveal className="rounded-[24px] border border-[rgb(246_234_215/0.2)] p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="display display-sm">Referral pot</p>
                    <p className="muted text-[15px]">{formatMoney(available(platform), currency)} free to promise</p>
                  </div>
                  <span className={`tag ${isSound(platform) ? "tag-ok" : "tag-off"}`}>{isSound(platform) ? "Books balance" : "Check this pot"}</span>
                </div>
                <div className="mt-5">
                  <PoolMeter pool={platform} currency={currency} />
                </div>
              </li>
            )}
          </ul>
          <p className="muted mt-4 text-[14.5px]">Solid bar: paid out. Striped: reserved while a purchase is checked. Green: still free to promise.</p>
        </section>

        <section aria-labelledby="ledger" className="relative mt-16">
          <h2 id="ledger" className="display display-md">
            The ledger
          </h2>
          <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Filter the ledger">
            {(["all", "deposit", "reserve", "payout", "release"] as const).map((k) => (
              <button key={k} type="button" className="chip !border-[rgb(246_234_215/0.4)] !text-[var(--vault-ink)] aria-pressed:!bg-[var(--vault-ink)] aria-pressed:!text-[var(--vault)]" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === "all" ? "Everything" : KIND[k]}
              </button>
            ))}
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-[15px]">
              <caption className="sr-only">Every movement of money in the sponsor pots, newest first</caption>
              <thead>
                <tr className="eyebrow border-b border-[rgb(246_234_215/0.25)]">
                  <th className="py-3 pr-4 font-normal">When</th>
                  <th className="py-3 pr-4 font-normal">What</th>
                  <th className="py-3 pr-4 font-normal">Pot</th>
                  <th className="py-3 text-right font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className="border-b border-[rgb(246_234_215/0.12)]">
                    <td className="num py-3.5 pr-4 font-mono text-[13.5px] text-[var(--vault-muted)]">{new Date(l.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                    <td className="py-3.5 pr-4">
                      <span className="font-semibold">{KIND[l.kind]}</span> <span className="muted">· {l.note}</span>
                    </td>
                    <td className="py-3.5 pr-4 text-[var(--vault-muted)]">{l.poolId === platform?.id ? "Referral pot" : cat.data?.sponsors.find((s) => s.id === cat.data!.pools.find((p) => p.id === l.poolId)?.sponsorId)?.name}</td>
                    <td className="num py-3.5 text-right font-mono">{formatMoney(l.amount, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ledger.data && rows.length === 0 && <p className="muted py-6">Nothing here yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
