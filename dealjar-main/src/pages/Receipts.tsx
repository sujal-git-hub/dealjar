import { Link, Navigate } from "react-router";
import { ArrowLeft } from "lucide-react";
import { useReceipts } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@shared/money";
import { formatNim } from "@shared/units";

/** What you paid, and what came back. */
export default function ReceiptsPage() {
  const { signedIn, loading, currency } = useAuth();
  const q = useReceipts(signedIn);
  if (loading) return <p className="wrap muted pt-10">Loading…</p>;
  if (!signedIn) return <Navigate to="/signin?next=/receipts" replace />;
  const rows = q.data?.receipts ?? [];
  return (
    <div className="wrap pt-4 md:pt-10">
      <Link to="/me" className="inline-flex items-center gap-2 font-semibold">
        <ArrowLeft aria-hidden="true" size={18} /> Me
      </Link>
      <h1 className="display display-lg mt-4">
        <span className="serif">Receipts</span>
      </h1>
      {q.isLoading ? (
        <p className="muted mt-6">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted mt-6">
          Nothing yet. <Link to="/deals" className="font-semibold underline decoration-2 underline-offset-4">Take a deal.</Link>
        </p>
      ) : (
        <ul className="card mt-8 divide-y divide-[var(--line)]">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div className="min-w-[200px] flex-1">
                <p className="font-semibold">{r.item}</p>
                <p className="muted text-[14.5px]">
                  {r.sponsor} · {new Date(r.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
                {r.txHash && <p className="muted break-all font-mono text-[12px]">{r.txHash}</p>}
              </div>
              <div className="text-right">
                <p className="num font-semibold">{formatNim(r.amountLuna)}</p>
                {r.rewardMicro > 0 && <p className="num text-[14.5px] text-[var(--leaf)]">+{formatMoney(r.rewardMicro, currency)} reward</p>}
                <span className={`tag mt-1 ${r.status === "confirmed" ? "tag-ok" : "tag-low"}`}>{r.status === "confirmed" ? "Confirmed" : "Being checked"}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
