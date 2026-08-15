import { readFileSync } from "fs";
import { db } from "../../../server/db";
import { benchmarkFixtures } from "../../../shared/schema";
import { ensureBenchmarkTables } from "../../../server/benchmark/ensureTables";
import { eq } from "drizzle-orm";

async function main() {
  await ensureBenchmarkTables();
  const dir = "/home/runner/workspace/.agents/outputs/fixture2/";
  const p = JSON.parse(readFileSync(dir + "import_payload.json", "utf8"));
  const audio = readFileSync(dir + "call.wav");
  const [row] = await db.insert(benchmarkFixtures).values({
    title: p.title, kind: "recorded_call", goal: p.goal,
    referenceTurns: p.referenceTurns, criticalEntities: {}, confirmedFacts: [],
    audioBase64: audio.toString("base64"), audioFormat: "wav", audioChannels: "dual",
    sourceCallSid: p.callSid, tags: p.tags,
  }).returning({ id: benchmarkFixtures.id });
  // Read back to confirm the commit actually persisted.
  const [check] = await db.select({ id: benchmarkFixtures.id, len: benchmarkFixtures.audioBase64 }).from(benchmarkFixtures).where(eq(benchmarkFixtures.id, row.id));
  console.log(JSON.stringify({ id: row.id, audioLen: check?.len?.length ?? 0 }));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
