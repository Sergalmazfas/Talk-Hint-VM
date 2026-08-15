// Real Call Fixture #1 — Mint Mobile / eSIM support.
// Imports the first REAL recorded TalkHint phone call as an EARS fixture:
//  - looks up the completed Twilio recording by call SID (our account only),
//  - downloads the ORIGINAL dual-channel 8kHz WAV (no enhancement),
//  - freezes it with the production transcript as the INITIAL reference draft
//    (explicitly tagged needs-reference-review: the production transcript is
//    NOT ground truth — the admin edits it by hand in the admin UI),
//  - then starts an EARS run across the mandatory candidate matrix.
// Usage: npx tsx script/import-mint-real-call.ts <CallSid> [--run]

import { eq } from "drizzle-orm";
import { db, dbReady } from "../server/db";
import { benchmarkFixtures } from "@shared/schema";
import { ensureBenchmarkTables } from "../server/benchmark/ensureTables";
import { lookupRecordingSidByCallSid, downloadRecordingWav } from "../server/benchmark/recordedCalls";
import { transcriptToReferenceTurns } from "../server/benchmark/diagnosticRecording";
import { splitWavChannels } from "../server/benchmark/audioChannels";
import fs from "fs";

const CALL_SID = process.argv[2] || "CAfeca42c3e0ff05eb8e21b86f5096c2f1";
const RUN = process.argv.includes("--run");
const TRANSCRIPT_FILE = "/tmp/mint-transcript.txt";

async function main() {
  await dbReady;
  await ensureBenchmarkTables();

  console.log("[1/4] Looking up Twilio recording for", CALL_SID);
  const recordingSid = await lookupRecordingSidByCallSid(CALL_SID);
  if (!recordingSid) throw new Error("no completed recording on Twilio for this call SID");
  console.log("  recordingSid:", recordingSid);

  console.log("[2/4] Downloading original dual-channel WAV...");
  const wav = await downloadRecordingWav(undefined, recordingSid);
  console.log("  bytes:", wav.length);
  const split = splitWavChannels(wav); // verifies 8kHz + channel count honestly
  console.log("  channels:", split.channels.length, "@", split.sampleRate, "Hz");

  const transcript = fs.existsSync(TRANSCRIPT_FILE) ? fs.readFileSync(TRANSCRIPT_FILE, "utf8") : "";
  const referenceTurns = transcriptToReferenceTurns(transcript);
  if (referenceTurns.length === 0) throw new Error(`no transcript at ${TRANSCRIPT_FILE} — reference draft required`);
  console.log("  reference draft turns:", referenceTurns.length);

  console.log("[3/4] Freezing fixture...");
  const values = {
    title: "Real Call Fixture #1 — Mint Mobile / eSIM support",
    kind: "recorded_call",
    goal: "Activate eSIM on the new phone via Mint Mobile support",
    referenceTurns,
    criticalEntities: {
      digits: ["9542874845"],
      terms: ["eSIM", "SMS code", "Mint Mobile", "Wi-Fi", "SIM card", "activation code"],
    },
    confirmedFacts: [],
    audioBase64: wav.toString("base64"),
    audioFormat: "wav" as const,
    audioChannels: split.channels.length === 2 ? "dual" : "mono",
    channelRoles: ["owner", "guest"],
    sourceCallSid: CALL_SID,
    tags: ["real-call", "mint-mobile", "esim-support", "needs-reference-review", "production-transcript-draft"],
    updatedAt: new Date(),
  };
  const existing = await db.select({ id: benchmarkFixtures.id }).from(benchmarkFixtures)
    .where(eq(benchmarkFixtures.sourceCallSid, CALL_SID)).limit(1);
  const [row] = existing.length
    ? await db.update(benchmarkFixtures).set(values).where(eq(benchmarkFixtures.id, existing[0].id)).returning({ id: benchmarkFixtures.id })
    : await db.insert(benchmarkFixtures).values(values).returning({ id: benchmarkFixtures.id });
  console.log("  fixture:", row.id);

  if (RUN) {
    console.log("[4/4] Starting EARS run (availability check first, no substitution)...");
    const { startEarsRun } = await import("../server/benchmark/orchestrator");
    const { runId } = await startEarsRun([row.id]);
    console.log("  runId:", runId);
    // Poll until finished (background promise inside startEarsRun).
    const { benchmarkRuns } = await import("@shared/schema");
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const [run] = await db.select({ status: benchmarkRuns.status, error: benchmarkRuns.error }).from(benchmarkRuns).where(eq(benchmarkRuns.id, runId));
      process.stdout.write(`  ${i * 5}s: ${run.status}\n`);
      if (run.status !== "running") {
        if (run.error) console.error("  RUN ERROR:", run.error.slice(0, 800));
        break;
      }
    }
  } else {
    console.log("[4/4] Skipped EARS run (pass --run to start it).");
  }
  process.exit(0);
}

main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
