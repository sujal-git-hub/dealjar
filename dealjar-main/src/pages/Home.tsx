import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router";
import { ArrowRight, BadgeCheck, Handshake, Landmark } from "lucide-react";
import { available, rewardState } from "@shared/rewards";
import { formatMoney } from "@shared/money";
import { Jar } from "@/components/Jar";
import { DealCard, PoolMeter } from "@/components/deals";
import { Magnetic, Marquee, Money, SectionTitle } from "@/components/ui";
import { useCatalog } from "@/lib/api";
import { gsap, prefersReducedMotion, useReveal } from "@/lib/motion";
import { useJar } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usd } from "@shared/money";

function Hero() {
  const root = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (prefersReducedMotion() || !root.current) return;
    const ctx = gsap.context(() => {
      gsap.from("[data-w]", { yPercent: 115, rotate: 4, duration: 1.1, ease: "power4.out", stagger: 0.09, delay: 0.1 });
      gsap.from("[data-hero-fade]", { opacity: 0, y: 24, duration: 0.9, ease: "power3.out", stagger: 0.12, delay: 0.55 });
    }, root);
    return () => ctx.revert();
  }, []);
  const word = (w: string, cls = "") => (
    <span className="inline-block overflow-hidden align-bottom pb-[0.12em] pr-[0.12em] -mb-[0.12em] -mr-[0.12em]">
      <span data-w className={`inline-block ${cls}`}>
        {w}
      </span>
    </span>
  );
  return (
    <h1 ref={root} className="display display-xl">
      <span className="sr-only">Every deal fills a jar.</span>
      <span aria-hidden="true">
        {word("Every")} {word("deal")}
        <br />
        {word("fills", "serif !font-normal text-[var(--ember)] !tracking-[-0.03em] text-[1.06em]")} {word("a")} {word("jar.")}
      </span>
    </h1>
  );
}

