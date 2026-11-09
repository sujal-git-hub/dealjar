import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { Check, Loader, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { takeReferral } from "@/lib/session";
import { USERNAME_MAX, usernameProblem, USERNAME_MESSAGES } from "@shared/username";

type Remote = { u: string; available: boolean; message?: string };

/** The one step every new account takes: choose a public @username (and, if you like, a name). */
export default function WelcomePage() {
  const { me, loading, refresh } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next")?.startsWith("/") ? params.get("next")! : "/";
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [remote, setRemote] = useState<Remote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // the format rules are checked right here, instantly; only "is it taken?" needs the server
  const u = username.trim().toLowerCase();
  const problem = u ? usernameProblem(u) : null;
  useEffect(() => {
    if (!u || problem) return;
    const t = window.setTimeout(() => {
      api<{ available: boolean; message?: string }>(`/api/username/check?u=${encodeURIComponent(u)}`)
        .then((r) => setRemote({ u, available: r.available, message: r.message }))
        .catch(() => {});
    }, 350);
    return () => window.clearTimeout(t);
  }, [u, problem]);
  const check: { state: "idle" | "checking" | "ok" | "bad"; message?: string } = !u ? { state: "idle" } : problem ? { state: "bad", message: USERNAME_MESSAGES[problem] } : remote?.u === u ? (remote.available ? { state: "ok" } : { state: "bad", message: remote.message }) : { state: "checking" };

  if (loading) return <p className="wrap muted pt-10">Loading…</p>;
  if (!me?.user) return <Navigate to="/signin" replace />;
  if (!me.user.needsUsername) return <Navigate to={next} replace />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/me/username", { username: username.trim().toLowerCase() }, "PUT");
      if (name.trim().length >= 2) await api("/api/me", { displayName: name.trim() }, "PATCH");
      await refresh();
      nav(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const friend = takeReferral();
  return (
    <div className="wrap pt-4 md:pt-10">
      <p className="eyebrow">Welcome</p>
      <h1 className="display display-xl mt-2 !text-[clamp(40px,9vw,84px)]">
        Pick a <span className="serif text-[var(--ember)]">name.</span>
      </h1>
      <p className="lede mt-4">This is how other people see you. It can't be a wallet address, and you can change it later (once a week).</p>
      {friend && <p className="mt-4 rounded-2xl bg-[var(--leaf-bg)] p-4 text-[var(--leaf)]">You joined with a friend's link. You'll both get a small reward after your first deal.</p>}
      <form className="card mt-8 grid max-w-[560px] gap-5 p-7" onSubmit={(e) => void save(e)}>
        <label>
          <span className="eyebrow">Username</span>
          <div className="relative mt-1.5">
            <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]">
              @
            </span>
            <input className="field !pl-9" value={username} maxLength={USERNAME_MAX} onChange={(e) => setUsername(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="uname-status" />
          </div>
          <span id="uname-status" className="mt-2 flex min-h-[24px] items-center gap-2 text-[14.5px]" role="status">
            {check.state === "checking" && (
              <>
                <Loader aria-hidden="true" size={15} className="animate-spin" /> Checking…
              </>
            )}
            {check.state === "ok" && (
              <span className="flex items-center gap-1.5 text-[var(--leaf)]">
                <Check aria-hidden="true" size={15} /> @{username.trim().toLowerCase()} is yours
              </span>
            )}
            {check.state === "bad" && (
              <span className="flex items-center gap-1.5 text-[var(--danger)]">
                <X aria-hidden="true" size={15} /> {check.message}
              </span>
            )}
          </span>
        </label>
        <label>
          <span className="eyebrow">Display name (optional)</span>
          <input className="field mt-1.5" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="What should we call you?" />
        </label>
        {error && (
          <p role="alert" className="text-[var(--danger)]">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || check.state !== "ok"}>
          {busy && <Loader aria-hidden="true" size={18} className="animate-spin" />} Continue
        </button>
      </form>
    </div>
  );
}
