import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { fetchChainTx, sameAddress } from "./nimiq";
import { getRates, microToLuna } from "./rates";
import { ASSETS } from "@shared/assets";
import { isThin, toUnits, usd } from "@shared/money";
import type { AssetId, JarEntry } from "@shared/types";
import type { SessionUser } from "./session";

const { jarEntries, cashouts } = schema;
const ASSET_IDS: AssetId[] = ["USDT", "EURE", "XAUT0"];

export class JarError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Dollars, euros and gold in the jar, as the value in micro-USD of what was put in. */
export async function holdingsOf(userId: string): Promise<Record<AssetId, number>> {
  const db = await getDb();
  const rows = await db
    .select({ asset: jarEntries.asset, total: sql<number>`coalesce(sum(${jarEntries.micro}), 0)::float8` })
    .from(jarEntries)
    .where(eq(jarEntries.userId, userId))
    .groupBy(jarEntries.asset);
  const out: Record<AssetId, number> = { USDT: 0, EURE: 0, XAUT0: 0 };
  for (const r of rows) if (r.asset in out) out[r.asset as AssetId] = Math.round(Number(r.total));
  return out;
}

export async function jarOf(user: SessionUser) {
  const db = await getDb();
  const rows = await db.select().from(jarEntries).where(eq(jarEntries.userId, user.id)).orderBy(desc(jarEntries.createdAt)).limit(150);
  const entries: (JarEntry & { id: string })[] = rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), label: r.label, asset: r.asset as AssetId, micro: r.micro, source: r.source as JarEntry["source"] }));
  return {
    holdings: await holdingsOf(user.id),
    goal: { name: user.goalName, target: user.goalTarget },
    entries,
  };
}

/**
 * Move value between dollars, euros and gold. IMPORTANT: today this is a TRACKED conversion at the current rates (a
 * bookkeeping move inside the jar), not an on-chain swap. The Save passport labels are still drafts, and no swap
 * provider is connected, so the jar says so in plain words wherever it offers this.
 */
export async function convert(user: SessionUser, from: AssetId, to: AssetId, amount: number) {
  if (!ASSET_IDS.includes(from) || !ASSET_IDS.includes(to) || from === to) throw new JarError("Choose two different things to move between");
  if (!Number.isInteger(amount) || amount < usd(0.5)) throw new JarError("The smallest move is $0.50");
  const db = await getDb();
  const dest = ASSETS[to];
  if (isThin(dest, toUnits(amount))) throw new JarError("That is too much for this market right now. Try a smaller amount.");
  return db.transaction(async (tx) => {
    // Serialise this person's jar moves so two quick taps can't both spend the same balance.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`);
    const [bal] = await tx
      .select({ total: sql<number>`coalesce(sum(${jarEntries.micro}), 0)::float8` })
      .from(jarEntries)
      .where(and(eq(jarEntries.userId, user.id), eq(jarEntries.asset, from)));
    if (Number(bal?.total ?? 0) < amount) throw new JarError("There isn't that much in there");
    const ref = newId();
    await tx.insert(jarEntries).values([
      { id: newId(), userId: user.id, asset: from, micro: -amount, source: "swap", label: `Moved into ${ASSETS[to].short.toLowerCase()}`, refId: ref },
      { id: newId(), userId: user.id, asset: to, micro: amount, source: "swap", label: `Saved into ${ASSETS[to].short.toLowerCase()}`, refId: ref },
    ]);
    return { ok: true, tracked: true };
  });
}

const MIN_CASHOUT = usd(1);

/** Asks to cash out: the value leaves the jar now and is paid in NIM to the member's own wallet by the operator. */
export async function requestCashout(user: SessionUser, asset: AssetId, amount: number) {
  if (!ASSET_IDS.includes(asset)) throw new JarError("Choose what to cash out");
  if (!Number.isInteger(amount) || amount < MIN_CASHOUT) throw new JarError("The smallest cash-out is $1");
  const db = await getDb();
  const rates = await getRates();
  const amountLuna = microToLuna(amount, rates.nimUsd);
  if (amountLuna < 100_000) throw new JarError("That is less than 1 NIM");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`);
    const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(cashouts).where(and(eq(cashouts.userId, user.id), eq(cashouts.status, "pending")));
    if ((open?.n ?? 0) >= 3) throw new JarError("You have a few cash-outs waiting already", 429);
    const [bal] = await tx
      .select({ total: sql<number>`coalesce(sum(${jarEntries.micro}), 0)::float8` })
      .from(jarEntries)
      .where(and(eq(jarEntries.userId, user.id), eq(jarEntries.asset, asset)));
    if (Number(bal?.total ?? 0) < amount) throw new JarError("There isn't that much in there");
    const id = newId();
    await tx.insert(jarEntries).values({ id: newId(), userId: user.id, asset, micro: -amount, source: "cashout", label: "Cash-out requested", refId: id });
    await tx.insert(cashouts).values({ id, userId: user.id, amount, amountLuna, address: user.address, status: "pending" });
    return { id, amountLuna };
  });
}

export async function cashoutsOf(userId: string) {
  const db = await getDb();
  const rows = await db.select().from(cashouts).where(eq(cashouts.userId, userId)).orderBy(desc(cashouts.createdAt)).limit(50);
  return rows.map((r) => ({ id: r.id, amount: r.amount, amountLuna: r.amountLuna, status: r.status, txHash: r.txHash, note: r.note, at: r.createdAt.toISOString(), paidAt: r.paidAt?.toISOString() ?? null }));
}

/** Admin: mark a cash-out paid. When a node is configured the transaction is checked (right wallet, enough NIM). */
export async function markCashoutPaid(id: string, txHash: string) {
  const db = await getDb();
  const [row] = await db.select().from(cashouts).where(eq(cashouts.id, id)).limit(1);
  if (!row) throw new JarError("Cash-out not found", 404);
  if (row.status !== "pending") throw new JarError("This cash-out is already settled");
  if (!/^[0-9a-zA-Z-]{8,128}$/.test(txHash)) throw new JarError("That doesn't look like a transaction hash");
  if (process.env.NIMIQ_RPC_URL && !txHash.startsWith("demo-")) {
    const found = await fetchChainTx(txHash);
    if (!found.ok) throw new JarError(found.reason === "not_found" ? "The network can't see that transaction yet" : "Could not check that transaction right now", 409);
    if (!found.tx.executed || !sameAddress(found.tx.to, row.address)) throw new JarError("That transaction didn't pay this member's wallet");
    if (found.tx.valueLuna < Math.floor(row.amountLuna * 0.99)) throw new JarError("That transaction is for less than the cash-out");
  }
  await db.update(cashouts).set({ status: "paid", txHash, paidAt: new Date() }).where(and(eq(cashouts.id, id), eq(cashouts.status, "pending")));
  return { ok: true };
}

/** Admin: reject a cash-out; the value goes straight back into the jar. */
export async function rejectCashout(id: string, note: string) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const flipped = await tx.update(cashouts).set({ status: "rejected", note }).where(and(eq(cashouts.id, id), eq(cashouts.status, "pending"))).returning();
    const row = flipped[0];
    if (!row) throw new JarError("Cash-out not found or already settled", 404);
    const [orig] = await tx.select().from(jarEntries).where(and(eq(jarEntries.refId, id), eq(jarEntries.source, "cashout"))).limit(1);
    await tx.insert(jarEntries).values({ id: newId(), userId: row.userId, asset: orig?.asset ?? "USDT", micro: row.amount, source: "cashout", label: "Cash-out returned to your jar", refId: id });
  });
  return { ok: true };
}
