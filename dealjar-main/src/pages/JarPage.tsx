import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Gift, HandCoins, Loader, ShieldQuestion, Sparkles, UsersRound } from "lucide-react";
import { ASSET_LIST } from "@shared/assets";
import { formatMoney, tokensFor, toUnits, usd } from "@shared/money";
import { formatNim } from "@shared/units";
import type { Asset, AssetId, JarEntry } from "@shared/types";
import { Jar } from "@/components/Jar";
import { PassportSheet, RiskTag, SaveSheet } from "@/components/savings";
import { useToast } from "@/components/toast";
import { Money, SectionTitle, Sheet } from "@/components/ui";
import { api, useJar } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useReveal } from "@/lib/motion";

const SOURCE: Record<JarEntry["source"], { label: string; Icon: typeof Gift }> = {
  reward: { label: "Reward", Icon: Gift },
  referral: { label: "Friend", Icon: UsersRound },
  deposit: { label: "Added", Icon: HandCoins },
  swap: { label: "Moved", Icon: Sparkles },
  cashout: { label: "Cash-out", Icon: ArrowUpRight },
};

export default function JarPage() {
  const { signedIn, loading, currency, me } = useAuth();
  const q = useJar(signedIn);
  const qc = useQueryClient();
  const toast = useToast();
  const ref = useReveal<HTMLDivElement>();
  const [burst, setBurst] = useState(0);
  const [save, setSave] = useState(false);
  const [cash, setCash] = useState(false);
  const [passport, setPassport] = useState<Asset | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [cashAsset, setCashAsset] = useState<AssetId>("USDT");
  const [cashAmount, setCashAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (loading) return <p className="wrap muted pt-10">Loading…</p>;
  if (!signedIn) {
    return (
      <div className="wrap pt-4 md:pt-10">
        <p className="eyebrow">Your jar</p>
        <h1 className="display display-xl mt-2 !text-[clamp(40px,9vw,84px)]">
          Every reward <span className="serif text-[var(--ember)]">lands here.</span>
        </h1>
        <p className="lede mt-4">Sign in to see your jar, set a goal, and cash out whenever you like.</p>
        <Link to="/signin?next=/jar" className="btn btn-primary mt-8">
          Sign in
        </Link>
      </div>
    );
  }
  if (me?.user?.needsUsername) return <Link to="/welcome?next=/jar" className="btn btn-primary wrap mt-10">Choose a username first</Link>;
  if (q.isLoading || !q.data) return <p className="wrap muted pt-10">Loading…</p>;

  const { holdings: h, goal, entries, cashouts, nimUsd } = q.data;
  const total = h.USDT + h.EURE + h.XAUT0;
  const progress = goal.target > 0 ? Math.min(100, Math.round((total / goal.target) * 100)) : 0;
  const history = entries.filter((e) => e.micro > 0 || e.source === "cashout");

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      toast(ok);
      await qc.invalidateQueries();
      return true;
    } catch (e) {
      setError((e as Error).message);
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const cashN = Number(cashAmount);
  const cashMicro = usd(Number.isFinite(cashN) ? cashN : 0);
  const cashOk = cashMicro >= usd(1) && cashMicro <= h[cashAsset];

  return (
    <div ref={ref} className="wrap pt-4 md:pt-10">
      <div className="lg:grid lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        <section aria-labelledby="jar-h" className="vault vault-blue p-7 lg:sticky lg:top-8 lg:self-start">
          <p className="eyebrow relative">Your jar</p>
          <h1 id="jar-h" className="display display-xl !text-[clamp(44px,10vw,88px)] mt-2">
            <Money micro={total} currency={currency} />
          </h1>
          <p className="lede mt-3 !text-[var(--vault-ink)]">
            {progress}% of the way to <strong>{goal.name}</strong>.
          </p>
          <div className="mx-auto mt-6 w-full max-w-[340px]">
            <Jar holdings={h} target={goal.target} burst={burst} label={`Your jar holds ${formatMoney(total, currency)}`} />
          </div>
          <div className="relative mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setGoalName(goal.name);
                setGoalTarget(String(toUnits(goal.target)));
                setError("");
                setGoalOpen(true);
              }}
            >
              Change my goal
            </button>
            <button type="button" className="btn btn-gold btn-sm" onClick={() => { setCashAmount(""); setError(""); setCash(true); }} disabled={total < usd(1)}>
              Cash out
            </button>
          </div>
        </section>

        <div className="mt-12 lg:mt-0">
          <div data-reveal>
            <SectionTitle>
              What's <span className="serif">inside</span>
            </SectionTitle>
          </div>
          <ul className="grid gap-4">
            {ASSET_LIST.map((a, i) => {
              const micro = h[a.id];
              return (
                <li key={a.id} data-reveal style={{ ["--d" as string]: i }} className="card p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="display display-sm flex items-center gap-2.5">
                        <span aria-hidden="true" className="inline-block h-4 w-4 rounded-full" style={{ background: a.color }} />
                        {a.name}
                      </p>
                      <p className="muted num mt-1">
                        {tokensFor(a, micro).toLocaleString("en-US", { maximumFractionDigits: a.id === "XAUT0" ? 5 : 2 })} {a.short.toLowerCase()}
                      </p>
                    </div>
                    <p className="display text-[28px] leading-none num">{formatMoney(micro, currency)}</p>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <RiskTag asset={a} />
                    <button type="button" className="inline-flex items-center gap-1.5 font-semibold underline decoration-2 underline-offset-4" onClick={() => setPassport(a)}>
                      <ShieldQuestion aria-hidden="true" size={17} /> Passport
                    </button>
                    {a.id === "USDT" && (
                      <button type="button" className="btn btn-gold btn-sm ml-auto" disabled={micro < usd(0.5)} onClick={() => setSave(true)}>
                        Save some
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="muted mt-4 text-[14.5px]">Moving value into euros or gold is tracked at today's rates inside your jar. It isn't an on-chain swap yet, and the labels are still drafts. Euros and gold can go down as well as up.</p>

          {cashouts.length > 0 && (
            <div className="mt-12">
              <div data-reveal>
                <SectionTitle>Cash-outs</SectionTitle>
              </div>
              <ul className="card divide-y divide-[var(--line)]">
                {cashouts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <span>
                      <span className="block font-semibold num">{formatNim(c.amountLuna)}</span>
                      <span className="muted text-[14px]">{new Date(c.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    </span>
                    <span className={`tag ${c.status === "paid" ? "tag-ok" : c.status === "rejected" ? "tag-off" : "tag-low"}`}>{c.status === "pending" ? "Being paid" : c.status === "paid" ? "Paid" : "Returned to jar"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div data-reveal className="mt-14">
            <SectionTitle>History</SectionTitle>
          </div>
          {history.length === 0 ? (
            <p className="muted">Nothing yet. <Link to="/deals" className="font-semibold underline decoration-2 underline-offset-4">Take a deal</Link> and your first reward lands here.</p>
          ) : (
            <ul className="card divide-y divide-[var(--line)]">
              {history.map((e) => {
                const S = SOURCE[e.source] ?? SOURCE.reward;
                return (
                  <li key={e.id} className="flex items-center gap-4 p-4">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--paper-2)]">
                      <S.Icon aria-hidden="true" size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{e.label}</span>
                      <span className="muted block text-[14px]">
                        {S.label} · {new Date(e.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </span>
                    <span className="num font-semibold">{e.micro > 0 ? "+" : ""}{formatMoney(e.micro, currency)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <SaveSheet
        open={save}
        onClose={() => setSave(false)}
        dollars={h.USDT}
        currency={currency}
        onSave={(asset, micro) => {
          void run(() => api("/api/jar/convert", { from: "USDT", to: asset, amount: micro }), "Moved.").then((ok) => {
            if (ok) setBurst((b) => b + 1);
          });
        }}
      />
      <PassportSheet asset={passport} open={!!passport} onClose={() => setPassport(null)} />

      <Sheet open={goalOpen} onClose={() => setGoalOpen(false)} title="What are you saving for?" label="Your goal">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const t = Number(goalTarget);
            if (!goalName.trim() || !Number.isFinite(t) || t < 1 || t > 100_000) return setError("Give it a name and a target between $1 and $100,000.");
            void run(() => api("/api/me", { goalName: goalName.trim(), goalTarget: usd(t) }, "PATCH"), "Goal saved.").then((ok) => ok && setGoalOpen(false));
          }}
        >
          <label>
            <span className="eyebrow">Name</span>
            <input className="field mt-1.5" maxLength={40} value={goalName} onChange={(e) => setGoalName(e.target.value)} />
          </label>
          <label>
            <span className="eyebrow">Target in dollars</span>
            <input className="field num mt-1.5" inputMode="decimal" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          {error && <p role="alert" className="text-[var(--danger)]">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save goal
          </button>
        </form>
      </Sheet>

      <Sheet open={cash} onClose={() => setCash(false)} title="Cash out" label="To your wallet">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api("/api/jar/cashout", { asset: cashAsset, amount: cashMicro }), "Cash-out requested.").then((ok) => ok && setCash(false));
          }}
        >
          <p>
            Your money is paid in NIM to your own wallet (<span className="font-mono text-[14px]">{me?.user?.address.slice(0, 9)}…</span>), within about a day. The value leaves your jar now; if it can't be paid, it comes straight back.
          </p>
          <label>
            <span className="eyebrow">Take it from</span>
            <select className="field mt-1.5" value={cashAsset} onChange={(e) => setCashAsset(e.target.value as AssetId)}>
              {ASSET_LIST.filter((a) => h[a.id] >= usd(1)).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}: {formatMoney(h[a.id], currency)}
                </option>
              ))}
              {ASSET_LIST.every((a) => h[a.id] < usd(1)) && <option value="USDT">Nothing to cash out yet</option>}
            </select>
          </label>
          <label>
            <span className="eyebrow">Amount in dollars (at least $1)</span>
            <input className="field num mt-1.5" inputMode="decimal" value={cashAmount} onChange={(e) => setCashAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          {cashOk && <p className="muted num">≈ {formatNim(Math.floor((cashMicro / 1_000_000 / nimUsd) * 100_000))} at ${nimUsd} per NIM</p>}
          {error && <p role="alert" className="text-[var(--danger)]">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={!cashOk || busy}>
            {busy && <Loader aria-hidden="true" size={18} className="animate-spin" />} Request cash-out
          </button>
        </form>
      </Sheet>
    </div>
  );
}
