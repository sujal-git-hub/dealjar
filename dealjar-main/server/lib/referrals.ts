import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { PLATFORM, payDirect } from "./pools";
import type { SessionUser } from "./session";

const { referrals, users, pools, jarEntries, paymentIntents } = schema;

export class ReferralError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** What each side of a referral earns, from the capped referral pot. */
export const referralReward = () => Math.max(0, Number(process.env.REFERRAL_REWARD_MICRO ?? 2_000_000) | 0);
/** The most one person can earn by inviting. */
export const MAX_PAID_REFERRALS = 20;
/** A referral link only works for a brand new account. */
const NEW_ACCOUNT_HOURS = 48;

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
export const newReferralCode = () => "JAR-" + Array.from(randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join("");

/**
 * The device guard. The app keeps a random id in the browser's storage and sends it with a referral claim; only a
 * salted hash is stored. It cannot stop a determined person (they can clear storage), but it stops the easy abuse:
 * one phone making many accounts to pay itself from the pot. The pot's cap and the per-referrer limit bound the rest.
 */
export function hashDevice(deviceId: string): string {
  const salt = process.env.SESSION_SECRET ?? "dealjar-dev-secret-change-me";
  return createHash("sha256").update(`${salt}:${deviceId}`).digest("hex");
}

export async function claimReferral(user: SessionUser, code: string, deviceId: string) {
  if (!/^[0-9a-zA-Z-]{16,64}$/.test(deviceId)) throw new ReferralError("Could not check this device");
  const db = await getDb();
  if (user.referredBy) throw new ReferralError("You already used a referral link");
  if (Date.now() - user.createdAt.getTime() > NEW_ACCOUNT_HOURS * 3_600_000) throw new ReferralError("Referral links only work for new accounts");
  const [referrer] = await db.select().from(users).where(eq(users.referralCode, code.trim().toUpperCase())).limit(1);
  if (!referrer || referrer.suspended) throw new ReferralError("That referral code doesn't exist", 404);
  if (referrer.id === user.id) throw new ReferralError("You can't refer yourself");

  const deviceHash = hashDevice(deviceId);
  const [seen] = await db.select({ id: referrals.id }).from(referrals).where(eq(referrals.deviceHash, deviceHash)).limit(1);
  if (seen) {
    // Recorded for the admin's review, but never paid.
    await db.insert(referrals).values({ id: newId(), referrerId: referrer.id, refereeId: user.id, deviceHash, status: "blocked", reason: "This device already took part in a referral" }).onConflictDoNothing();
    throw new ReferralError("This device has already been used for a referral, so this one can't earn a reward");
  }
  await db.transaction(async (tx) => {
    await tx.insert(referrals).values({ id: newId(), referrerId: referrer.id, refereeId: user.id, deviceHash, status: "pending" });
    await tx.update(users).set({ referredBy: referrer.id }).where(eq(users.id, user.id));
  });
  return { ok: true, referrer: referrer.username ?? referrer.displayName, perFriend: referralReward() };
}

/**
 * After someone's confirmed purchase: if they were referred and it hasn't paid yet, both people get a reward from the
 * referral pot, in one transaction (both or neither). If the pot can't afford it, nothing is promised and the cron job
 * tries again after the pot is topped up.
 */
export async function payReferralsFor(refereeId: string): Promise<"paid" | "none" | "unfunded"> {
  const db = await getDb();
  const [ref] = await db.select().from(referrals).where(and(eq(referrals.refereeId, refereeId), eq(referrals.status, "pending"))).limit(1);
  if (!ref) return "none";
  const [bought] = await db.select({ n: sql<number>`count(*)::int` }).from(paymentIntents).where(and(eq(paymentIntents.userId, refereeId), eq(paymentIntents.kind, "purchase"), eq(paymentIntents.status, "confirmed")));
  if ((bought?.n ?? 0) < 1) return "none";
  const reward = referralReward();
  if (reward <= 0) return "none";
  const [referrer] = await db.select().from(users).where(eq(users.id, ref.referrerId)).limit(1);
  if (!referrer || referrer.suspended) {
    await db.update(referrals).set({ status: "blocked", reason: "Referrer unavailable" }).where(eq(referrals.id, ref.id));
    return "none";
  }
  const [paidCount] = await db.select({ n: sql<number>`count(*)::int` }).from(referrals).where(and(eq(referrals.referrerId, ref.referrerId), eq(referrals.status, "paid")));
  if ((paidCount?.n ?? 0) >= MAX_PAID_REFERRALS) {
    await db.update(referrals).set({ status: "blocked", reason: "Referral limit reached" }).where(eq(referrals.id, ref.id));
    return "none";
  }
  const [pot] = await db.select().from(pools).where(eq(pools.sponsorId, PLATFORM)).limit(1);
  if (!pot) return "unfunded";
  try {
    await db.transaction(async (tx) => {
      const claimed = await tx.update(referrals).set({ status: "paid", reward, paidAt: new Date() }).where(and(eq(referrals.id, ref.id), eq(referrals.status, "pending"))).returning({ id: referrals.id });
      if (!claimed.length) return;
      if (!(await payDirect(tx, pot.id, reward, "Referral reward: a new member", ref.id))) throw new ReferralError("unfunded");
      if (!(await payDirect(tx, pot.id, reward, "Referral reward: the member who invited them", ref.id))) throw new ReferralError("unfunded");
      await tx.insert(jarEntries).values([
        { id: newId(), userId: refereeId, asset: "USDT", micro: reward, source: "referral", label: "Referral · you joined with a friend's link", refId: ref.id },
        { id: newId(), userId: ref.referrerId, asset: "USDT", micro: reward, source: "referral", label: "Referral · a friend took their first deal", refId: ref.id },
      ]);
    });
  } catch (e) {
    if (e instanceof ReferralError) return "unfunded";
    throw e;
  }
  return "paid";
}

/** Cron: pays referrals that were waiting for the pot to be topped up. */
export async function retryUnpaidReferrals(): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ refereeId: referrals.refereeId }).from(referrals).where(eq(referrals.status, "pending")).limit(50);
  let paid = 0;
  for (const r of rows) if ((await payReferralsFor(r.refereeId)) === "paid") paid++;
  return paid;
}

export async function referralSummary(user: SessionUser) {
  const db = await getDb();
  const rows = await db.select().from(referrals).where(eq(referrals.referrerId, user.id));
  const [pot] = await db.select().from(pools).where(eq(pools.sponsorId, PLATFORM)).limit(1);
  return {
    code: user.referralCode,
    invited: rows.filter((r) => r.status !== "blocked").length,
    paid: rows.filter((r) => r.status === "paid").length,
    earned: rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.reward, 0),
    perFriend: referralReward(),
    potFunded: pot?.funded ?? 0,
    potPaid: pot?.paid ?? 0,
    referredBy: !!user.referredBy,
  };
}
