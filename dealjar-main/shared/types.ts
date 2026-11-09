// The shapes DealJar's screens and (later) its API share. Money is always an integer count of micro-units
// (1,000,000 = 1 USDT / 1 USD) so no rounding error can ever make a pool promise more than it holds.

export type Currency = "USD" | "EUR" | "CRC" | "GMD";
export const CURRENCIES: Currency[] = ["USD", "EUR", "CRC", "GMD"];

export type AssetId = "USDT" | "EURE" | "XAUT0";

/** The six things the Save section of the competition guide asks every savings option to show. */
export type Passport = {
  type: string; //    what kind of thing it is
  issuer: string; //  who holds the reserves, whether regulated, whether it can freeze
  peg: string; //     redeemable 1:1, market-pegged only, or a market asset
  contract: string; // age, audits, upgradeability, native or bridged
  exit: string; //    what selling costs and any wait
  who: string; //     who may hold it
  risk: "low" | "medium" | "high";
  /** Labels are a draft until someone has checked them against the issuer's own documents. */
  reviewed: boolean;
};

export type Asset = {
  id: AssetId;
  name: string;
  short: string;
  /** Price of one whole token in USD (illustrative in the demo; live prices later). */
  priceUsd: number;
  /** How much USD can be swapped before the price moves noticeably (drives the "thin" warning). */
  depthUsd: number;
  color: string;
  passport: Passport;
};

export type Sponsor = {
  id: string;
  name: string;
  /** The one-line description shown on cards. */
  blurb: string;
  demo: boolean;
  /** The sponsor page lives at /s/<handle>. Absent for the built-in mock data. */
  handle?: string;
  avatarKey?: string | null;
  bannerKey?: string | null;
  verified?: boolean;
};

/** A pot of real money a sponsor has put up for rewards. Nothing can be promised beyond it. */
export type Pool = {
  id: string;
  sponsorId: string;
  /** Total the sponsor has deposited. */
  funded: number;
  /** Reserved for purchases that are still being verified. */
  committed: number;
  /** Already paid out. */
  paid: number;
  /** The most one person can ever earn from this pool. */
  perPersonCap: number;
};

export type DealCategory = "Airtime & data" | "Groceries" | "Food" | "Travel" | "Learning";

export type Deal = {
  id: string;
  sponsorId: string;
  poolId: string;
  title: string;
  summary: string;
  category: DealCategory;
  /** Price in micro-USD. */
  price: number;
  /** Share of the price offered back as a reward, 0..1. */
  rewardRate: number;
  /** The most one purchase can earn, micro-USD. */
  rewardMax: number;
  expiresAt: string;
  community: boolean;
  hue: number;
  /** An uploaded banner (served from /api/img/<key>); without one the card is a generated colour. */
  bannerKey?: string | null;
  /** What the buyer pays, in Luna (1 NIM = 100,000 Luna). */
  priceLuna?: number;
};

export type LedgerEntry = {
  id: string;
  at: string;
  kind: "deposit" | "reserve" | "payout" | "release";
  poolId: string;
  amount: number;
  note: string;
};

export type JarEntry = { at: string; label: string; asset: AssetId; micro: number; source: "reward" | "referral" | "deposit" | "swap" | "cashout" };

/** Where one purchase is on its way to a reward. */
export type PurchaseState = "none" | "pending" | "verified" | "no-reward";
