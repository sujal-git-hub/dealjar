import { Link } from "react-router";
import { Check, Clock, CircleSlash, TriangleAlert } from "lucide-react";
import { formatMoney } from "@shared/money";
import { available, rewardOffer, rewardState, type RewardState } from "@shared/rewards";
import type { Currency, Deal, Pool, Sponsor } from "@shared/types";

/** The state of a pool or reward as words and a shape, never only a colour. */
export function StateTag({ state, offer, currency }: { state: RewardState; offer: number; currency: Currency }) {
  if (state === "funded") {
    return (
      <span className="tag tag-ok">
        <Check aria-hidden="true" size={15} /> Earn {formatMoney(offer, currency)} back
      </span>
    );
  }
  if (state === "low") {
    return (
      <span className="tag tag-low">
        <TriangleAlert aria-hidden="true" size={15} /> {offer > 0 ? `Earn ${formatMoney(offer, currency)} · nearly out` : "Pool nearly empty"}
      </span>
    );
  }
  if (state === "expired") {
    return (
      <span className="tag tag-off">
        <Clock aria-hidden="true" size={15} /> Deal ended
      </span>
    );
  }
  return (
    <span className="tag tag-off">
      <CircleSlash aria-hidden="true" size={15} /> No cashback left
    </span>
  );
}

export const daysLeft = (iso: string, now = Date.now()): number => Math.ceil((new Date(iso).getTime() - now) / 86_400_000);

export function DealCard({ deal, pool, sponsor, currency, earned = 0 }: { deal: Deal; pool: Pool; sponsor?: Sponsor; currency: Currency; earned?: number }) {
  const state = rewardState(deal, pool);
  const offer = rewardOffer(deal, pool, earned);
  const left = daysLeft(deal.expiresAt);
  return (
    <Link to={`/deals/${deal.id}`} className="lift card block overflow-hidden" aria-label={`${deal.title}, ${sponsor?.name ?? ""}`}>
      <div className="relative h-36 overflow-hidden" style={{ background: `linear-gradient(135deg, oklch(0.88 0.13 ${deal.hue}), oklch(0.74 0.17 ${(deal.hue + 40) % 360}))` }}>
        {deal.bannerKey ? (
          <>
            <img src={`/api/img/${deal.bannerKey}`} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
            <span className="tag absolute bottom-3 left-3 bg-white/90 text-[var(--ink)]">{Math.round(deal.rewardRate * 100)}% back</span>
          </>
        ) : (
          <span className="display absolute -bottom-5 -left-1 select-none text-[120px] leading-none text-white/35" aria-hidden="true">
            {Math.round(deal.rewardRate * 100)}%
          </span>
        )}
        <span className="tag absolute right-3 top-3 bg-white/90 text-[var(--ink)]">{deal.category}</span>
        {deal.community && <span className="tag absolute left-3 top-3 bg-[var(--ink)] text-[var(--paper)]">Community</span>}
      </div>
      <div className="p-5">
        <p className="eyebrow">{sponsor?.name}</p>
        <h3 className="display display-sm mt-1.5 min-h-[48px]">{deal.title}</h3>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StateTag state={state} offer={offer} currency={currency} />
        </div>
        <div className="mt-4 flex items-baseline justify-between border-t border-[var(--line)] pt-4 text-[15px]">
          <span className="num font-semibold">{formatMoney(deal.price, currency)}</span>
          <span className="muted">{state === "expired" ? "Ended" : left <= 7 ? `${left} day${left === 1 ? "" : "s"} left` : `Ends in ${left} days`}</span>
        </div>
      </div>
    </Link>
  );
}

/** Paid out (solid), reserved while a purchase is verified (hatched), and still free to promise (green). */
export function PoolMeter({ pool, currency, dense = false }: { pool: Pool; currency: Currency; dense?: boolean }) {
  const f = pool.funded || 1;
  const pct = (n: number) => `${Math.min(100, (n / f) * 100)}%`;
  const free = available(pool);
  return (
    <div>
      <div className="meter" role="img" aria-label={`Funded ${formatMoney(pool.funded, currency)}. Paid out ${formatMoney(pool.paid, currency)}. Reserved ${formatMoney(pool.committed, currency)}. Free ${formatMoney(free, currency)}.`}>
        <i className="m-paid" style={{ width: pct(pool.paid) }} />
        <i className="m-hold" style={{ width: pct(pool.committed) }} />
        <i className="m-free" style={{ width: pct(free) }} />
      </div>
      {!dense && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[14.5px] sm:grid-cols-4">
          {(
            [
              ["Funded", pool.funded],
              ["Paid out", pool.paid],
              ["Reserved", pool.committed],
              ["Free to promise", free],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="muted">{k}</dt>
              <dd className="num font-semibold">{formatMoney(v, currency)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

