// Entry point for Render cron jobs:  npm run cron -- reconcile | expire | prices | daily
import { isJob, runJob, JOBS } from "@srv/jobs";

const name = process.argv[2] ?? "";
if (!isJob(name)) {
  console.error(`Unknown job "${name}". Use one of: ${Object.keys(JOBS).join(", ")}`);
  process.exit(2);
}
const result = await runJob(name);
console.log(`[cron:${name}] ${result.ok ? "ok" : "FAILED"}: ${result.detail}`);
process.exit(result.ok ? 0 : 1);
