import { Link, Navigate, useParams } from "react-router";
import { BadgeCheck, ExternalLink, Pencil } from "lucide-react";
import { useSponsorPage, usePublicUser } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Avatar, Banner } from "@/components/account";
import { DealCard, PoolMeter } from "@/components/deals";
import { available } from "@shared/rewards";
import { formatMoney } from "@shared/money";
import type { ProfileLink } from "@shared/profile";

const NotHere = ({ what }: { what: string }) => (
  <div className="wrap pt-10">
    <h1 className="display display-lg">
      {what} isn't <span className="serif">here.</span>
    </h1>
    <Link to="/" className="btn btn-primary mt-6">
      Back home
    </Link>
  </div>
);

function Links({ links }: { links: ProfileLink[] }) {
  if (!links.length) return null;
  return (
    <ul className="mt-4 flex flex-wrap gap-2">
      {links.map((l) => (
        <li key={l.url}>
          <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="chip">
            {l.label} <ExternalLink aria-hidden="true" size={14} className="ml-1.5" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A member's public page: only what they chose to show. Never an address or what they bought. */
export function UserPage() {
  const { username = "" } = useParams();
  const { currency } = useAuth();
  const q = usePublicUser(username);
  if (q.isLoading) return <p className="wrap muted pt-10">Loading…</p>;
  if (q.data?.sponsorHandle) return <Navigate to={`/s/${q.data.sponsorHandle}`} replace />;
  if (!q.data?.user) return <NotHere what="That person" />;
  const { user, stats, isMe } = q.data;
  return (
    <div>
      <Banner imageKey={user.bannerKey} hue={210} className="h-36 border-b-2 border-[var(--ink)] md:h-56" />
      <div className="wrap -mt-12">
        <Avatar imageKey={user.avatarKey} name={user.name} size={96} className="bg-[var(--paper)]" />
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="display display-lg">{user.name}</h1>
            <p className="muted">@{user.username}</p>
          </div>
          {isMe && (
            <Link to="/me/edit" className="btn btn-ghost btn-sm">
              <Pencil aria-hidden="true" size={16} /> Edit profile
            </Link>
          )}
        </div>
        {user.bio && <p className="lede mt-4">{user.bio}</p>}
        <Links links={user.links} />
        {stats && (
          <dl className="mt-8 grid max-w-[420px] grid-cols-2 gap-4">
            <div className="card p-5">
              <dt className="eyebrow">Deals taken</dt>
              <dd className="display mt-1 text-[34px] leading-none num">{stats.dealsTaken}</dd>
            </div>
            <div className="card p-5">
              <dt className="eyebrow">Earned back</dt>
              <dd className="display mt-1 text-[34px] leading-none num">{formatMoney(stats.earnedMicro, currency)}</dd>
            </div>
          </dl>
        )}
        <p className="muted mt-8 text-[14px]">Joined {new Date(user.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
      </div>
    </div>
  );
}

/** A sponsor's page: who they are, the pot behind their deals, and the deals. */
export function SponsorPage() {
  const { handle = "" } = useParams();
  const { currency } = useAuth();
  const q = useSponsorPage(handle);
  if (q.isLoading) return <p className="wrap muted pt-10">Loading…</p>;
  if (!q.data) return <NotHere what="That sponsor" />;
  const { sponsor, deals, pool, isMine, status } = q.data;
  return (
    <div>
      <Banner imageKey={sponsor.bannerKey} hue={40} className="h-36 border-b-2 border-[var(--ink)] md:h-56" />
      <div className="wrap -mt-12">
        <Avatar imageKey={sponsor.avatarKey} name={sponsor.name} size={96} className="bg-[var(--paper)]" />
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="display display-lg flex flex-wrap items-center gap-3">
              {sponsor.name}
              {sponsor.verified && (
                <span className="tag tag-ok">
                  <BadgeCheck aria-hidden="true" size={15} /> Verified
                </span>
              )}
              {sponsor.demo && <span className="tag tag-demo">Demo</span>}
            </h1>
            <p className="muted">@{sponsor.handle}</p>
          </div>
          {isMine && (
            <Link to="/studio" className="btn btn-ghost btn-sm">
              <Pencil aria-hidden="true" size={16} /> Manage in studio
            </Link>
          )}
        </div>
        {status !== "active" && <p className="mt-4 rounded-2xl bg-[var(--paper-2)] p-4">This page is {status === "pending" ? "waiting for approval" : status}. Only you can see it.</p>}
        {sponsor.blurb ? <p className="lede mt-4">{sponsor.blurb}</p> : null}
        {sponsor.bio && sponsor.bio !== sponsor.blurb && <p className="mt-3 max-w-[60ch]">{sponsor.bio}</p>}
        <Links links={sponsor.links} />

        {pool && (
          <section className="vault mt-10 p-6 md:p-8" aria-labelledby="pot">
            <h2 id="pot" className="eyebrow">
              The reward pot
            </h2>
            <p className="display display-md mt-2">{formatMoney(available(pool), currency)} still free to promise</p>
            <div className="mt-5">
              <PoolMeter pool={pool} currency={currency} />
            </div>
            <p className="muted mt-4 text-[14.5px]">Rewards are only ever paid from this pot. When it's empty, the deals still work, with no cashback.</p>
          </section>
        )}

        <section className="mt-12" aria-labelledby="deals">
          <h2 id="deals" className="display display-md">
            Deals
          </h2>
          {deals.length === 0 ? (
            <p className="muted mt-3">No deals right now.</p>
          ) : (
            <div className="rail mt-5">
              {deals.map((d) => (
                <div key={d.id}>{pool && <DealCard deal={d} pool={pool} sponsor={sponsor} currency={currency} />}</div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