export default function HomePage() {
  const { currency, signedIn } = useAuth();
  const jarQ = useJar(signedIn);
  const cat = useCatalog();
  const h = jarQ.data?.holdings ?? { USDT: 0, EURE: 0, XAUT0: 0 };
  const goal = jarQ.data?.goal ?? { name: "Your first goal", target: usd(100) };
  const total = h.USDT + h.EURE + h.XAUT0;
  const progress = goal.target > 0 ? Math.min(100, Math.round((total / goal.target) * 100)) : 0;
  const ref = useReveal<HTMLDivElement>();

  const fresh = useMemo(() => {
    const d = cat.data;
    if (!d) return [];
    const pool = (id: string) => d.pools.find((p) => p.id === id)!;
    const rank = { funded: 0, low: 1, empty: 2, expired: 3 } as const;
    return [...d.deals].sort((a, b) => rank[rewardState(a, pool(a.poolId))] - rank[rewardState(b, pool(b.poolId))]).slice(0, 4);
  }, [cat.data]);

  const lead = cat.data?.pools[0];

  return (
    <div ref={ref}>
      {/* hero */}
      <section className="wrap pt-6 md:pt-12 lg:grid lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-10">
        <div>
          <p data-hero-fade className="eyebrow mb-5">
            Deals · Savings · Honest rewards
          </p>
          <Hero />
          <p data-hero-fade className="lede mt-7">
            Take a deal and the reward goes into your jar, in euros, gold or dollars you choose. Every reward comes from money a sponsor has already put up.
          </p>
          <div data-hero-fade className="mt-8 flex flex-wrap gap-3">
            <Magnetic>
              <Link to="/deals" className="btn btn-primary">
                See today's deals <ArrowRight aria-hidden="true" size={20} />
              </Link>
            </Magnetic>
            <Link to="/funding" className="btn btn-ghost">
              Where rewards come from
            </Link>
          </div>
        </div>

        <div data-hero-fade className="relative mx-auto mt-10 w-full max-w-[380px] lg:mt-0 lg:max-w-[460px]">
          <Jar holdings={h} target={goal.target} label={`Your jar holds ${formatMoney(total, currency)}`} />
          <Link to={signedIn ? "/jar" : "/signin?next=/jar"} className="card mx-auto -mt-1 block w-[88%] px-5 py-4 text-center shadow-[0_18px_0_-10px_rgb(23_18_14/0.12)]">
            <p className="eyebrow">{signedIn ? "In your jar" : "Your jar is empty"}</p>
            <p className="display text-[34px] leading-none">
              <Money micro={total} currency={currency} />
            </p>
            <p className="muted mt-1 text-[14.5px]">
              {signedIn ? (<>{progress}% of “{goal.name}”</>) : "Sign in to start filling it"}
            </p>
          </Link>
        </div>
      </section>

      {/* sponsors */}
      <section aria-label="Sponsors" className="mt-20 border-y border-[var(--line)] py-5">
        <Marquee items={cat.data?.sponsors.map((s) => s.name) ?? ["Casa Verde Market", "Sahel Mobile", "Costa Café Co-op"]} />
      </section>

      {/* deals */}
      <section className="wrap mt-20" aria-labelledby="fresh">
        <div data-reveal>
          <SectionTitle
            id="fresh"
            action={
              <Link to="/deals" className="font-semibold underline decoration-2 underline-offset-4">
                All deals
              </Link>
            }
          >
            Fresh <span className="serif">deals</span>
          </SectionTitle>
        </div>
        <div className="rail">
          {cat.data &&
            fresh.map((d, i) => {
              const pool = cat.data.pools.find((p) => p.id === d.poolId)!;
              return (
                <div key={d.id} data-reveal style={{ ["--d" as string]: i }}>
                  <DealCard deal={d} pool={pool} sponsor={cat.data.sponsors.find((s) => s.id === d.sponsorId)} currency={currency} />
                </div>
              );
            })}
        </div>
      </section>

      {/* how it works */}
      <section className="wrap mt-24" aria-labelledby="how">
        <div data-reveal>
          <p className="eyebrow">How it works</p>
          <h2 id="how" className="display display-lg mt-2">
            Three steps. <span className="serif">No small print.</span>
          </h2>
        </div>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            ["1", "Take a deal", "Pick an offer from a sponsor or a neighbour. You pay the merchant straight from your wallet."],
            ["2", "We check it", "The app only counts a purchase it can see on the Nimiq network, linked by a note on the payment. No proof, no reward."],
            ["3", "Your jar fills", "The reward is paid from the sponsor's pot, and you choose to keep it as dollars or save it in euros or gold."],
          ].map(([n, t, b], i) => (
            <li key={n} data-reveal style={{ ["--d" as string]: i }} className="card p-7">
              <span className="serif block text-[84px] leading-[0.8] text-[var(--ember)]">{n}</span>
              <h3 className="display display-sm mt-6">{t}</h3>
              <p className="muted mt-2">{b}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* honest by design */}
      <section className="wrap mt-24" aria-labelledby="honest">
        <div className="vault p-7 md:p-12 lg:grid lg:grid-cols-[1fr_1fr] lg:gap-14">
          <div data-reveal className="relative">
            <p className="eyebrow">Honest by design</p>
            <h2 id="honest" className="display display-lg mt-3">
              We never promise a reward <span className="serif text-[var(--marigold)]">we can't pay.</span>
            </h2>
            <ul className="mt-8 grid gap-5">
              {[
                [Landmark, "Funded first", "A sponsor puts the money in a public pot before a deal goes live. The deal shows how much is left."],
                [BadgeCheck, "Verified before paid", "A reward is only paid for a purchase the app can see on-chain. Otherwise the deal still works, with no cashback."],
                [Handshake, "You can see the books", "Every deposit, reservation and payout is in a public ledger."],
              ].map(([Icon, t, b]) => {
                const I = Icon as typeof Landmark;
                return (
                  <li key={t as string} className="flex gap-4">
                    <I aria-hidden="true" size={26} className="mt-1 shrink-0 text-[var(--marigold)]" />
                    <p>
                      <strong className="display display-sm block">{t as string}</strong>
                      <span className="muted">{b as string}</span>
                    </p>
                  </li>
                );
              })}
            </ul>
            <Link to="/funding" className="btn btn-gold mt-9">
              Open the ledger <ArrowRight aria-hidden="true" size={20} />
            </Link>
          </div>
          <div data-reveal style={{ ["--d" as string]: 2 }} className="relative mt-10 rounded-[26px] border border-[rgb(246_234_215/0.18)] p-6 lg:mt-0">
            {lead && (
              <>
                <p className="eyebrow">A real pool, up close</p>
                <p className="display display-sm mt-2">Casa Verde Market</p>
                <div className="mt-5">
                  <PoolMeter pool={lead} currency={currency} />
                </div>
                <p className="muted mt-5 text-[15px]">Only {formatMoney(available(lead), currency)} is still free to promise. When it's gone, the deal says so and stops offering cashback.</p>
              </>
            )}
          </div>
        </div>
      </section>

      {/* referral */}
      <section className="wrap mt-24" aria-label="Invite friends">
        <div data-reveal className="card grid gap-6 p-7 md:grid-cols-[1fr_auto] md:items-center md:p-10" style={{ background: "linear-gradient(135deg, #ffd166, #ffb100)" }}>
          <div>
            <h2 className="display display-md">
              Bring a friend. <span className="serif">Fill two jars.</span>
            </h2>
            <p className="mt-2 max-w-[44ch]">When a friend takes their first deal, you both get a small reward from a capped pot. One per person.</p>
          </div>
          <Link to="/me#friends" className="btn btn-primary">
            Get my link
          </Link>
        </div>
      </section>

      <footer className="wrap mt-24 pb-6 text-[14.5px] text-[var(--muted)]">
        <p>DealJar is a demo. Every merchant, deal and balance here is invented, and nothing can be bought. Prices and exchange rates are illustrative.</p>
        <p className="mt-2">Open source under MIT. Built for the Nimiq Mini Apps Competition, Save category.</p>
      </footer>
    </div>
  );
}
