import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader, Plus, Trash2 } from "lucide-react";
import { api, useMyProfile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Avatar, ImageField } from "@/components/account";
import { useToast } from "@/components/toast";
import { CURRENCIES, type Currency } from "@shared/types";
import { MAX_LINKS } from "@shared/profile";
import { toUnits, usd } from "@shared/money";
import { USERNAME_MESSAGES, usernameProblem } from "@shared/username";

/** Your public profile: pictures, name, bio, links, goal and what's shown about you. */
export default function ProfileEditPage() {
  const { signedIn, loading, me, refresh } = useAuth();
  const prof = useMyProfile(signedIn);
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [links, setLinks] = useState<{ label: string; url: string }[]>([]);
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [showStats, setShowStats] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uname, setUname] = useState("");
  const [unameError, setUnameError] = useState("");

  const p = prof.data;
  useEffect(() => {
    if (!p) return;
    // fill the form once the profile has loaded
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(p.name);
    setBio(p.bio);
    setLinks(p.links);
    setGoalName(p.goal.name);
    setGoalTarget(String(toUnits(p.goal.target)));
    setCurrency((CURRENCIES as string[]).includes(p.currency) ? (p.currency as Currency) : "USD");
    setShowStats(p.showStats);
    setUname(p.username ?? "");
  }, [p]);

  if (loading) return <p className="wrap muted pt-10">Loading…</p>;
  if (!signedIn) return <Navigate to="/signin?next=/me/edit" replace />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const t = Number(goalTarget);
    if (!Number.isFinite(t) || t < 1) return setError("A goal is at least $1.");
    setBusy(true);
    try {
      await api("/api/me", { displayName: name, bio, links, goalName, goalTarget: usd(t), currency, showStats }, "PATCH");
      toast("Saved.");
      await qc.invalidateQueries();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changeUsername(e: React.FormEvent) {
    e.preventDefault();
    setUnameError("");
    const u = uname.trim().toLowerCase();
    const problem = usernameProblem(u);
    if (problem) return setUnameError(USERNAME_MESSAGES[problem]);
    try {
      await api("/api/me/username", { username: u }, "PUT");
      toast("Username changed.");
      await qc.invalidateQueries();
      await refresh();
    } catch (err) {
      setUnameError((err as Error).message);
    }
  }

  return (
    <div className="wrap pt-4 md:pt-10">
      <Link to="/me" className="inline-flex items-center gap-2 font-semibold">
        <ArrowLeft aria-hidden="true" size={18} /> Me
      </Link>
      <h1 className="display display-lg mt-4">
        Edit <span className="serif">profile</span>
      </h1>
      {!p ? (
        <p className="muted mt-6">Loading…</p>
      ) : (
        <div className="mt-8 grid max-w-[720px] gap-8">
          <section className="card grid gap-6 p-7" aria-label="Pictures">
            <ImageField label="Banner" current={p.bannerKey} path="/api/me/art/banner" hint="Wide picture across the top of your page." />
            <ImageField label="Profile picture" current={p.avatarKey} path="/api/me/art/avatar" shape="round">
              <Avatar name={p.name} size={96} className="!border-0" />
            </ImageField>
          </section>

          <form className="card grid gap-5 p-7" onSubmit={(e) => void save(e)}>
            <label>
              <span className="eyebrow">Display name</span>
              <input className="field mt-1.5" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              <span className="eyebrow">Bio</span>
              <textarea className="field mt-1.5 min-h-[96px] py-3" value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} />
              <span className="muted text-[13.5px]">{bio.length}/160</span>
            </label>
            <fieldset className="grid gap-3">
              <legend className="eyebrow">Links (https only)</legend>
              {links.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                  <input className="field" aria-label={`Link ${i + 1} label`} placeholder="Label" value={l.label} maxLength={24} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <input className="field" aria-label={`Link ${i + 1} address`} placeholder="https://" value={l.url} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                  <button type="button" className="btn btn-ghost btn-sm !px-3" aria-label={`Remove link ${i + 1}`} onClick={() => setLinks(links.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </div>
              ))}
              {links.length < MAX_LINKS && (
                <div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLinks([...links, { label: "", url: "" }])}>
                    <Plus aria-hidden="true" size={16} /> Add a link
                  </button>
                </div>
              )}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <label>
                <span className="eyebrow">What are you saving for?</span>
                <input className="field mt-1.5" value={goalName} maxLength={40} onChange={(e) => setGoalName(e.target.value)} />
              </label>
              <label>
                <span className="eyebrow">Target, in dollars</span>
                <input className="field num mt-1.5" inputMode="decimal" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value.replace(/[^0-9.]/g, ""))} />
              </label>
            </div>
            <label>
              <span className="eyebrow">Show money in</span>
              <select className="field mt-1.5" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1.5 h-5 w-5" checked={showStats} onChange={(e) => setShowStats(e.target.checked)} />
              <span>
                <strong>Show my totals on my public page</strong>
                <span className="muted block text-[14.5px]">How many deals you've taken and how much you've earned. Never your wallet or what you bought.</span>
              </span>
            </label>
            {error && (
              <p role="alert" className="text-[var(--danger)]">
                {error}
              </p>
            )}
            <div>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy && <Loader aria-hidden="true" size={18} className="animate-spin" />} Save changes
              </button>
            </div>
          </form>

          <form className="card grid gap-3 p-7" onSubmit={(e) => void changeUsername(e)}>
            <h2 className="display display-sm">Username</h2>
            <input className="field" value={uname} maxLength={20} aria-label="Username" autoCapitalize="none" spellCheck={false} onChange={(e) => setUname(e.target.value)} disabled={!p.canChangeUsername} />
            <p className="muted text-[14.5px]">{p.canChangeUsername ? "You can change it once a week. Your page address changes with it." : `You can change it again after ${p.nextUsernameChange ? new Date(p.nextUsernameChange).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "a week has passed"}.`}</p>
            {unameError && (
              <p role="alert" className="text-[var(--danger)]">
                {unameError}
              </p>
            )}
            <div>
              <button type="submit" className="btn btn-ghost btn-sm" disabled={!p.canChangeUsername || uname.trim().toLowerCase() === p.username}>
                Change username
              </button>
            </div>
          </form>
          {me?.user?.username && (
            <p>
              <Link to={`/u/${me.user.username}`} className="font-semibold underline decoration-2 underline-offset-4">
                See how your page looks
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
