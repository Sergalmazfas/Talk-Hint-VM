import { startEarsRun } from "../../../server/benchmark/orchestrator";
import { ensureBenchmarkTables } from "../../../server/benchmark/ensureTables";
import { db } from "../../../server/db";
import { benchmarkRuns } from "../../../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  await ensureBenchmarkTables();
  const { runId } = await startEarsRun(["09e6bcce-3338-47b8-9136-1cc4ed24070c"]);
  console.log("RUN_ID", runId);
  for (;;) {
    await new Promise((r) => setTimeout(r, 15000));
    const [row] = await db.select({ status: benchmarkRuns.status }).from(benchmarkRuns).where(eq(benchmarkRuns.id, runId));
    console.log(new Date().toISOString(), "status:", row?.status);
    if (row && row.status !== "running" && row.status !== "pending") { console.log("FINAL", row.status); process.exit(0); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
