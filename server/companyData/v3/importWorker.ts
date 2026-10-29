/** Separate data-transfer process. No HTTP server, Hint, lab, mail or startup DDL.
 * Never runs at build/startup; explicit private parent invocation only.
 */
import { Pool } from "pg";
import { semanticHash } from "../valueTree";
import { reviewedImportApproval, reviewedAccountBinding } from "./importApproval";
import { reviewedPackage } from "./reviewedPackage";
import { storedTransfer } from "./packageStorage";
import { OwnerImportService } from "./transport";

async function run() {
  const approval = reviewedImportApproval;
  if (!process.argv.includes("--approved-owner-import") || !approval?.confirmed ||
      !approval.importApproved || !reviewedPackage)
    throw new Error("Worker not authorized");
  let text = "";
  for await (const part of process.stdin) {
    text += part;
    if (Buffer.byteLength(text) > 64 * 1024) throw new Error("Invalid private invocation");
  }
  const {pin, auth, token, environment} = JSON.parse(text);
  if (semanticHash(pin) !== semanticHash(reviewedPackage) || pin.manifestHash !== approval.manifestHash ||
      auth.ownerKey !== approval.targetOwner || !auth.isOwner || !auth.csrfVerified ||
      environment !== approval.targetEnvironment || pin.manifest.scope !== "new-country" ||
      pin.manifest.sourceBWorkspace !== reviewedAccountBinding.sourceBWorkspace ||
      !/^[a-f0-9]{64}$/.test(token))
    throw new Error("Private invocation binding mismatch");
  const pool = new Pool({connectionString: process.env.DATABASE_URL, max: 1});
  try {
    await new OwnerImportService(pool, environment, true).consume(auth, token, pin.manifest,
      storedTransfer(pin), false);
  } finally {await pool.end();}
}
run().catch(() => {
  console.error("[CompanyImportWorker] Not confirmed; inspect durable status. No automatic retry.");
  process.exitCode = 1;
});
