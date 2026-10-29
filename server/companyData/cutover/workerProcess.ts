import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { limitedWorker } from "../../limitedWorker";
import { importWorkerCapacity } from "../v3/importWorkerProcess";
export async function startCutoverWorker(operation: string) {
  if (!await importWorkerCapacity()) throw new Error("CUTOVER_MEMORY_RESERVE_UNAVAILABLE");
  const args = ["--max-old-space-size=2304",
    ...(process.env.NODE_ENV === "production" ? [resolve("dist/company-cutover-worker.js")] :
      ["--import", "tsx", resolve("server/companyData/cutover/worker.ts")])];
  await new Promise<void>((done, reject) => {
    const launch = limitedWorker("import", process.execPath, args);
    const child = spawn(launch.executable, launch.args, { stdio: ["pipe", "ignore", "pipe"] });
    child.stdin.on("error", () => reject(new Error("CUTOVER_WORKER_INPUT_UNAVAILABLE")));
    child.stdin.end(JSON.stringify({ operation }));
    child.stderr.on("data", () => { /* no secrets or SQL in browser diagnostics */ });
    child.once("error", () => reject(new Error("CUTOVER_WORKER_LAUNCH_FAILED")));
    child.once("exit", code => code === 0 ? done() : reject(new Error("CUTOVER_WORKER_UNCONFIRMED")));
  });
}
