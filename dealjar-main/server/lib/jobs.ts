import { and, eq, lt, or } from "drizzle-orm";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { expireReservations, reconcilePending } from "./payments";
import { refreshRates } from "./rates";
import { retryUnpaidReferrals } from "./referrals";

/*
  The scheduled jobs. Render cron jobs run `npm run cron -- <name>` on a schedule (see render.yaml), and the same
  jobs can be triggered over HTTP with the CRON_SECRET (routes/cron.ts). Each one is safe to run twice at once and
  safe to run too often, and every run leaves a line in job_runs that the admin page shows.
*/
export const JOBS = {
  /** Every few minutes: find payments sent but never confirmed (by memo), and pay referrals that were waiting for the pot. */
  reconcile: async () => {
    const settled = await reconcilePending({}, 0);
    const referrals = await retryUnpaidReferrals();
    return `${settled} payment(s) settled, ${referrals} referral(s) paid`;
  },
  /** Every ten minutes: reservations nobody paid for go back to their pots. */
  expire: async () => {
    const r = await expireReservations();
    return `${r.released} reservation(s) released, ${r.abandoned} old payment(s) abandoned`;
  },
  /** Hourly: fresh NIM, euro and gold prices. */
  prices: async () => {
    const r = await refreshRates();
    if (!r.ok) throw new Error(r.detail);
    return r.detail;
  },
  /** Daily: tidy up, and say how many cash-outs have been waiting more than a day. */
  daily: async () => {
    const db = await getDb();
    const gone = await db
      .delete(schema.authChallenges)
      .where(or(lt(schema.authChallenges.expiresAt, new Date(Date.now() - 86_400_000)), and(eq(schema.authChallenges.used, true), lt(schema.authChallenges.expiresAt, new Date()))))
      .returning({ n: schema.authChallenges.nonce });
    await db.delete(schema.jobRuns).where(lt(schema.jobRuns.ranAt, new Date(Date.now() - 30 * 86_400_000)));
    const waiting = await db.select({ id: schema.cashouts.id }).from(schema.cashouts).where(and(eq(schema.cashouts.status, "pending"), lt(schema.cashouts.createdAt, new Date(Date.now() - 86_400_000))));
    return `${gone.length} old sign-in code(s) removed, ${waiting.length} cash-out(s) waiting over a day`;
  },
} as const;

export type JobName = keyof typeof JOBS;
export const isJob = (s: string): s is JobName => s in JOBS;

export async function runJob(name: JobName): Promise<{ ok: boolean; detail: string }> {
  const db = await getDb();
  let result: { ok: boolean; detail: string };
  try {
    result = { ok: true, detail: await JOBS[name]() };
  } catch (e) {
    result = { ok: false, detail: (e as Error).message };
  }
  await db.insert(schema.jobRuns).values({ id: newId(), name, ok: result.ok, detail: result.detail.slice(0, 300) });
  return result;
}
