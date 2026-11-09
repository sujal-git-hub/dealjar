import { bigint, boolean, doublePrecision, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Money is stored as integers: Luna for NIM (1 NIM = 100_000 Luna) and micro-USD for rewards, pots and the jar
// (1_000_000 = $1). Both fit a JS number exactly, so no rounding error can make a pot promise more than it holds.
const luna = (name: string) => bigint(name, { mode: "number" });
const micro = (name: string) => bigint(name, { mode: "number" });
const now = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  address: text("address").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("member"), // member | admin
  username: text("username"), // the public @handle, unique ignoring case; null until the person chooses one
  usernameChangedAt: timestamp("username_changed_at", { withTimezone: true }),
  avatarKey: text("avatar_key"),
  bannerKey: text("banner_key"),
  bio: text("bio").notNull().default(""),
  links: text("links").notNull().default("[]"), // JSON [{label,url}], https only (shared/profile.ts)
  accent: text("accent").notNull().default(""),
  currency: text("currency").notNull().default("USD"),
  goalName: text("goal_name").notNull().default("My first goal"),
  goalTarget: micro("goal_target").notNull().default(100_000_000),
  referralCode: text("referral_code").unique(),
  referredBy: text("referred_by"),
  showStats: boolean("show_stats").notNull().default(true), // show totals on the public profile
  suspended: boolean("suspended").notNull().default(false),
  createdAt: now(),
});

export const sponsors = pgTable("sponsors", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  handle: text("handle").notNull().unique(), // = the owner's username: the page lives at /s/<handle>
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  bio: text("bio").notNull().default(""),
  payoutAddress: text("payout_address").notNull(), // where customers pay for deals
  verified: boolean("verified").notNull().default(false),
  status: text("status").notNull().default("pending"), // pending | active | suspended
  avatarKey: text("avatar_key"),
  bannerKey: text("banner_key"),
  links: text("links").notNull().default("[]"),
  demo: boolean("demo").notNull().default(false),
  createdAt: now(),
});

export const pools = pgTable("pools", {
  id: text("id").primaryKey(),
  sponsorId: text("sponsor_id").notNull().unique(), // "platform" is the referral pot
  funded: micro("funded").notNull().default(0),
  committed: micro("committed").notNull().default(0),
  paid: micro("paid").notNull().default(0),
  perPersonCap: micro("per_person_cap").notNull().default(10_000_000),
  createdAt: now(),
});

export const poolLedger = pgTable("pool_ledger", {
  id: text("id").primaryKey(),
  poolId: text("pool_id").notNull(),
  kind: text("kind").notNull(), // deposit | reserve | payout | release
  amount: micro("amount").notNull(),
  note: text("note").notNull().default(""),
  refId: text("ref_id"),
  createdAt: now(),
});

export const deals = pgTable("deals", {
  id: text("id").primaryKey(),
  sponsorId: text("sponsor_id").notNull(),
  poolId: text("pool_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  category: text("category").notNull().default("Groceries"),
  priceLuna: luna("price_luna").notNull(),
  rewardBps: integer("reward_bps").notNull().default(0), // 1200 = 12%
  rewardMax: micro("reward_max").notNull().default(5_000_000),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  community: boolean("community").notNull().default(false),
  bannerKey: text("banner_key"),
  hue: integer("hue").notNull().default(160),
  status: text("status").notNull().default("live"), // live | hidden | removed
  createdAt: now(),
});

/** A payment someone is about to make (a purchase, or a sponsor topping up a pot), matched on-chain by its memo. */
export const paymentIntents = pgTable("payment_intents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(), // purchase | topup
  sponsorId: text("sponsor_id").notNull(),
  dealId: text("deal_id"),
  amountLuna: luna("amount_luna").notNull(),
  recipient: text("recipient").notNull(),
  memo: text("memo").notNull(), // <= 64 bytes, goes on-chain with the payment
  status: text("status").notNull().default("pending"), // pending | confirmed | failed
  txHash: text("tx_hash"),
  failReason: text("fail_reason"),
  rewardMicro: micro("reward_micro").notNull().default(0), // reserved from the pot when the intent was made
  rewardState: text("reward_state").notNull().default("none"), // none | reserved | paid | released
  nimUsd: doublePrecision("nim_usd"), // the rate used to turn the payment into dollars
  createdAt: now(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
});

export const jarEntries = pgTable("jar_entries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  asset: text("asset").notNull(), // USDT | EURE | XAUT0
  micro: micro("micro").notNull(), // value in micro-USD at the time; negative when moved out
  source: text("source").notNull(), // reward | referral | swap | cashout
  label: text("label").notNull(),
  refId: text("ref_id"),
  createdAt: now(),
});

export const cashouts = pgTable("cashouts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  amount: micro("amount").notNull(), // micro-USD taken out of the jar
  amountLuna: luna("amount_luna").notNull(),
  address: text("address").notNull(),
  status: text("status").notNull().default("pending"), // pending | paid | rejected
  txHash: text("tx_hash"),
  note: text("note"),
  createdAt: now(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export const referrals = pgTable("referrals", {
  id: text("id").primaryKey(),
  referrerId: text("referrer_id").notNull(),
  refereeId: text("referee_id").notNull().unique(),
  deviceHash: text("device_hash").notNull(),
  status: text("status").notNull().default("pending"), // pending | paid | blocked
  reason: text("reason"),
  reward: micro("reward").notNull().default(0),
  createdAt: now(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export const prices = pgTable("prices", {
  key: text("key").primaryKey(), // nim_usd | usd_eur | xau_usd
  value: doublePrecision("value").notNull(),
  source: text("source").notNull().default("fallback"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reports = pgTable("reports", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  dealId: text("deal_id").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"), // open | actioned | dismissed
  createdAt: now(),
});

export const jobRuns = pgTable("job_runs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ok: boolean("ok").notNull(),
  detail: text("detail").notNull().default(""),
  ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authChallenges = pgTable("auth_challenges", {
  nonce: text("nonce").primaryKey(),
  message: text("message").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
});
