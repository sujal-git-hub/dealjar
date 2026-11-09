import { useState } from "react";
import { Link } from "react-router";
import { Download, Landmark, LogOut, Pencil, Receipt, Share2, Store, UserRound } from "lucide-react";
import { CURRENCIES, type Currency } from "@shared/types";
import { formatMoney, usd } from "@shared/money";
import { api, useReferral } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getToken } from "@/lib/session";
import { Avatar, CopyButton } from "@/components/account";
import { PoolMeter } from "@/components/deals";
import { useToast } from "@/components/toast";
import { PageBand, SectionTitle, Sheet } from "@/components/ui";
import { useReveal } from "@/lib/motion";

const NAMES: Record<Currency, string> = { USD: "US dollar", EUR: "Euro", CRC: "Costa Rican colón", GMD: "Gambian dalasi" };

export default function MePage() {
  const { me, signedIn, currency, setCurrency, logout, inNimiqPay, loading } = useAuth();
  const ref = useReferral(signedIn && !me?.user?.needsUsername);
  const toast = useToast();
  const reveal = useReveal<HTMLDivElement>();
  const [code, setCode] = useState("");
  const [delOpen, setDelOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [delError, setDelError] = useState("");
  const user = me?.user;
  const r = ref.data;
  const link = r?.code ? `${window.location.origin}/?ref=${r.code}` : "";

  async function approve(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/auth/pair/approve", { code });
      toast("Approved. The other device is now signed in.");
      setCode("");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function exportData() {
    try {
      const res = await fetch("/api/me/export", { headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {} });
      if (!res.ok) throw new Error("Couldn't prepare your data.");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "dealjar-my-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault();
    setDelError("");
    try {
      await api("/api/me", { confirm }, "DELETE");
      setDelOpen(false);
      await logout();
      toast("Your account was deleted.");
    } catch (err) {
      setDelError((err as Error).message);
    }
  }

  if (loading) return <p className="wrap muted pt-10">Loading…</p>;

  return (
    <div ref={reveal}>
      <PageBand eyebrow="Me" title={<>Me, <span className="serif">settings</span></>} />
      <div className="wrap">
        {!user ? (
          <section className="card mt-10 p-7">
            <h2 className="display display-md">Sign in to keep your jar</h2>
            <p className="muted mt-2 max-w-[52ch]">Your Nimiq wallet is your account. No password, and DealJar never holds your keys.</p>
            <Link to="/signin?next=/me" className="btn btn-primary mt-6">
              Sign in
            </Link>
          </section>
        ) : (
          <>
            <section className="card mt-10 flex flex-wrap items-center gap-5 p-6">
              <Avatar imageKey={user.avatarKey} name={user.name} size={72} />
              <div className="min-w-[200px] flex-1">
                <p className="display display-md">{user.name}</p>
                <p className="muted">{user.username ? `@${user.username}` : "No username yet"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {user.username && (
                  <Link to={`/u/${user.username}`} className="btn btn-ghost btn-sm">
                    <UserRound aria-hidden="true" size={16} /> My page
                  </Link>
                )}
                <Link to="/me/edit" className="btn btn-ghost btn-sm">
                  <Pencil aria-hidden="true" size={16} /> Edit profile
                </Link>
              </div>
            </section>

            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <li>
                <Link to="/receipts" className="lift card flex items-center gap-3 p-5 font-semibold">
                  <Receipt aria-hidden="true" size={22} /> Receipts
                </Link>
              </li>
              <li>
                <Link to="/studio" className="lift card flex items-center gap-3 p-5 font-semibold">
                  <Store aria-hidden="true" size={22} /> {me?.sponsor ? "Sponsor studio" : "Become a sponsor"}
                </Link>
              </li>
              {user.role === "admin" && (
                <li>
                  <Link to="/admin" className="lift card flex items-center gap-3 p-5 font-semibold">
                    <Landmark aria-hidden="true" size={22} /> Admin
                  </Link>
                </li>
              )}
            </ul>
          </>
        )}

        <section aria-labelledby="cur" className="mt-16">
          <h2 id="cur" className="display display-md">
            Show money in
          </h2>
          <p className="muted mt-2">Your jar holds dollars, euros or gold, and everything is shown in the currency you choose.</p>
          <div role="radiogroup" aria-label="Currency" className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {CURRENCIES.map((c) => (
              <label key={c} className={`flex cursor-pointer flex-col rounded-2xl border-2 p-4 ${currency === c ? "border-[var(--ink)] bg-white" : "border-[var(--line)]"}`}>
                <input type="radio" name="currency" className="sr-only" checked={currency === c} onChange={() => void setCurrency(c)} />
                <span className="display display-sm">{c}</span>
                <span className="muted text-[14px]">{NAMES[c]}</span>
                <span className="num mt-2 text-[14.5px]">{formatMoney(usd(10), c)} = $10</span>
              </label>
            ))}
          </div>
          <p className="muted mt-3 text-[14px]">Exchange rates for non-dollar currencies are illustrative for now.</p>
        </section>

        {user && !user.needsUsername && r && (
          <section id="friends" aria-labelledby="fr" className="mt-16 scroll-mt-8">
            <div data-reveal>
              <SectionTitle id="fr">
                Bring a <span className="serif">friend</span>
              </SectionTitle>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <div data-reveal className="card p-6" style={{ background: "linear-gradient(135deg, #ffd166, #ffb100)" }}>
                <p className="eyebrow !text-[var(--ink)]">Your link</p>
                <p className="display mt-2 break-all text-[22px] leading-tight">{link.replace(/^https?:\/\//, "")}</p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <CopyButton text={link} label="Copy link" />
                  {"share" in navigator && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigator.share({ title: "DealJar", url: link }).catch(() => {})}>
                      <Share2 aria-hidden="true" size={16} /> Share
                    </button>
                  )}
                </div>
                <dl className="mt-6 grid grid-cols-2 gap-4">
                  <div>
                    <dt className="eyebrow !text-[var(--ink)]">Friends rewarded</dt>
                    <dd className="display text-[32px] leading-none num">{r.paid}</dd>
                  </div>
                  <div>
                    <dt className="eyebrow !text-[var(--ink)]">You earned</dt>
                    <dd className="display text-[32px] leading-none num">{formatMoney(r.earned, currency)}</dd>
                  </div>
                </dl>
              </div>
              <div data-reveal style={{ ["--d" as string]: 1 }} className="card p-6">
                <p className="eyebrow">The rules, plainly</p>
                <ul className="mt-3 grid gap-3">
                  <li>
                    You and your friend each get <strong className="num">{formatMoney(r.perFriend, currency)}</strong> when they take their first verified deal.
                  </li>
                  <li>Rewards come from a capped pot that is shown in the open. When it's empty, referrals wait until it's topped up.</li>
                  <li>One reward per person. A private device code, stored only as a salted hash, stops one person claiming many times.</li>
                </ul>
                <div className="mt-5">
                  <PoolMeter pool={{ id: "ref", sponsorId: "", funded: r.potFunded, committed: 0, paid: r.potPaid, perPersonCap: r.perFriend }} currency={currency} />
                </div>
              </div>
            </div>
          </section>
        )}

        {user && (
          <>
            <section className="mt-16" aria-labelledby="dev">
              <h2 id="dev" className="display display-md">
                Sign in another device
              </h2>
              <p className="muted mt-2 max-w-[56ch]">Using DealJar in a browser? It shows a short code. Type it here to sign that browser in as you.</p>
              <form className="mt-5 flex max-w-[420px] gap-3" onSubmit={(e) => void approve(e)}>
                <input className="field font-mono uppercase" aria-label="Code from the other device" placeholder="ABCD-EFGH" value={code} maxLength={9} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" spellCheck={false} />
                <button type="submit" className="btn btn-primary" disabled={code.replace(/[^A-Za-z0-9]/g, "").length < 8}>
                  Approve
                </button>
              </form>
              {!inNimiqPay && <p className="muted mt-3 text-[14px]">This works from any signed-in device, but it's meant for Nimiq Pay.</p>}
            </section>

            <section className="mt-16" aria-labelledby="mine">
              <h2 id="mine" className="display display-md">
                Your account
              </h2>
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" className="btn btn-ghost" onClick={() => void exportData()}>
                  <Download aria-hidden="true" size={18} /> Download my data
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
                  <LogOut aria-hidden="true" size={18} /> Sign out
                </button>
                {user.role === "member" && (
                  <button type="button" className="btn btn-ghost" onClick={() => { setConfirm(""); setDelError(""); setDelOpen(true); }}>
                    Delete my account
                  </button>
                )}
              </div>
            </section>
          </>
        )}

        <p className="muted mb-4 mt-16 max-w-[60ch] text-[14px]">DealJar is built for the Nimiq Mini Apps Competition. Savings labels are drafts until they've been checked against each issuer's own documents.</p>
      </div>

      <Sheet open={delOpen} onClose={() => setDelOpen(false)} title="Delete my account" label="This can't be undone">
        <form className="grid gap-4" onSubmit={(e) => void deleteAccount(e)}>
          <p>Your name, picture and bio are removed and your wallet is unlinked. Payment records are kept, without your name. You'll need to cash out or spend what's in your jar first.</p>
          <label>
            <span className="eyebrow">Type DELETE to confirm</span>
            <input className="field mt-1.5" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </label>
          {delError && <p role="alert" className="text-[var(--danger)]">{delError}</p>}
          <button type="submit" className="btn btn-primary" disabled={confirm !== "DELETE"}>
            Delete my account
          </button>
        </form>
      </Sheet>
    </div>
  );
}
