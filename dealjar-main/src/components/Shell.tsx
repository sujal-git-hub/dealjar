import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { Home, Percent, PiggyBank, Landmark, UserRound } from "lucide-react";
import { Avatar } from "@/components/account";
import { useAuth } from "@/lib/auth";

const TABS = [
  { to: "/", label: "Home", Icon: Home, end: true },
  { to: "/deals", label: "Deals", Icon: Percent },
  { to: "/jar", label: "Jar", Icon: PiggyBank },
  { to: "/funding", label: "Funding", Icon: Landmark },
  { to: "/me", label: "Me", Icon: UserRound },
];

/** The icon: a thin-lined jar with a slim marigold cap and two coins, on ink. */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="18" fill="#17120e" />
      <rect x="21" y="12" width="22" height="6" rx="3" fill="#ffb100" />
      <path d="M23 18v3c-5 2-8 5-8 10v17c0 5 3 8 8 8h18c5 0 8-3 8-8V31c0-5-3-8-8-10v-3" fill="none" stroke="#fff7ea" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="32" cy="50" rx="9" ry="2.6" fill="#ffb100" />
      <ellipse cx="32" cy="45" rx="9" ry="2.6" fill="#ff6a2b" />
    </svg>
  );
}

/** "dealjar" with the j set apart: italic serif, in ember. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={"display tracking-[-0.045em] " + className} aria-label="DealJar">
      <span aria-hidden="true">
        deal<span className="serif -mx-[0.04em] text-[1.3em] !font-normal leading-none text-[var(--ember)]">j</span>ar
      </span>
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { me } = useAuth();
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-full focus:bg-[var(--ink)] focus:px-4 focus:py-2 focus:text-[var(--paper)]">
        Skip to content
      </a>
      <div className="app-col min-h-dvh">
        <header className="flex h-16 items-center justify-between px-[18px] md:px-8">
          <NavLink to="/" className="flex items-center gap-2.5" aria-label="DealJar home">
            <Logo />
            <Wordmark className="text-[24px]" />
          </NavLink>
          {me?.user ? (
            <NavLink to="/me" aria-label="My account" className="flex items-center gap-2">
              <Avatar imageKey={me.user.avatarKey} name={me.user.name} size={36} />
            </NavLink>
          ) : (
            <NavLink to="/signin" className="btn btn-ghost btn-sm">
              Sign in
            </NavLink>
          )}
        </header>
        <main id="main" className="pb-[calc(120px+env(safe-area-inset-bottom))] md:pb-24" key={pathname}>
          {children}
        </main>
      </div>
      <nav aria-label="Main" className="app-nav">
        <div className="app-nav-items">
          {TABS.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `flex min-h-[64px] flex-col items-center justify-center gap-1 text-[12.5px] font-semibold transition-colors ${isActive ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}
            >
              {({ isActive }) => (
                <>
                  <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${isActive ? "bg-[var(--marigold)]" : ""}`}>
                    <Icon aria-hidden="true" size={22} strokeWidth={isActive ? 2.4 : 2} />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
