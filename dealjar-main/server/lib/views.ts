import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getRates, lunaToMicro, type Rates } from "./rates";
import { poolShape } from "./pools";
import type { Deal, DealCategory, LedgerEntry, Pool, Sponsor } from "@shared/types";
import { readLinks } from "@shared/profile";

const { deals, sponsors, pools, poolLedger } = schema;

export const dealView = (r: typeof deals.$inferSelect, rates: Rates): Deal => ({
  id: r.id,
  sponsorId: r.sponsorId,
  poolId: r.poolId,
  title: r.title,
  summary: r.summary,
  category: r.category as DealCategory,
  price: lunaToMicro(r.priceLuna, rates.nimUsd),
  priceLuna: r.priceLuna,
  rewardRate: r.rewardBps / 10_000,
  rewardMax: r.rewardMax,
  expiresAt: r.expiresAt.toISOString(),
  community: r.community,
  hue: r.hue,
  bannerKey: r.bannerKey,
});

export const sponsorView = (r: typeof sponsors.$inferSelect): Sponsor => ({
  id: r.id,
  name: r.name,
  blurb: r.tagline || r.bio.slice(0, 90),
  demo: r.demo,
  handle: r.handle,
  avatarKey: r.avatarKey,
  bannerKey: r.bannerKey,
  verified: r.verified,
});

/** A sponsor's full public page data (the same for everyone). */
export const sponsorPage = (r: typeof sponsors.$inferSelect) => ({ ...sponsorView(r), bio: r.bio, links: readLinks(r.links), joinedAt: r.createdAt.toISOString() });

/** What anyone may see: live deals from active sponsors, their pots, and the sponsors themselves. */
export async function catalog(): Promise<{ deals: Deal[]; pools: Pool[]; sponsors: Sponsor[]; rates: { nimUsd: number; live: boolean } }> {
  const db = await getDb();
  const rates = await getRates();
  const active = await db.select().from(sponsors).where(eq(sponsors.status, "active"));
  if (!active.length) return { deals: [], pools: [], sponsors: [], rates: { nimUsd: rates.nimUsd, live: rates.live } };
  const ids = active.map((s) => s.id);
  const dealRows = await db
    .select()
    .from(deals)
    .where(and(inArray(deals.sponsorId, ids), eq(deals.status, "live")))
    .orderBy(desc(deals.createdAt))
    .limit(200);
  const poolRows = await db.select().from(pools).where(inArray(pools.sponsorId, ids));
  return { deals: dealRows.map((d) => dealView(d, rates)), pools: poolRows.map(poolShape), sponsors: active.map(sponsorView), rates: { nimUsd: rates.nimUsd, live: rates.live } };
}

/** The public ledger: every deposit, reservation, payout and release, newest first. The platform referral pot is included. */
export async function publicLedger(limit = 150): Promise<LedgerEntry[]> {
  const db = await getDb();
  const rows = await db.select().from(poolLedger).orderBy(desc(poolLedger.createdAt)).limit(limit);
  return rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), kind: r.kind as LedgerEntry["kind"], poolId: r.poolId, amount: r.amount, note: r.note }));
}

/** The referral pot as the public sees it. */
export async function platformPool() {
  const db = await getDb();
  const [row] = await db.select().from(pools).where(eq(pools.sponsorId, "platform")).limit(1);
  return row ? poolShape(row) : null;
}

/** Counts used on public profiles: never addresses, never individual purchases. */
export async function memberStats(userId: string) {
  const db = await getDb();
  const [taken] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.paymentIntents)
    .where(and(eq(schema.paymentIntents.userId, userId), eq(schema.paymentIntents.kind, "purchase"), eq(schema.paymentIntents.status, "confirmed")));
  const [earned] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.jarEntries.micro}), 0)::float8` })
    .from(schema.jarEntries)
    .where(and(eq(schema.jarEntries.userId, userId), ne(schema.jarEntries.source, "swap"), sql`${schema.jarEntries.micro} > 0`));
  return { dealsTaken: Number(taken?.n ?? 0), earnedMicro: Number(earned?.total ?? 0) };
}
