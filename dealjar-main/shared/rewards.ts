// The one rule that matters: a reward is only ever promised out of money a sponsor has actually put up.
// Everything here is pure, so the same code runs in the app and on the server, and the tests pin it down.
import type { Deal, Pool } from "./types";

export type RewardState = "funded" | "low" | "empty" | "expired";

/** What is still free to promise: deposited, minus what is reserved for pending purchases, minus what is paid. */
export const available = (p: Pool): number => Math.max(0, p.funded - p.committed - p.paid);

/** Share of a pool that is still free, 0..1 (1 for a pool that was never funded would be wrong, so it is 0). */
export const freeShare = (p: Pool): number => (p.funded > 0 ? available(p) / p.funded : 0);

/** A pool is "low" when under a fifth is free, so people are told before it runs out, not after. */
export const LOW_SHARE = 0.2;

export function rewardState(deal: Deal, pool: Pool, now = Date.now()): RewardState {
  if (new Date(deal.expiresAt).getTime() <= now) return "expired";
  if (available(pool) <= 0) return "empty";
  // low: not even one full reward is left, or under a fifth of the pool is still free
  return available(pool) < ruleReward(deal) || freeShare(pool) < LOW_SHARE ? "low" : "funded";
}

/** What the deal's own rule would pay, ignoring the pool. */
export const ruleReward = (deal: Deal): number => Math.floor(Math.min(deal.price * deal.rewardRate, deal.rewardMax));

/**
 * The reward actually on offer for this deal right now: the rule's amount, capped by what the pool still has and
 * by what this person may still earn from it. Never negative, never more than the pool can pay.
 */
export function rewardOffer(deal: Deal, pool: Pool, alreadyEarned = 0, now = Date.now()): number {
  if (rewardState(deal, pool, now) === "expired") return 0;
  const personLeft = Math.max(0, pool.perPersonCap - alreadyEarned);
  return Math.max(0, Math.min(ruleReward(deal), available(pool), personLeft));
}

export class PoolError extends Error {}

/** Set money aside for a purchase that is being verified. Throws rather than ever over-promising. */
export function reserve(pool: Pool, amount: number): Pool {
  if (!Number.isInteger(amount) || amount <= 0) throw new PoolError("A reward must be a positive whole number of micro-units.");
  if (amount > available(pool)) throw new PoolError("This pool doesn't have that much left.");
  return { ...pool, committed: pool.committed + amount };
}

/** A verified purchase: the reserved money becomes a payout. */
export function settle(pool: Pool, amount: number): Pool {
  if (amount > pool.committed) throw new PoolError("There is no such reservation to settle.");
  return { ...pool, committed: pool.committed - amount, paid: pool.paid + amount };
}

/** A purchase that was never verified, or a reward that expired: the money goes back to the pool. */
export function release(pool: Pool, amount: number): Pool {
  if (amount > pool.committed) throw new PoolError("There is no such reservation to release.");
  return { ...pool, committed: pool.committed - amount };
}

/** The invariant the transparency page shows: promises never exceed what was deposited. */
export const isSound = (p: Pool): boolean => p.funded >= 0 && p.committed >= 0 && p.paid >= 0 && p.committed + p.paid <= p.funded;

/** Plain-language line for a deal card, so a state is never just a colour. */
export function rewardLine(state: RewardState, offer: number, fmt: (micro: number) => string): string {
  switch (state) {
    case "funded":
      return `Earn ${fmt(offer)} back`;
    case "low":
      return offer > 0 ? `Earn ${fmt(offer)} back · pool nearly empty` : "Pool nearly empty";
    case "empty":
      return "No cashback left on this deal";
    case "expired":
      return "Deal ended";
  }
}
