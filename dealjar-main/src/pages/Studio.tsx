import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, EyeOff, Loader, Pencil, Plus, Trash2 } from "lucide-react";
import { api, imgUrl, useStudio } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Avatar, ImageField, usePay } from "@/components/account";
import { PoolMeter } from "@/components/deals";
import { useToast } from "@/components/toast";
import { available } from "@shared/rewards";
import { formatMoney, toUnits } from "@shared/money";
import { formatNim, lunaToNim } from "@shared/units";

const CATEGORIES = ["Groceries", "Food", "Airtime & data", "Travel", "Learning"];

function useGate() {
  const { signedIn, loading, me } = useAuth();
  return { loading, ready: signedIn && !me?.user?.needsUsername, signedIn, needsUsername: !!me?.user?.needsUsername };
}

/** The sponsor's home: their page, their reward pot, their deals. */
export function StudioPage() {
  const gate = useGate();
  const studio = useStudio(gate.ready);
  const { me, currency, refresh } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const pay = usePay();
  const [amount, setAmount] = useState("5000");
  const [cap, setCap] = useState("");

  if (gate.loading) return <p className="wrap muted pt-10">Loading…</p>;
  if (!gate.signedIn) return <Navigate to="/signin?next=/studio" replace />;
  if (gate.needsUsername) return <Navigate to="/welcome?next=/studio" replace />;
  if (studio.isLoading) return <p className="wrap muted pt-10">Loading…</p>;
  const s = studio.data;
  if (!s?.sponsor) return <Onboarding />;
  const sp = s.sponsor;
  const rate = me?.config.nimUsd ?? 0.0025;
  const nim = Number(amount);

  async function act(path: string, body: unknown, method = "PATCH", ok = "Saved.") {
    try {
      await api(path, body, method);
      toast(ok);
      await qc.invalidateQueries();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="wrap pt-4 md:pt-10">
      <p className="eyebrow">Sponsor studio</p>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <Avatar imageKey={sp.avatarKey} name={sp.name} size={64} />
        <div>
          <h1 className="display display-lg">{sp.name}</h1>
          <p className="muted">
            <Link to={`/s/${sp.handle}`} className="underline decoration-2 underline-offset-4">
              View my public page
            </Link>
          </p>
        </div>
        <span className={`tag ${sp.status === "active" ? "tag-ok" : "tag-low"}`}>{sp.status === "active" ? "Approved" : sp.status === "pending" ? "Waiting for approval" : "Suspended"}</span>
      </div>
      {sp.status === "pending" && <p className="mt-5 max-w-[60ch] rounded-2xl bg-[var(--paper-2)] p-4">A person checks every new sponsor before deals go live. Until then you can finish your page.</p>}

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_1fr]">
        <section className="vault p-6 md:p-8" aria-labelledby="pot">
          <h2 id="pot" className="eyebrow">
            Reward pot
          </h2>
          {s.pool && (
            <>
              <p className="display display-md mt-2">{formatMoney(available(s.pool), currency)} free to promise</p>
              <div className="mt-5">
                <PoolMeter pool={s.pool} currency={currency} />
              </div>
            </>
          )}
          <p className="muted mt-4 text-[14.5px]">Rewards are paid only from this pot. Fund it with NIM; it's credited in dollars at today's rate.</p>
          {s.canFund && sp.status === "active" ? (
            <form
              className="mt-5 grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void pay.start({ kind: "topup", amountNim: nim }, () => toast("Your pot is funded."));
              }}
            >
              <label>
                <span className="eyebrow">Add NIM</span>
                <input className="field num mt-1.5 !text-[var(--ink)]" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
              </label>
              <p className="muted text-[14px]">≈ {formatMoney(Math.round(nim * rate * 1_000_000) || 0, currency)} at {rate} USD per NIM</p>
              <button type="submit" className="btn btn-gold" disabled={pay.busy || !(nim >= 1)}>
                {pay.busy ? pay.stageText : "Fund the pot"}
              </button>
              {pay.error && <p role="alert" className="rounded-xl bg-[var(--danger-bg)] p-3 text-[var(--danger)]">{pay.error}</p>}
            </form>
          ) : (
            <p className="mt-5 text-[14.5px]">{sp.status === "active" ? "Pot funding isn't set up on this server yet." : "You can fund your pot once you're approved."}</p>
          )}
          <form
            className="mt-6 grid gap-2 border-t border-[rgb(246_234_215/0.25)] pt-5"
            onSubmit={(e) => {
              e.preventDefault();
              void act("/api/studio/pool", { perPersonCapUsd: Number(cap) }, "PATCH", "Cap updated.");
            }}
          >
            <label>
              <span className="eyebrow">Most one person can earn, in dollars{s.pool ? ` (now ${toUnits(s.pool.perPersonCap)})` : ""}</span>
              <input className="field num mt-1.5 !text-[var(--ink)]" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="10" />
            </label>
            <div>
              <button type="submit" className="btn btn-ghost btn-sm" disabled={!(Number(cap) >= 0.5)}>
                Set cap
              </button>
            </div>
          </form>
          {s.topups && s.topups.length > 0 && (
            <ul className="mt-6 grid gap-1 text-[14.5px]">
              {s.topups.map((t) => (
                <li key={t.id} className="flex justify-between gap-3">
                  <span>{new Date(t.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {formatNim(t.amountLuna)}</span>
                  <span className="muted">{t.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <SponsorProfile key={sp.id} sponsor={sp} onSaved={() => void refresh()} />
      </div>

      <section className="mt-12" aria-labelledby="deals">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="deals" className="display display-md">
            Your deals
          </h2>
          {sp.status === "active" && (
            <Link to="/studio/deals/new" className="btn btn-primary btn-sm">
              <Plus aria-hidden="true" size={16} /> New deal
            </Link>
          )}
        </div>
        {!s.deals?.length ? (
          <p className="muted mt-4">No deals yet.</p>
        ) : (
          <ul className="mt-5 grid gap-4">
            {s.deals.map((d) => (
              <li key={d.id} className="card flex flex-wrap items-center gap-4 p-4">
                <div className="h-16 w-28 shrink-0 overflow-hidden rounded-xl" style={{ background: `linear-gradient(135deg, oklch(0.88 0.13 ${d.hue}), oklch(0.74 0.17 ${(d.hue + 40) % 360}))` }}>
                  {d.bannerKey && <img src={imgUrl(d.bannerKey)} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-[180px] flex-1">
                  <p className="display display-sm">{d.title}</p>
                  <p className="muted text-[14.5px]">
                    {formatNim(d.priceLuna ?? 0)} · {Math.round(d.rewardRate * 100)}% back · {d.sold} sold
                    {d.status === "hidden" ? " · hidden" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link to={`/studio/deals/${d.id}`} className="btn btn-ghost btn-sm">
                    <Pencil aria-hidden="true" size={15} /> Edit
                  </Link>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(`/api/studio/deals/${d.id}`, { status: d.status === "live" ? "hidden" : "live" }, "PATCH", d.status === "live" ? "Hidden." : "Live again.")}>
                    {d.status === "live" ? <EyeOff aria-hidden="true" size={15} /> : <Eye aria-hidden="true" size={15} />} {d.status === "live" ? "Hide" : "Show"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={`Remove ${d.title}`}
                    onClick={() => {
                      if (window.confirm(`Remove “${d.title}”? Customers who already paid keep their rewards.`)) void act(`/api/studio/deals/${d.id}`, undefined, "DELETE", "Removed.");
                    }}
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {pay.dialog}
    </div>
  );
}

function SponsorProfile({ sponsor, onSaved }: { sponsor: NonNullable<ReturnType<typeof useStudio>["data"]>["sponsor"] & object; onSaved: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(sponsor.name);
  const [tagline, setTagline] = useState(sponsor.blurb ?? "");
  const [bio, setBio] = useState(sponsor.bio);
  const [address, setAddress] = useState(sponsor.payoutAddress);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/studio/sponsor", { name, tagline, bio, payoutAddress: address }, "PATCH");
      toast("Saved.");
      await qc.invalidateQueries();
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card grid gap-6 p-6 md:p-8" aria-labelledby="page">
      <h2 id="page" className="eyebrow">
        Your page
      </h2>
      <ImageField label="Banner" current={sponsor.bannerKey} path="/api/studio/sponsor/art/banner" />
      <ImageField label="Logo" current={sponsor.avatarKey} path="/api/studio/sponsor/art/avatar" shape="round">
        <Avatar name={sponsor.name} size={96} className="!border-0" />
      </ImageField>
      <form className="grid gap-4" onSubmit={(e) => void save(e)}>
        <label>
          <span className="eyebrow">Name</span>
          <input className="field mt-1.5" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span className="eyebrow">Tagline</span>
          <input className="field mt-1.5" value={tagline} maxLength={90} onChange={(e) => setTagline(e.target.value)} />
        </label>
        <label>
          <span className="eyebrow">About</span>
          <textarea className="field mt-1.5 min-h-[88px] py-3" value={bio} maxLength={400} onChange={(e) => setBio(e.target.value)} />
        </label>
        <label>
          <span className="eyebrow">Where customers pay you (Nimiq address)</span>
          <input className="field mt-1.5 font-mono" value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} />
        </label>
        {error && <p role="alert" className="text-[var(--danger)]">{error}</p>}
        <div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {busy && <Loader aria-hidden="true" size={16} className="animate-spin" />} Save
          </button>
        </div>
      </form>
    </section>
  );
}

function Onboarding() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [bio, setBio] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { refresh } = useAuth();

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/studio/sponsor", { name, tagline, bio, payoutAddress: address });
      await qc.invalidateQueries();
      await refresh();
      nav("/studio", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wrap pt-4 md:pt-10">
      <p className="eyebrow">Sponsor studio</p>
      <h1 className="display display-xl mt-2 !text-[clamp(40px,9vw,84px)]">
        Put up a <span className="serif text-[var(--ember)]">pot.</span>
      </h1>
      <p className="lede mt-4">Sponsors fund a pot of real money and offer cashback on their deals. Rewards are only ever paid from the pot, so you can never owe more than you put in.</p>
      <form className="card mt-8 grid max-w-[620px] gap-5 p-7" onSubmit={(e) => void create(e)}>
        <label>
          <span className="eyebrow">Business or shop name</span>
          <input className="field mt-1.5" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span className="eyebrow">One-line description</span>
          <input className="field mt-1.5" value={tagline} maxLength={90} onChange={(e) => setTagline(e.target.value)} />
        </label>
        <label>
          <span className="eyebrow">About (optional)</span>
          <textarea className="field mt-1.5 min-h-[88px] py-3" value={bio} maxLength={400} onChange={(e) => setBio(e.target.value)} />
        </label>
        <label>
          <span className="eyebrow">Nimiq address that receives payments</span>
          <input className="field mt-1.5 font-mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="NQ07 0000 0000 0000 0000 0000 0000 0000 0000" spellCheck={false} />
        </label>
        {error && <p role="alert" className="text-[var(--danger)]">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || name.trim().length < 2 || address.trim().length < 20}>
          {busy && <Loader aria-hidden="true" size={18} className="animate-spin" />} Create my sponsor page
        </button>
        <p className="muted text-[14px]">Your username becomes your page address. A person approves new sponsors before deals go live.</p>
      </form>
    </div>
  );
}

/** One form for a new deal and for editing one. */
export function DealFormPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const gate = useGate();
  const studio = useStudio(gate.ready);
  const { me } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const existing = studio.data?.deals?.find((d) => d.id === id);
  const [f, setF] = useState({ title: "", summary: "", category: "Groceries", priceNim: "1000", rewardPercent: "10", rewardMaxUsd: "2", days: "30" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!existing) return;
    // fill the form once the deal has loaded
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setF({
      title: existing.title,
      summary: existing.summary,
      category: existing.category,
      priceNim: String(lunaToNim(existing.priceLuna ?? 0)),
      rewardPercent: String(Math.round(existing.rewardRate * 1000) / 10),
      rewardMaxUsd: String(toUnits(existing.rewardMax)),
      days: String(Math.max(1, Math.ceil((new Date(existing.expiresAt).getTime() - Date.now()) / 86_400_000))),
    });
  }, [existing]);

  if (gate.loading) return <p className="wrap muted pt-10">Loading…</p>;
  if (!gate.signedIn) return <Navigate to="/signin?next=/studio" replace />;
  if (studio.isLoading) return <p className="wrap muted pt-10">Loading…</p>;
  if (!studio.data?.sponsor || studio.data.sponsor.status !== "active") return <Navigate to="/studio" replace />;
  if (!isNew && !existing) return <Navigate to="/studio" replace />;

  const rate = me?.config.nimUsd ?? 0.0025;
  const body = { title: f.title, summary: f.summary, category: f.category, priceNim: Number(f.priceNim), rewardPercent: Number(f.rewardPercent), rewardMaxUsd: Number(f.rewardMaxUsd), days: Number(f.days) };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (isNew) {
        const r = await api<{ id: string }>("/api/studio/deals", body);
        toast("Deal created. Add a banner so it stands out.");
        await qc.invalidateQueries();
        nav(`/studio/deals/${r.id}`, { replace: true });
      } else {
        await api(`/api/studio/deals/${id}`, body, "PATCH");
        toast("Saved.");
        await qc.invalidateQueries();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap pt-4 md:pt-10">
      <Link to="/studio" className="inline-flex items-center gap-2 font-semibold">
        <ArrowLeft aria-hidden="true" size={18} /> Studio
      </Link>
      <h1 className="display display-lg mt-4">{isNew ? "New deal" : "Edit deal"}</h1>
      <div className="mt-8 grid max-w-[720px] gap-8">
        {!isNew && existing && (
          <section className="card p-7">
            <ImageField label="Deal banner" current={existing.bannerKey} path={`/api/studio/deals/${existing.id}/art`} hint="Shown on the deal's card and page. 1200×630 works best." />
          </section>
        )}
        <form className="card grid gap-5 p-7" onSubmit={(e) => void save(e)}>
          <label>
            <span className="eyebrow">Title</span>
            <input className="field mt-1.5" value={f.title} maxLength={60} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </label>
          <label>
            <span className="eyebrow">Description</span>
            <textarea className="field mt-1.5 min-h-[88px] py-3" value={f.summary} maxLength={300} onChange={(e) => setF({ ...f, summary: e.target.value })} />
          </label>
          <label>
            <span className="eyebrow">Category</span>
            <select className="field mt-1.5" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="eyebrow">Price, in NIM</span>
              <input className="field num mt-1.5" inputMode="decimal" value={f.priceNim} onChange={(e) => setF({ ...f, priceNim: e.target.value.replace(/[^0-9.]/g, "") })} />
              <span className="muted text-[13.5px]">≈ ${(Number(f.priceNim) * rate).toFixed(2)} today</span>
            </label>
            <label>
              <span className="eyebrow">Runs for (days)</span>
              <input className="field num mt-1.5" inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value.replace(/\D/g, "") })} />
            </label>
            <label>
              <span className="eyebrow">Cashback (%)</span>
              <input className="field num mt-1.5" inputMode="decimal" value={f.rewardPercent} onChange={(e) => setF({ ...f, rewardPercent: e.target.value.replace(/[^0-9.]/g, "") })} />
              <span className="muted text-[13.5px]">At most 25%</span>
            </label>
            <label>
              <span className="eyebrow">Most one purchase earns ($)</span>
              <input className="field num mt-1.5" inputMode="decimal" value={f.rewardMaxUsd} onChange={(e) => setF({ ...f, rewardMaxUsd: e.target.value.replace(/[^0-9.]/g, "") })} />
            </label>
          </div>
          {error && <p role="alert" className="text-[var(--danger)]">{error}</p>}
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy && <Loader aria-hidden="true" size={18} className="animate-spin" />} {isNew ? "Create the deal" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
