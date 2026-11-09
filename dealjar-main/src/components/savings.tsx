import { useState } from "react";
import { ShieldAlert, ShieldCheck, Shield, TriangleAlert } from "lucide-react";
import { ASSET_LIST, ASSETS, PASSPORT_ROWS } from "@shared/assets";
import { formatMoney, isThin, priceImpact, tokensFor, toUnits, usd } from "@shared/money";
import type { Asset, AssetId, Currency } from "@shared/types";
import { Sheet } from "@/components/ui";

const RISK = {
  low: { text: "Lower risk", Icon: ShieldCheck, cls: "tag-ok" },
  medium: { text: "Medium risk", Icon: Shield, cls: "tag-low" },
  high: { text: "Higher risk", Icon: ShieldAlert, cls: "tag-off" },
} as const;

export function RiskTag({ asset }: { asset: Asset }) {
  const r = RISK[asset.passport.risk];
  return (
    <span className={`tag ${r.cls}`}>
      <r.Icon aria-hidden="true" size={15} /> {r.text}
    </span>
  );
}

/** The "Asset Passport": what it is, who is behind it, its price, how it's built, how to get out, who can hold it. */
export function PassportSheet({ asset, open, onClose }: { asset: Asset | null; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open && !!asset} onClose={onClose} title={asset ? asset.name : "Passport"} label="Asset passport">
      {asset && (
        <>
          <RiskTag asset={asset} />
          <dl className="mt-5 grid gap-4">
            {PASSPORT_ROWS.map((r) => (
              <div key={r.key} className="border-b border-[var(--line)] pb-4 last:border-0">
                <dt className="eyebrow">{r.label}</dt>
                <dd className="mt-1">{String(asset.passport[r.key])}</dd>
              </div>
            ))}
          </dl>
          {!asset.passport.reviewed && (
            <p className="mt-2 flex gap-3 rounded-2xl bg-[#fff0c7] p-4 text-[15px] text-[#4b3500]">
              <TriangleAlert aria-hidden="true" size={20} className="mt-0.5 shrink-0" />
              <span>These labels are a first draft, written from public descriptions. They haven't been checked against the issuer's own documents yet, so read the issuer's page before you rely on them.</span>
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Move some of the dollars in the jar into euros or gold. The risks are shown before the button, not after. */
export function SaveSheet({ open, onClose, dollars, currency, onSave }: { open: boolean; onClose: () => void; dollars: number; currency: Currency; onSave: (asset: AssetId, micro: number) => void }) {
  const choices = ASSET_LIST.filter((a) => a.id !== "USDT");
  const [assetId, setAssetId] = useState<AssetId>("EURE");
  const [amount, setAmount] = useState("");
  const [ack, setAck] = useState(false);
  const [passport, setPassport] = useState(false);

  const asset = ASSETS[assetId];
  const n = Number(amount);
  const micro = usd(Number.isFinite(n) ? n : 0);
  const valid = Number.isFinite(n) && n > 0 && micro <= dollars;
  const thin = valid && isThin(asset, n);
  const impact = valid ? priceImpact(asset, n) : 0;

  return (
    <>
      <Sheet open={open && !passport} onClose={onClose} title="Save some of your jar" label="Move into something else">
        <p className="muted">You hold {formatMoney(dollars, currency)} in dollars. Pick where some of it should go, and read the passport first.</p>
        <fieldset className="mt-5 grid gap-3">
          <legend className="eyebrow mb-1">Where to</legend>
          {choices.map((a) => (
            <label key={a.id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 ${assetId === a.id ? "border-[var(--ink)] bg-white" : "border-[var(--line)]"}`}>
              <input type="radio" name="asset" className="mt-1.5 h-5 w-5 accent-[var(--ink)]" checked={assetId === a.id} onChange={() => setAssetId(a.id)} />
              <span className="min-w-0 flex-1">
                <span className="display display-sm flex items-center gap-2">
                  <span aria-hidden="true" className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: a.color }} />
                  {a.name}
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <RiskTag asset={a} />
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <button type="button" className="mt-3 font-semibold underline decoration-2 underline-offset-4" onClick={() => setPassport(true)}>
          Read the {asset.short.toLowerCase()} passport
        </button>

        <label className="mt-6 block">
          <span className="eyebrow">How many dollars</span>
          <input className="field num mt-1.5" inputMode="decimal" placeholder="e.g. 20" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
        {valid && (
          <div className="mt-3 rounded-2xl bg-white p-4 text-[15.5px]">
            <p>
              About <strong className="num">{tokensFor(asset, micro).toLocaleString("en-US", { maximumFractionDigits: assetId === "XAUT0" ? 5 : 2 })} {asset.short.toLowerCase()}</strong>, worth {formatMoney(micro, currency)} today.
            </p>
            <p className="muted mt-1">Swap cost on this size: about {(impact * 100).toFixed(2)}%. Prices shown are illustrative in this demo.</p>
            {thin && (
              <p className="mt-3 flex gap-2 rounded-xl bg-[#fff0c7] p-3 text-[#4b3500]">
                <TriangleAlert aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
                <span>
                  <strong>Thin market.</strong> This size would move the price by more than 1%. Try a smaller amount.
                </span>
              </p>
            )}
          </div>
        )}
        {amount && !valid && <p role="alert" className="mt-2 text-[15px] text-[var(--danger)]">You can move up to {formatMoney(dollars, currency)} ({toUnits(dollars).toFixed(2)} dollars).</p>}

        <label className="mt-6 flex cursor-pointer gap-3">
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[var(--ink)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span className="text-[15.5px]">I've read the passport. I understand the price of {asset.short.toLowerCase()} can go up or down, and that nobody promises it will rise.</span>
        </label>
        <button
          type="button"
          className="btn btn-primary mt-6 w-full"
          disabled={!valid || !ack || thin}
          onClick={() => {
            onSave(assetId, micro);
            setAmount("");
            setAck(false);
            onClose();
          }}
        >
          Save it
        </button>
        <p className="muted mt-3 text-[14px]">In the real app your wallet asks you to confirm this swap. Here, in the demo, nothing leaves your device.</p>
      </Sheet>
      <PassportSheet asset={asset} open={passport} onClose={() => setPassport(false)} />
    </>
  );
}
