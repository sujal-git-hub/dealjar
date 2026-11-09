import { and, eq, gt, lt, ne, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { fetchAddressTxs, fetchChainTx, sameAddress, type ChainLookup, type ChainTx } from "./nimiq";
import { getRates, lunaToMicro } from "./rates";
import { dealView } from "./views";
import { earnedFromPool, payDirect, poolShape, release, reserve, settle as settlePool, deposit } from "./pools";
import { payReferralsFor } from "./referrals";
import { rewardOffer } from "@shared/rewards";
import { MAX_LUNA, nimToLuna } from "@shared/units";
import type { SessionUser } from "./session";

const { paymentIntents, deals, sponsors, pools, jarEntries } = schema;
export type Intent = typeof paymentIntents.$inferSelect;

export class PaymentError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Demo payments skip the chain. Only ever enabled explicitly, never in production. */
export const demoPaymentsEnabled = () => process.env.DEALJAR_DEMO_PAYMENTS === "1";

/** A reservation that is not paid within this long goes back to the pot (a late payment is still honoured, if the pot can pay). */
export const RESERVATION_MINUTES = Number(process.env.RESERVATION_MINUTES ?? 60);
const MAX_OPEN = 3;

/**
 * Starts a purchase: checks the deal, works out the reward from the REAL pot (shared/rewards.ts) and reserves it
 * so two people cannot be promised the same money. The reward is only paid once the payment is verified on-chain.
 */
export async function createPurchase(user: SessionUser, dealId: string): Promise<Intent> {
  const db = await getDb();
  const rates = await getRates();
  const [row] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!row || row.status !== "live") throw new PaymentError("Deal not found", 404);
  const [sponsor] = await db.select().from(sponsors).where(eq(sponsors.id, row.sponsorId)).limit(1);
  if (!sponsor || sponsor.status !== "active") throw new PaymentError("This sponsor is not available", 404);
  if (row.expiresAt.getTime() <= Date.now()) throw new PaymentError("This deal has ended");
  if (sponsor.userId === user.id) throw new PaymentError("You can't buy your own deal");
  if (sponsor.demo && !demoPaymentsEnabled()) throw new PaymentError("Demo sponsor: real payments are disabled");
  if (row.priceLuna <= 0 || row.priceLuna > MAX_LUNA) throw new PaymentError("This deal's price is outside what DealJar allows");

  const [open] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.userId, user.id), eq(paymentIntents.kind, "purchase"), eq(paymentIntents.status, "pending"), gt(paymentIntents.createdAt, new Date(Date.now() - RESERVATION_MINUTES * 60_000))));
  if ((open?.n ?? 0) >= MAX_OPEN) throw new PaymentError("You have a few purchases still open. Finish or wait for them first.", 429);

  const id = newId();
  const memo = `DJ:${id}`; // 15 bytes, well under the 64-byte on-chain limit
  return db.transaction(async (tx) => {
    const [poolRow] = await tx.select().from(pools).where(eq(pools.id, row.poolId)).limit(1);
    let reward = 0;
    if (poolRow) {
      const earned = await earnedFromPool(tx, poolRow.id, user.id);
      reward = rewardOffer(dealView(row, rates), poolShape(poolRow), earned);
      if (reward > 0 && !(await reserve(tx, poolRow.id, reward, `Reserved while a purchase is verified: ${row.title}`, id))) reward = 0;
    }
    const intent: Intent = {
      id,
      userId: user.id,
      kind: "purchase",
      sponsorId: sponsor.id,
      dealId: row.id,
      amountLuna: row.priceLuna,
      recipient: sponsor.payoutAddress,
      memo,
      status: "pending",
      txHash: null,
      failReason: null,
      rewardMicro: reward,
      rewardState: reward > 0 ? "reserved" : "none",
      nimUsd: rates.nimUsd,
      createdAt: new Date(),
      confirmedAt: null,
    };
    await tx.insert(paymentIntents).values(intent);
    return intent;
  });
}

/** A sponsor putting money into their reward pot: paid in NIM to the pot address, credited in dollars at the rate of the day. */
export async function createTopup(user: SessionUser, sponsorId: string, amountNim: number): Promise<Intent> {
  const pot = process.env.POOL_ADDRESS?.trim();
  if (!pot) throw new PaymentError("Pot funding is not set up on this server yet", 503);
  const amountLuna = nimToLuna(amountNim);
  if (!Number.isFinite(amountLuna) || amountLuna < nimToLuna(1) || amountLuna > MAX_LUNA) throw new PaymentError(`Choose between 1 and ${(MAX_LUNA / 100_000).toLocaleString("en-US")} NIM`);
  const db = await getDb();
  const rates = await getRates();
  const id = newId();
  const intent: Intent = {
    id,
    userId: user.id,
    kind: "topup",
    sponsorId,
    dealId: null,
    amountLuna,
    recipient: pot,
    memo: `DP:${id}`,
    status: "pending",
    txHash: null,
    failReason: null,
    rewardMicro: 0,
    rewardState: "none",
    nimUsd: rates.nimUsd,
    createdAt: new Date(),
    confirmedAt: null,
  };
  await db.insert(paymentIntents).values(intent);
  return intent;
}

