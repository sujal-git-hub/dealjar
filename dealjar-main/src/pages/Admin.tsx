import { useState } from "react";
import { Navigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Play } from "lucide-react";
import { api, useAdmin } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePay } from "@/components/account";
import { PoolMeter } from "@/components/deals";
import { useToast } from "@/components/toast";
import { formatMoney } from "@shared/money";
import { formatNim, shortAddress } from "@shared/units";

/** Moderation, cash-outs, the referral pot, the scheduled jobs and the exchange rate. */
export default function AdminPage() {
  const { me, loading, currency } = useAuth();
  const isAdmin = me?.user?.role === "admin";
  const q = useAdmin(isAdmin);
  const qc = useQueryClient();
  const toast = useToast();
  const pay = usePay();
  const [tx, setTx] = useState<Record<string, string>>({});
  const [potNim, setPotNim] = useState("5000");
  const [rate, setRate] = useState("");

  if (loading) return <p className="wrap muted pt-10">Loading…</p>;
  if (!isAdmin) return <Navigate to="/" replace />;
  if (q.isLoading || !q.data) return <p className="wrap muted pt-10">Loading…</p>;
  const a = q.data;

  async function act(path: string, body: unknown, ok: string) {
    try {
      await api(path, body);
      toast(ok);
      await qc.invalidateQueries();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="wrap pt-4 md:pt-10">
      <p className="eyebrow">Admin</p>
      <h1 className="display display-lg mt-2">
        The <span className="serif">back office</span>
      </h1>
      <dl className="mt-6 grid max-w-[560px] grid-cols-3 gap-3">
        {[
          ["Members", a.counts.members],
          ["Purchases", a.counts.purchases],
          ["Pending", a.counts.pending],
        ].map(([k, v]) => (
          <div key={k as string} className="card p-4">
            <dt className="eyebrow">{k}</dt>
            <dd className="display text-[28px] leading-none num">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-12" aria-labelledby="sp">
        <h2 id="sp" className="display display-md">Sponsors</h2>
        <ul className="card mt-4 divide-y divide-[var(--line)]">
          {a.sponsors.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-[200px] flex-1">
                <p className="font-semibold">
                  {s.name} <span className="muted">@{s.handle}</span> {s.verified && <BadgeCheck aria-label="verified" size={16} className="inline text-[var(--leaf)]" />}
                </p>
                <p className="muted font-mono text-[12.5px]">{s.demo ? "demo sponsor" : shortAddress(s.payoutAddress)}</p>
              </div>
              <span className={`tag ${s.status === "active" ? "tag-ok" : s.status === "pending" ? "tag-low" : "tag-off"}`}>{s.status}</span>
              <div className="flex flex-wrap gap-2">
                {s.status !== "active" && <button type="button" className="btn btn-primary btn-sm" onClick={() => void act(`/api/admin/sponsors/${s.id}`, { action: "approve" }, "Approved.")}>Approve</button>}
                {s.status === "active" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(`/api/admin/sponsors/${s.id}`, { action: "suspend" }, "Suspended.")}>Suspend</button>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(`/api/admin/sponsors/${s.id}`, { action: s.verified ? "unverify" : "verify" }, s.verified ? "Unverified." : "Verified.")}>
                  {s.verified ? "Unverify" : "Verify"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12" aria-labelledby="rp">
        <h2 id="rp" className="display display-md">Reports ({a.reports.length})</h2>
        {a.reports.length === 0 ? (
          <p className="muted mt-3">Nothing to review.</p>
        ) : (
          <ul className="card mt-4 divide-y divide-[var(--line)]">
            {a.reports.map((r) => (
              <li key={r.id} className="p-4">
                <p className="font-semibold">{r.dealTitle}</p>
                <p className="mt-1">{r.reason}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void act(`/api/admin/deals/${r.dealId}`, { action: "remove" }, "Deal removed.").then(() => api(`/api/admin/reports/${r.id}`, { action: "actioned" }))}>Remove the deal</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(`/api/admin/reports/${r.id}`, { action: "dismissed" }, "Dismissed.")}>Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="co">
        <h2 id="co" className="display display-md">Cash-outs waiting ({a.cashouts.length})</h2>
        <p className="muted mt-2 max-w-[62ch]">Send the NIM from your own wallet, then paste the transaction hash. When a node is configured it checks the payment went to the member's wallet for the right amount.</p>
        {a.cashouts.length > 0 && (
          <ul className="card mt-4 divide-y divide-[var(--line)]">
            {a.cashouts.map((c) => (
              <li key={c.id} className="grid gap-3 p-4">
                <p>
                  <strong className="num">{formatNim(c.amountLuna)}</strong> <span className="muted">({formatMoney(c.amount, currency)})</span> to <span className="break-all font-mono text-[13.5px]">{c.address}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <input className="field min-w-[220px] flex-1 font-mono" aria-label="Transaction hash" placeholder="Transaction hash" value={tx[c.id] ?? ""} onChange={(e) => setTx({ ...tx, [c.id]: e.target.value })} />
                  <button type="button" className="btn btn-primary btn-sm" disabled={(tx[c.id] ?? "").length < 8} onClick={() => void act(`/api/admin/cashouts/${c.id}/paid`, { txHash: tx[c.id] }, "Marked as paid.")}>Mark paid</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const note = window.prompt("Why is this being returned to the jar?"); if (note) void act(`/api/admin/cashouts/${c.id}/reject`, { note }, "Returned to the jar."); }}>Return to jar</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="vault mt-12 p-6 md:p-8" aria-labelledby="pot">
        <h2 id="pot" className="display display-md">Referral pot</h2>
        {a.platform ? (
          <div className="mt-4">
            <PoolMeter pool={a.platform} currency={currency} />
          </div>
        ) : (
          <p className="muted mt-3">No pot yet.</p>
        )}
        <form
          className="mt-5 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void pay.start({ kind: "topup", amountNim: Number(potNim), target: "platform" }, () => toast("The referral pot was topped up."));
          }}
        >
          <label>
            <span className="eyebrow">Add NIM</span>
            <input className="field num mt-1.5 !text-[var(--ink)]" inputMode="decimal" value={potNim} onChange={(e) => setPotNim(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          <button type="submit" className="btn btn-gold" disabled={pay.busy || !(Number(potNim) >= 1)}>{pay.busy ? pay.stageText : "Top up the pot"}</button>
        </form>
        {pay.error && <p role="alert" className="mt-3 rounded-xl bg-[var(--danger-bg)] p-3 text-[var(--danger)]">{pay.error}</p>}
        {a.blockedReferrals.length > 0 && <p className="muted mt-4 text-[14px]">{a.blockedReferrals.length} referral(s) were blocked by the device guard or limits.</p>}
      </section>

      <section className="mt-12" aria-labelledby="rates">
        <h2 id="rates" className="display display-md">Exchange rate</h2>
        <p className="muted mt-2">NIM is ${a.rates.nimUsd} {a.rates.live ? "(live from the price API)" : "(a fallback: the price job hasn't succeeded yet)"}.</p>
        <form
          className="mt-4 flex max-w-[420px] gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act("/api/admin/rates", { nimUsd: Number(rate) }, "Rate set.");
          }}
        >
          <input className="field num" aria-label="NIM in US dollars" inputMode="decimal" placeholder="0.0025" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))} />
          <button type="submit" className="btn btn-ghost" disabled={!(Number(rate) > 0)}>Set by hand</button>
        </form>
      </section>

      <section className="mt-12" aria-labelledby="jobs">
        <h2 id="jobs" className="display display-md">Scheduled jobs</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {a.jobNames.map((n) => (
            <button key={n} type="button" className="btn btn-ghost btn-sm" onClick={() => void act(`/api/admin/jobs/${n}`, {}, `Ran ${n}.`)}>
              <Play aria-hidden="true" size={14} /> Run {n}
            </button>
          ))}
        </div>
        <ul className="card mt-5 divide-y divide-[var(--line)]">
          {a.jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-baseline justify-between gap-2 p-3 text-[14.5px]">
              <span><strong>{j.name}</strong> <span className={j.ok ? "text-[var(--leaf)]" : "text-[var(--danger)]"}>{j.ok ? "ok" : "failed"}</span> · {j.detail}</span>
              <span className="muted">{new Date(j.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            </li>
          ))}
          {a.jobs.length === 0 && <li className="muted p-4">No runs yet.</li>}
        </ul>
      </section>
      {pay.dialog}
    </div>
  );
}
