// Dev runner: API (tsx watch) + Vite, both with inherited stdio.
import { spawn } from "node:child_process";

const run = (name, cmd, args) => {
  const p = spawn(cmd, args, { stdio: "inherit", shell: true });
  p.on("exit", (code) => {
    console.log(`[${name}] exited (${code})`);
    for (const o of procs) o.kill();
    process.exit(code ?? 0);
  });
  return p;
};
const procs = [run("api", "npx", ["tsx", "watch", "--env-file-if-exists=.env.local", "server/index.ts"]), run("web", "npx", ["vite"])];
process.on("SIGINT", () => procs.forEach((p) => p.kill()));