export type ConfirmResult = { status: "confirmed" | "pending" | "failed"; reason?: string };

export async function confirmIntent(user: SessionUser, intentId: string, txHash: string): Promise<ConfirmResult> {
  const db = await getDb();
  const [intent] = await db.select().from(paymentIntents).where(and(eq(paymentIntents.id, intentId), eq(paymentIntents.userId, user.id))).limit(1);
  if (!intent) throw new PaymentError("Payment not found", 404);
  if (intent.status === "confirmed") return { status: "confirmed" };
  if (!/^[0-9a-zA-Z-]{8,128}$/.test(txHash)) throw new PaymentError("Invalid transaction hash");
  return settleIntent(intent, txHash);
}

/** For a payment made by hand from any wallet: find it by its memo, then report where the intent stands. */
export async function checkIntent(user: SessionUser, intentId: string): Promise<ConfirmResult> {
  const db = await getDb();
  const load = async () => (await db.select().from(paymentIntents).where(and(eq(paymentIntents.id, intentId), eq(paymentIntents.userId, user.id))).limit(1))[0];
  const report = (i: Intent): ConfirmResult | null => (i.status === "confirmed" ? { status: "confirmed" } : i.status === "failed" ? { status: "failed", reason: i.failReason ?? "Payment could not be verified." } : null);
  const intent = await load();
  if (!intent) throw new PaymentError("Payment not found", 404);
  const done = report(intent);
  if (done) return done;
  await reconcilePending({ userId: user.id }, 2500);
  const after = await load();
  return (after && report(after)) ?? { status: "pending" };
}

/** The one set of rules that decides whether a transaction pays for an intent. */
async function settleIntent(intent: Intent, txHash: string, known?: ChainTx): Promise<ConfirmResult> {
  const db = await getDb();
  const [dupe] = await db
    .select({ id: paymentIntents.id })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.txHash, txHash), eq(paymentIntents.status, "confirmed"), ne(paymentIntents.id, intent.id)))
    .limit(1);
  if (dupe) return fail(intent, "This transaction was already used");

  if (txHash.startsWith("demo-")) {
    if (!demoPaymentsEnabled()) return fail(intent, "Demo payments are disabled");
  } else {
    const found: ChainLookup = known ? { ok: true, tx: known } : await fetchChainTx(txHash);
    if (!found.ok) {
      if (found.reason === "not_found" || found.reason === "rpc_error") return { status: "pending", reason: found.reason };
      return { status: "pending", reason: "NIMIQ_RPC_URL is not configured on the server" };
    }
    const { tx } = found;
    if (!tx.executed) return fail(intent, "Transaction failed on-chain");
    if (!sameAddress(tx.to, intent.recipient)) return fail(intent, "Paid to the wrong address");
    if (tx.valueLuna < intent.amountLuna) return fail(intent, "Amount too low");
    if (tx.memo !== intent.memo) return fail(intent, "Payment reference does not match");
    if (tx.confirmations < 1) return { status: "pending", reason: "waiting_for_confirmation" };
  }
  await finalize(intent, txHash);
  return { status: "confirmed" };
}

/** Marks the intent paid and does what it was for, all in one transaction so a crash can't leave half of it done. */
async function finalize(intent: Intent, txHash: string) {
  const db = await getDb();
  const nimUsd = intent.nimUsd ?? (await getRates()).nimUsd; // looked up before the transaction opens: it must not wait on a second connection
  await db.transaction(async (tx) => {
    // Only the caller that flips pending -> confirmed gets to pay anything out.
    const claimed = await tx
      .update(paymentIntents)
      .set({ status: "confirmed", txHash, confirmedAt: new Date(), failReason: null })
      .where(and(eq(paymentIntents.id, intent.id), eq(paymentIntents.status, "pending")))
      .returning({ id: paymentIntents.id });
    if (!claimed.length) return;

    if (intent.kind === "topup") {
      const [poolRow] = await tx.select({ id: pools.id }).from(pools).where(eq(pools.sponsorId, intent.sponsorId)).limit(1);
      if (poolRow) await deposit(tx, poolRow.id, lunaToMicro(intent.amountLuna, nimUsd), `Sponsor deposit of ${(intent.amountLuna / 100_000).toLocaleString("en-US")} NIM`, intent.id);
      return;
    }

    const [deal] = intent.dealId ? await tx.select().from(deals).where(eq(deals.id, intent.dealId)).limit(1) : [];
    if (!deal) return;
    let reward = 0;
    if (intent.rewardState === "reserved" && intent.rewardMicro > 0) {
      if (await settlePool(tx, deal.poolId, intent.rewardMicro, `Reward paid for: ${deal.title}`, intent.id)) reward = intent.rewardMicro;
    } else if (intent.rewardState === "released" && intent.rewardMicro > 0) {
      // The reservation had lapsed before the payment showed up. Pay it only if the pot can still afford it.
      if (await payDirect(tx, deal.poolId, intent.rewardMicro, `Late payment, reward paid for: ${deal.title}`, intent.id)) reward = intent.rewardMicro;
    }
    await tx.update(paymentIntents).set({ rewardState: reward > 0 ? "paid" : "none", rewardMicro: reward }).where(eq(paymentIntents.id, intent.id));
    if (reward > 0) await tx.insert(jarEntries).values({ id: newId(), userId: intent.userId, asset: "USDT", micro: reward, source: "reward", label: `Reward · ${deal.title}`, refId: intent.id });
  });
  if (intent.kind === "purchase") await payReferralsFor(intent.userId).catch(() => {});
}

