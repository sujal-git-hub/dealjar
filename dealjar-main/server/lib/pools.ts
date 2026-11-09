import { and, eq, sql } from "drizzle-orm";
import { getDb, schema, type DB } from "./db";
import { newId } from "./ids";
import type { Pool as PoolShape } from "@shared/types";

/*
  The sponsor pots. Every change is ONE atomic statement that only succeeds if the pot can afford it, and the
  table itself has a CHECK constraint (committed + paid <= funded), so even a bug in this file cannot make a pot
  promise more than a sponsor deposited. The shared/rewards.ts rules decide what is on offer; this file moves money.
*/

type Tx = Pick<DB, "update" | "insert" | "select">;
const { pools, poolLedger } = schema;

export class PoolError extends Error {}

export const PLATFORM = "platform";

export const poolShape = (r: typeof pools.$inferSelect): PoolShape => ({ id: r.id, sponsorId: r.sponsorId, funded: r.funded, committed: r.committed, paid: r.paid, perPersonCap: r.perPersonCap });

async function note(tx: Tx, poolId: string, kind: "deposit" | "reserve" | "payout" | "release", amount: number, text: string, refId?: string) {
  await tx.insert(poolLedger).values({ id: newId(), poolId, kind, amount, note: text, refId: refId ?? null });
}

/** Creates a sponsor's pot (once). */
export async function ensurePool(tx: Tx, sponsorId: string, perPersonCap = 10_000_000): Promise<string> {
  const [existing] = await tx.select({ id: pools.id }).from(pools).where(eq(pools.sponsorId, sponsorId)).limit(1);
  if (existing) return existing.id;
  const id = newId();
  await tx.insert(pools).values({ id, sponsorId, perPersonCap }).onConflictDoNothing();
  const [row] = await tx.select({ id: pools.id }).from(pools).where(eq(pools.sponsorId, sponsorId)).limit(1);
  return row?.id ?? id;
}

/** Money in: a sponsor's confirmed deposit. */
export async function deposit(tx: Tx, poolId: string, amount: number, text: string, refId?: string) {
  if (!Number.isInteger(amount) || amount <= 0) throw new PoolError("A deposit must be a positive whole number of micro-dollars.");
  await tx.update(pools).set({ funded: sql`${pools.funded} + ${amount}` }).where(eq(pools.id, poolId));
  await note(tx, poolId, "deposit", amount, text, refId);
}

/** Sets money aside for a purchase that is being verified. Fails (returns false) rather than ever over-promising. */
export async function reserve(tx: Tx, poolId: string, amount: number, text: string, refId?: string): Promise<boolean> {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  const got = await tx
    .update(pools)
    .set({ committed: sql`${pools.committed} + ${amount}` })
    .where(and(eq(pools.id, poolId), sql`${pools.funded} - ${pools.committed} - ${pools.paid} >= ${amount}`))
    .returning({ id: pools.id });
  if (!got.length) return false;
  await note(tx, poolId, "reserve", amount, text, refId);
  return true;
}

/** A verified purchase: the reserved money becomes a payout. */
export async function settle(tx: Tx, poolId: string, amount: number, text: string, refId?: string): Promise<boolean> {
  const got = await tx
    .update(pools)
    .set({ committed: sql`${pools.committed} - ${amount}`, paid: sql`${pools.paid} + ${amount}` })
    .where(and(eq(pools.id, poolId), sql`${pools.committed} >= ${amount}`))
    .returning({ id: pools.id });
  if (!got.length) return false;
  await note(tx, poolId, "payout", amount, text, refId);
  return true;
}

/** A purchase that was never verified, or an expired reservation: the money goes back to the pot. */
export async function release(tx: Tx, poolId: string, amount: number, text: string, refId?: string): Promise<boolean> {
  const got = await tx
    .update(pools)
    .set({ committed: sql`${pools.committed} - ${amount}` })
    .where(and(eq(pools.id, poolId), sql`${pools.committed} >= ${amount}`))
    .returning({ id: pools.id });
  if (!got.length) return false;
  await note(tx, poolId, "release", amount, text, refId);
  return true;
}

/** Paid from the pot in one step (referral rewards, which need no verification window). */
export async function payDirect(tx: Tx, poolId: string, amount: number, text: string, refId?: string): Promise<boolean> {
  if (!(await reserve(tx, poolId, amount, text, refId))) return false;
  return settle(tx, poolId, amount, text, refId);
}

/** How much one person has earned (or has reserved) from a pot: counts against the per-person cap. */
export async function earnedFromPool(q: Pick<DB, "select">, poolId: string, userId: string): Promise<number> {
  const [row] = await q
    .select({ total: sql<number>`coalesce(sum(${schema.paymentIntents.rewardMicro}), 0)::float8` })
    .from(schema.paymentIntents)
    .innerJoin(schema.deals, eq(schema.deals.id, schema.paymentIntents.dealId))
    .where(and(eq(schema.paymentIntents.userId, userId), eq(schema.deals.poolId, poolId), sql`${schema.paymentIntents.rewardState} in ('reserved','paid')`));
  return Number(row?.total ?? 0);
}

export async function getPool(poolId: string) {
  const db = await getDb();
  const [row] = await db.select().from(pools).where(eq(pools.id, poolId)).limit(1);
  return row ?? null;
}
