import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Check, Flag, Loader } from "lucide-react";
import { formatMoney } from "@shared/money";
import { formatNim } from "@shared/units";
import { rewardOffer, rewardState } from "@shared/rewards";
import { Jar } from "@/components/Jar";
import { PoolMeter, StateTag, daysLeft } from "@/components/deals";
import { usePay } from "@/components/account";
import { useToast } from "@/components/toast";
import { Magnetic, Sheet } from "@/components/ui";
import { api, imgUrl, useDeal, useJar } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function DealDetailPage() {
  const { id = "" } = useParams();
  const q = useDeal(id);
  const { signedIn, me, currency } = useAuth();
  const jar = useJar(signedIn);
  const pay = usePay();
  const toast = useToast();
  const [burst, setBurst] = useState(0);
  const [result, setResult] = useState<{ reward: number } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (q.isLoading) return <p className="wrap muted pt-10">Loading…</p>;
  const { deal, pool, sponsor, earned = 0 } = q.data ?? {};
  if (!deal || !pool || !sponsor) {
    return (
      <div className="wrap pt-10">
        <h1 className="display display-lg">That deal isn't here.</h1>
        <Link to="/deals" className="btn btn-primary mt-6">
          Back to deals
        </Link>
      </div>
    );
  }

  const state = rewardState(deal, pool);
  const offer = rewardOffer(deal, pool, earned);
  const left = daysLeft(deal.expiresAt);
  const next = `/signin?next=${encodeURIComponent(`/deals/${deal.id}`)}`;
  const needsName = !!me?.user?.needsUsername;
  const holdings = jar.data?.holdings ?? { USDT: 0, EURE: 0, XAUT0: 0 };
  const total = holdings.USDT + holdings.EURE + holdings.XAUT0;
  const steps = [
    { label: "You pay the merchant from your wallet", done: pay.stage === "verifying" || !!result, now: pay.stage === "preparing" || pay.stage === "wallet" },
    { label: "DealJar sees the payment on the Nimiq network", done: !!result, now: pay.stage === "verifying" },
    { label: offer > 0 ? "Your reward is paid into the jar" : "No reward on this one", done: !!result, now: false },
  ];

  function buy() {
    if (!deal) return;
    setResult(null);
    void pay.start({ kind: "purchase", dealId: deal.id }, () => {
      setResult({ reward: offer });
      setBurst((b) => b + 1);
      void jar.refetch();
      void q.refetch();
    });
  }

  async function report(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/deals/${deal?.id}/report`, { reason });
      toast("Thanks. A person will take a look.");
      setReportOpen(false);
      setReason("");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div className="wrap pt-2 md:pt-8">
      <Link to="/deals" className="inline-flex items-center gap-2 font-semibold">
        <ArrowLeft aria-hidden="true" size={18} /> All deals
      </Link>

      <div className="mt-6 lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
        <div>
          <div className="relative flex h-52 items-end overflow-hidden rounded-[30px] p-6 md:h-64" style={{ background: `linear-gradient(135deg, oklch(0.88 0.13 ${deal.hue}), oklch(0.74 0.17 ${(deal.hue + 40) % 360}))` }}>
            {deal.bannerKey ? (
              <img src={imgUrl(deal.bannerKey)} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <span className="display pointer-events-none absolute -right-2 -top-6 select-none text-[190px] leading-none text-white/35" aria-hidden="true">
                {Math.round(deal.rewardRate * 100)}%
              </span>
            )}
            <span className="tag relative bg-white/90 text-[var(--ink)]">{deal.category}</span>
          </div>
          <p className="eyebrow mt-7">
            {sponsor.handle ? (
              <Link to={`/s/${sponsor.handle}`} className="underline decoration-1 underline-offset-4">
                {sponsor.name}
              </Link>
            ) : (
              sponsor.name
            )}
          </p>
          <h1 className="display display-lg mt-2">{deal.title}</h1>
          <p className="lede mt-4 !max-w-[52ch]">{deal.summary}</p>
          <p className="muted mt-4">
            {state === "expired" ? "This deal has ended." : left <= 7 ? `${left} day${left === 1 ? "" : "s"} left` : `Ends in ${left} days`} · {deal.community ? "Shared by a community member and reviewed" : `Offered by ${sponsor.name}`}
          </p>
          {signedIn && (
            <button type="button" className="mt-5 inline-flex items-center gap-2 text-[14.5px] text-[var(--muted)] underline decoration-1 underline-offset-4" onClick={() => setReportOpen(true)}>
              <Flag aria-hidden="true" size={15} /> Report this deal
            </button>
          )}
        </div>

        <div className="mt-8 grid content-start gap-5 lg:mt-0">
          <section className="card p-6" aria-labelledby="reward">
            <h2 id="reward" className="eyebrow">
              The reward
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <StateTag state={state} offer={offer} currency={currency} />
            </div>
            <p className="mt-4">
              {state === "funded" && `Pay ${formatMoney(deal.price, currency)} and ${formatMoney(offer, currency)} comes back to your jar once DealJar has seen your payment.`}
              {state === "low" && offer > 0 && `The pot is nearly empty. If it runs out before your payment is seen, there will be no cashback, but the deal still works.`}
              {state === "low" && offer === 0 && `There isn't enough left in the pot to promise a reward. You can still take the deal.`}
              {state === "empty" && `The sponsor's pot is empty, so this deal pays no cashback. You can still take the deal at its price.`}
              {state === "expired" && `This deal has ended.`}
            </p>
            {earned > 0 && (
              <p className="muted mt-2 text-[15px]">
                You've already earned {formatMoney(earned, currency)} from this sponsor (the most one person can earn is {formatMoney(pool.perPersonCap, currency)}).
              </p>
            )}
            <div className="mt-5">
              <PoolMeter pool={pool} currency={currency} />
            </div>
          </section>

          <section className="card p-6" aria-labelledby="buy">
            <h2 id="buy" className="eyebrow">
              Take the deal
            </h2>
            <p className="display display-md mt-2 num">{formatMoney(deal.price, currency)}</p>
            <p className="muted num">{formatNim(deal.priceLuna ?? 0)}</p>
            <div className="mt-5">
              {!signedIn ? (
                <Link to={next} className="btn btn-primary w-full sm:w-auto">
                  Sign in to take this deal
                </Link>
              ) : needsName ? (
                <Link to={`/welcome?next=${encodeURIComponent(`/deals/${deal.id}`)}`} className="btn btn-primary w-full sm:w-auto">
                  Choose a username first
                </Link>
              ) : (
                <Magnetic>
                  <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={state === "expired" || pay.busy} onClick={buy}>
                    {pay.busy ? (
                      <>
                        <Loader aria-hidden="true" size={18} className="animate-spin" /> {pay.stageText}
                      </>
                    ) : (
                      "Pay with NIM"
                    )}
                  </button>
                </Magnetic>
              )}
            </div>
            {pay.error && (
              <p role="alert" className="mt-4 rounded-2xl bg-[var(--danger-bg)] p-4 text-[var(--danger)]">
                {pay.error}
              </p>
            )}
            <p className="muted mt-4 text-[14.5px]">Your wallet pays the sponsor directly, with a short note on the payment. That note is how DealJar links it to this deal and pays your reward. DealJar never holds your money.</p>
            {(pay.busy || result) && (
              <ol className="mt-6 grid gap-3" aria-live="polite">
                {steps.map((s) => (
                  <li key={s.label} className="flex items-center gap-3">
                    <span className={`grid h-8 w-8 place-items-center rounded-full border-2 ${s.done ? "border-[var(--leaf)] bg-[var(--leaf-bg)] text-[var(--leaf)]" : "border-[var(--line-strong)]"}`}>
                      {s.done ? <Check aria-hidden="true" size={16} /> : s.now ? <Loader aria-hidden="true" size={16} className="animate-spin" /> : null}
                    </span>
                    <span className={s.done || s.now ? "font-semibold" : "muted"}>{s.label}</span>
                  </li>
                ))}
              </ol>
            )}
            {result && result.reward > 0 && (
              <div className="mt-6 grid items-center gap-4 sm:grid-cols-[120px_1fr]">
                <Jar holdings={holdings} target={jar.data?.goal.target ?? 100_000_000} burst={burst} label={`Your jar holds ${formatMoney(total, currency)}`} className="w-full max-w-[120px]" />
                <p>
                  <strong>{formatMoney(result.reward, currency)} is in your jar.</strong>{" "}
                  <Link to="/jar" className="font-semibold underline decoration-2 underline-offset-4">
                    See your jar
                  </Link>
                </p>
              </div>
            )}
            {result && result.reward === 0 && <p className="mt-5 rounded-2xl bg-[var(--paper-2)] p-4">Your payment is confirmed. There was no cashback left on this one. Your purchase is unaffected.</p>}
          </section>
        </div>
      </div>
      {pay.dialog}
      <Sheet open={reportOpen} onClose={() => setReportOpen(false)} title="Report this deal" label="Something wrong?">
        <form className="grid gap-4" onSubmit={(e) => void report(e)}>
          <label>
            <span className="eyebrow">What's wrong?</span>
            <textarea className="field mt-1.5 min-h-[96px] py-3" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={reason.trim().length < 5}>
            Send report
          </button>
        </form>
      </Sheet>
    </div>
  );
}
