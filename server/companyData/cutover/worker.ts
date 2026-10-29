import { Pool } from "pg";
import { CompanyCutover } from "./service";
import { reviewedCutoverApproval } from "./policy";
async function main() {
  if (!reviewedCutoverApproval || process.env.NODE_ENV !== reviewedCutoverApproval.environment)
    throw new Error("CUTOVER_NOT_APPROVED");
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1024) throw new Error("CUTOVER_INPUT_LIMIT");
  }
  const { operation } = JSON.parse(input);
  if (typeof operation !== "string" || !/^[a-f0-9-]{36}$/.test(operation)) throw new Error("CUTOVER_BAD_OPERATION");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const service = new CompanyCutover(pool, reviewedCutoverApproval.environment, reviewedCutoverApproval, reviewedCutoverApproval);
    await service.perform(reviewedCutoverApproval.owner, operation);
  } finally { await pool.end(); }
}
main().catch(() => { console.error("CUTOVER_WORKER_UNCONFIRMED"); process.exitCode = 1; });
