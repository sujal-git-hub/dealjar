import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { rewardState } from "@shared/rewards";
import type { DealCategory } from "@shared/types";
import { DealCard } from "@/components/deals";
import { PageBand } from "@/components/ui";
import { useCatalog } from "@/lib/api";
import { useReveal } from "@/lib/motion";
import { useAuth } from "@/lib/auth";

const CATEGORIES: DealCategory[] = ["Airtime & data", "Groceries", "Food", "Travel", "Learning"];

export default function DealsPage() {
  const { currency } = useAuth();
  const cat = useCatalog();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<DealCategory | "all">("all");
  const [funded, setFunded] = useState(false);
  const ref = useReveal<HTMLDivElement>();

  const { active, ended } = useMemo(() => {
    const d = cat.data;
    if (!d) return { active: [], ended: [] };
    const rows = d.deals
      .map((deal) => ({ deal, pool: d.pools.find((p) => p.id === deal.poolId)!, sponsor: d.sponsors.find((s) => s.id === deal.sponsorId) }))
      .filter(({ deal, sponsor }) => (category === "all" || deal.category === category) && `${deal.title} ${deal.summary} ${sponsor?.name ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
    const state = (r: (typeof rows)[number]) => rewardState(r.deal, r.pool);
    const rank = { funded: 0, low: 1, empty: 2, expired: 3 } as const;
    const sorted = [...rows].sort((a, b) => rank[state(a)] - rank[state(b)]);
    return {
      active: sorted.filter((r) => state(r) !== "expired" && (!funded || state(r) === "funded" || state(r) === "low")),
      ended: sorted.filter((r) => state(r) === "expired"),
    };
  }, [cat.data, q, category, funded]);

  return (
    <div ref={ref}>
      <PageBand eyebrow="Deals" title={<>Today's <span className="serif">deals</span></>}>
        <p className="lede mt-5">Each deal shows how much cashback is actually left, before you spend anything.</p>
      </PageBand>
      <div className="wrap">

      <div className="mt-8 grid gap-4">
        <label className="relative block">
          <span className="sr-only">Search deals</span>
          <Search aria-hidden="true" size={20} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input className="field !pl-14" type="search" placeholder="Search deals or sponsors" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter deals">
          <button type="button" className="chip" aria-pressed={category === "all"} onClick={() => setCategory("all")}>
            All
          </button>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
          <button type="button" className="chip" aria-pressed={funded} onClick={() => setFunded((v) => !v)}>
            Cashback available
          </button>
        </div>
      </div>

      <div className="mt-10" aria-live="polite">
        {cat.isLoading && <p className="muted">Loading deals…</p>}
        {cat.isError && <p role="alert" className="text-[var(--danger)]">Couldn't load deals. Try again in a moment.</p>}
        {cat.data && active.length === 0 && ended.length === 0 && <p className="muted">No deals match. Try clearing the filters.</p>}
        <div className="rail !overflow-visible md:!grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", margin: 0, padding: 0 }}>
          {active.map(({ deal, pool, sponsor }, i) => (
            <div key={deal.id} data-reveal style={{ ["--d" as string]: i % 4, width: "auto" }}>
              <DealCard deal={deal} pool={pool} sponsor={sponsor} currency={currency} />
            </div>
          ))}
        </div>
        {ended.length > 0 && (
          <>
            <h2 className="display display-md mt-16">Ended</h2>
            <div className="mt-5 opacity-70" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
              {ended.map(({ deal, pool, sponsor }) => (
                <DealCard key={deal.id} deal={deal} pool={pool} sponsor={sponsor} currency={currency} />
              ))}
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
