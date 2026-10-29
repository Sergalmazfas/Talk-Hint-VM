import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { freemem, totalmem } from "node:os";
import { readFile } from "node:fs/promises";
import type { ReviewedPackage } from "./reviewedPackage";
import type { OwnerAuthentication } from "./transport";
import { limitedWorker } from "../../limitedWorker";

/** Bound the child heap and require room for the existing phone/web process.
 * Never run an unbounded full snapshot decode on the Hint event loop.
 */
export async function importWorkerCapacity() {
  let limit = totalmem(), used = 0;
  try {
    const [cap, current] = await Promise.all([
      readFile("/sys/fs/cgroup/memory.max", "utf8"),
      readFile("/sys/fs/cgroup/memory.current", "utf8"),
    ]);
    if (cap.trim() !== "max") limit = Math.min(limit, Number(cap));
    used = Number(current);
  } catch { /* On a non-cgroup VM use the OS's actual memory, not a guessed tier. */ }
  return limit >= 4 * 1024 ** 3 &&
    Math.min(freemem(), limit - used) >= 3.75 * 1024 ** 3;
}
export async function runImportWorker(pin: ReviewedPackage, auth: OwnerAuthentication,
  token: string, environment: "development" | "production") {
  if (!await importWorkerCapacity()) throw new Error("Import worker memory reserve unavailable");
  const args = ["--max-old-space-size=2048",
    ...(process.env.NODE_ENV === "production" ? [resolve("dist/company-import-worker.js")] :
      ["--import", "tsx", resolve("server/companyData/v3/importWorker.ts")]),
    "--approved-owner-import"];
  await new Promise<void>((resolveResult, reject) => {
    const launch = limitedWorker("import", process.execPath, args);
    const child = spawn(launch.executable, launch.args, {stdio: ["pipe", "ignore", "pipe"]});
    // Grant is a short-lived capability: pipe only, never argv/env/log/storage.
    child.stdin.on("error", () => reject(new Error("Import worker input unavailable")));
    child.stdin.end(JSON.stringify({pin, auth, token, environment}));
    child.stderr.on("data", () => { /* sanitized result only, no raw worker output */ });
    child.once("error", () => reject(new Error("Import worker launch failed")));
    child.once("exit", code => code === 0 ? resolveResult() : reject(new Error("Import worker did not confirm")));
  });
}
