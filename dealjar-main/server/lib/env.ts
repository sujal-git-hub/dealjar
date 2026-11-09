// Startup check for production configuration. Fails fast on what would break or endanger the app, and warns about
// what only degrades it. Never prints values.

export function checkEnv(env: NodeJS.ProcessEnv = process.env): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (env.NODE_ENV !== "production") return { errors, warnings };

  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) errors.push("SESSION_SECRET must be set to a random string of at least 32 characters");
  if (env.DEALJAR_NO_RATE_LIMIT === "1") errors.push("DEALJAR_NO_RATE_LIMIT=1 turns off abuse limits: never enable it in production");
  if (env.DEALJAR_DEMO_PAYMENTS === "1") errors.push("DEALJAR_DEMO_PAYMENTS=1 skips on-chain checks: never enable it in production");

  if (!env.DATABASE_URL) warnings.push("DATABASE_URL is not set: using the embedded local database, which is wiped on most hosts");
  if (!env.S3_BUCKET) warnings.push("S3_BUCKET is not set: uploaded images go to local disk and are lost on redeploy");
  if (!env.NIMIQ_RPC_URL) warnings.push("NIMIQ_RPC_URL is not set: real payments will stay pending");
  if (!env.ADMIN_ADDRESSES) warnings.push("ADMIN_ADDRESSES is empty: nobody can open /admin");
  if (!env.POOL_ADDRESS) warnings.push("POOL_ADDRESS is not set: sponsors cannot fund reward pots");
  if (!env.CRON_SECRET) warnings.push("CRON_SECRET is not set: the /api/cron/* endpoints are closed (the cron jobs can still run directly)");
  if (env.DEALJAR_DEMO === "1") warnings.push("DEALJAR_DEMO=1: anyone can sign in as a demo persona");
  return { errors, warnings };
}