async function fail(intent: Intent, reason: string): Promise<ConfirmResult> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const flipped = await tx
      .update(paymentIntents)
      .set({ status: "failed", failReason: reason })
      .where(and(eq(paymentIntents.id, intent.id), eq(paymentIntents.status, "pending")))
      .returning({ id: paymentIntents.id });
    if (flipped.length) await freeReservation(tx, intent);
  });
  return { status: "failed", reason };
}

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

/** Gives a reserved reward back to its pot. */
async function freeReservation(tx: Tx, intent: Intent) {
  if (intent.rewardState !== "reserved" || intent.rewardMicro <= 0 || !intent.dealId) return;
  const [deal] = await tx.select({ poolId: deals.poolId }).from(deals).where(eq(deals.id, intent.dealId)).limit(1);
  if (deal) await release(tx, deal.poolId, intent.rewardMicro, "Purchase was not verified, so the money returned to the pot", intent.id);
  await tx.update(paymentIntents).set({ rewardState: "released" }).where(eq(paymentIntents.id, intent.id));
}

/**
 * Finds payments the app never heard back about: a payment sent on-chain but never confirmed here is matched by its
 * memo from the recipient's recent incoming transactions, then settled with exactly the same checks as a normal
 * confirmation. Throttled per scope, and a no-op with nothing pending.
 */
const lastReconcile = new Map<string, number>();
export async function reconcilePending(scope: { userId?: string; sponsorId?: string }, minGapMs = 20_000): Promise<number> {
  const key = scope.userId ? `u:${scope.userId}` : scope.sponsorId ? `s:${scope.sponsorId}` : "all";
  const now = Date.now();
  if (now - (lastReconcile.get(key) ?? 0) < minGapMs) return 0;
  const db = await getDb();
  const rows = await db
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.status, "pending"), gt(paymentIntents.createdAt, new Date(now - 7 * 86_400_000)), scope.userId ? eq(paymentIntents.userId, scope.userId) : undefined, scope.sponsorId ? eq(paymentIntents.sponsorId, scope.sponsorId) : undefined))
    .limit(40);
  if (!rows.length) return 0;
  lastReconcile.set(key, now);

  let settled = 0;
  const byRecipient = new Map<string, Intent[]>();
  for (const r of rows) byRecipient.set(r.recipient, [...(byRecipient.get(r.recipient) ?? []), r]);
  for (const [recipient, intents] of byRecipient) {
    const found = await fetchAddressTxs(recipient);
    if (!found.ok) continue;
    for (const intent of intents) {
      const tx = found.txs.find((t) => t.memo === intent.memo && t.hash && sameAddress(t.to, intent.recipient));
      if (!tx?.hash) continue;
      if ((await settleIntent(intent, tx.hash, tx)).status === "confirmed") settled++;
    }
  }
  return settled;
}

/** Recovery that never holds a page up for long. */
export async function reconcileSoon(scope: { userId?: string; sponsorId?: string }, ms = 3000): Promise<void> {
  await Promise.race([reconcilePending(scope).catch(() => 0), new Promise((r) => setTimeout(r, ms))]);
}

/** Cron: gives reserved rewards back to their pots when the payment has not arrived in time; abandons very old intents. */
export async function expireReservations(): Promise<{ released: number; abandoned: number }> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - RESERVATION_MINUTES * 60_000);
  const stale = await db.select().from(paymentIntents).where(and(eq(paymentIntents.status, "pending"), eq(paymentIntents.rewardState, "reserved"), lt(paymentIntents.createdAt, cutoff))).limit(200);
  let released = 0;
  for (const i of stale) {
    await db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, i.id)).limit(1);
      if (fresh?.status === "pending" && fresh.rewardState === "reserved") {
        await freeReservation(tx, fresh);
        released++;
      }
    });
  }
  const old = await db
    .update(paymentIntents)
    .set({ status: "failed", failReason: "Not paid in time" })
    .where(and(eq(paymentIntents.status, "pending"), lt(paymentIntents.createdAt, new Date(Date.now() - 7 * 86_400_000))))
    .returning({ id: paymentIntents.id });
  return { released, abandoned: old.length };
}

