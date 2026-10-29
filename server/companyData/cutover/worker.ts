import { Pool } from "pg";
import { CompanyCutover } from "./service";
import { reviewedCutoverApproval } from "./policy";
import { emitDiagnostic, exceptionCode } from "./diagnostics";
async function main() {
  emitDiagnostic({ stage: "worker_boot", environment: {
    production: process.env.NODE_ENV === "production", databaseUrlPresent: !!process.env.DATABASE_URL } });
  if (!reviewedCutoverApproval || process.env.NODE_ENV !== reviewedCutoverApproval.environment)
    throw new Error("CUTOVER_NOT_APPROVED");
  if (!process.env.DATABASE_URL) throw new Error("CUTOVER_DATABASE_URL_UNAVAILABLE");
  // Offline, bounded production-entry smoke test: no pool, SQL or operation.
  if (process.argv.includes("--cutover-preflight")) {
    emitDiagnostic({ stage: "preflight_complete" }); return;
  }
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1024) throw new Error("CUTOVER_INPUT_LIMIT");
  }
  const { operation } = JSON.parse(input);
  if (typeof operation !== "string" || !/^[a-f0-9-]{36}$/.test(operation)) throw new Error("CUTOVER_BAD_OPERATION");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3,
    application_name: "company-cutover-worker" });
  try {
    const service = new CompanyCutover(pool, reviewedCutoverApproval.environment, reviewedCutoverApproval, reviewedCutoverApproval);
    await service.perform(reviewedCutoverApproval.owner, operation);
  } finally { await pool.end(); }
}
main().catch(error => {
  emitDiagnostic({ stage: "worker_exception", exceptionCode: exceptionCode(error) });
  process.exitCode = 1;
});
