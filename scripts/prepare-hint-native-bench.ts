/**
 * PREPARATION ONLY: npx tsx scripts/prepare-hint-native-bench.ts
 * Optional free GETs: --catalog --openai-model=<exact ID> --gemini-model=<exact ID>
 * --execute is always rejected, before opening any network connection.
 */
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { assertPaidExecutionAuthorized, FixtureSchema, freezeCorpus, INSTRUCTION, LIMIT_MICRO_USD, SERIES, sha } from "../server/hintNativeBench/contracts";
import { readCatalog, selectedModel } from "../server/hintNativeBench/catalog";
import { NativeLedger } from "../server/hintNativeBench/ledger";
import { JUDGE_MODEL, JUDGE_PROMPT_HASH } from "../server/hintNativeBench/judge";
import { OPENAI_PRICE, sessionReserve } from "../server/hintNativeBench/cost";
import { setup } from "../server/hintNativeBench/protocol";
import { comparison } from "../server/hintNativeBench/report";

const args = process.argv.slice(2);
if (args.includes("--execute")) assertPaidExecutionAuthorized();
if (args.some(a => a !== "--catalog" && !/^--(?:openai|gemini)-model=[a-z0-9./_-]+$/i.test(a)))
  throw Error("UNKNOWN_ARGUMENT");
const root = "generated-artifacts/hint-native-bench";
const source = "generated-artifacts/hint-polygon";
await fs.mkdir(root, { recursive: true, mode: 0o700 });
const manifestBytes = await fs.readFile(join(source, "private-manifest.json"));
const corpus = freezeCorpus(JSON.parse(manifestBytes.toString()),
  JSON.parse(await fs.readFile(join(source, "clean-panel.json"), "utf8")).ids);
// Validate the original physical VAD files rather than trusting manifest claims.
for (const f of corpus.fixtures) {
  const bytes = await fs.readFile(`generated-artifacts/hint-bench-repair/vad/${f.id}.json`);
  const vad = JSON.parse(bytes.toString());
  if (sha(bytes) !== f.vadHash || vad.audioSha256 !== f.audioSha256 ||
      vad.durationMs !== f.durationMs ||
      JSON.stringify(FixtureSchema.shape.vad.parse(vad.channels)) !== JSON.stringify(f.vad))
    throw Error("PHYSICAL_VAD_CHANGED");
}
const originalLedger = await fs.readFile(join(source, "series-ledger.json"));
const oldLedgerHash = sha(originalLedger);
async function immutable(name: string, value: unknown) {
  const body = JSON.stringify(value, null, 2) + "\n", path = join(root, name);
  try { await fs.writeFile(path, body, { flag: "wx", mode: 0o600 }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    if (await fs.readFile(path, "utf8") !== body) throw Error("FROZEN_PREPARATION_CHANGED_" + name);
  }
}
const nativeFiles = (await fs.readdir("server/hintNativeBench")).filter(p => p.endsWith(".ts")).sort();
const sourceHashes = Object.fromEntries(await Promise.all(nativeFiles.map(async p =>
  [p, sha(await fs.readFile("server/hintNativeBench/" + p))])));
const plan = {
  series: SERIES, limitMicroUsd: LIMIT_MICRO_USD,
  status: "PREPARATION_ONLY_OWNER_NO_SPEND", paidExecutionAllowed: false,
  corpusHash: corpus.corpusHash, manifestHash: sha(manifestBytes), panelHash: corpus.panelHash,
  canaryId: corpus.canary.id, panelIds: corpus.panel.map(f => f.id),
  fixtures: corpus.fixtures.map(f => ({
    id: f.id, audioSha256: f.audioSha256, vadHash: f.vadHash, goalHash: f.goalHash,
    durationMs: f.durationMs, group: f.goal ? "saved-goal" : "no-goal",
  })),
  previousSeriesLedgerHashAtPreparation: oldLedgerHash,
  promptHash: sha(INSTRUCTION), judgeModel: JUDGE_MODEL, judgePromptHash: JUDGE_PROMPT_HASH,
  sequence: ["separate short synthetic contract control", "shortest clean saved-goal recording", "fixed same panel for both providers"],
  controls: { replayRate: 1, manualTurnControl: false, flux: false, audioOutputTranscript: false },
  quality: { ambiguityLimit: .30, noHintIncluded: true, independentJudge: true },
  context: "original Guest audio; frozen reference Owner text only after its audio end",
  blockers: [
    "owner approval after English-first B release and owner control call",
    "explicit code change reopening paid execution; CLI/env cannot bypass this release",
    "fresh official tariffs and full session reservations for exact selected model IDs",
    "paid real TEXT/automatic-EOT handshake, not catalogue availability alone",
    "verified frozen reference texts/timings for selected recordings; never infer from output order",
    "real judge contract control and durable result recorder before any paid panel",
  ],
};
await immutable("frozen-plan.json", plan);
await fs.writeFile(join(root, "source-provenance.json"), JSON.stringify({
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceHashes, sourceHash: sha(JSON.stringify(sourceHashes)),
}, null, 2), { mode: 0o600 });
await fs.writeFile(join(root, "protocol-registry.json"), JSON.stringify({
  instruction: INSTRUCTION, promptHash: sha(INSTRUCTION),
  openaiExample: setup("openai", "<catalogue-confirmed-id>", "<saved goal>", 250),
  geminiExample: setup("gemini", "<catalogue-confirmed-id>", "<saved goal>", 250),
  note: "configuration examples only, never transmitted; Gemini TEXT support unconfirmed",
  pricing: { openai: OPENAI_PRICE, gemini: null },
  reserveExampleMicroUsd: sessionReserve({
    durationMs: Math.ceil(corpus.canary.durationMs), maxResponses: 20, maxOutputTokens: 250,
    instructionBytes: Buffer.byteLength(INSTRUCTION + corpus.canary.goal), ownerBytes: 8192,
  }),
}, null, 2), { mode: 0o600 });
if (args.includes("--catalog")) {
  const catalogs = await Promise.all([readCatalog("openai"), readCatalog("gemini")]);
  const selected = catalogs.map(c => {
    const model = args.find(a => a.startsWith(`--${c.provider}-model=`))?.split("=")[1];
    return { provider: c.provider, model: model ? selectedModel(c, model) : null, handshake: "NOT_RUN" };
  });
  const path = `catalog-${Date.now()}.json`;
  await fs.writeFile(join(root, path), JSON.stringify({ catalogs, selected }, null, 2), { mode: 0o600 });
}
// Initialises only the NEW $15 ledger. Existing entries are preserved across preparations.
const ledger = await NativeLedger.open(join(root, "series-ledger.json"));
try {
  const state = ledger.snapshot();
  if (state.entries.length) throw Error("PAID_HISTORY_PRESENT_PREPARATION_REQUIRES_RECONCILIATION");
  const summary = comparison([], corpus.panel.map(f => f.id), corpus.corpusHash, corpus.panelHash, state);
  await fs.writeFile(join(root, "comparison.json"), JSON.stringify({
    series: SERIES, ...summary, textHandshake: "NOT_RUN", paidAttempts: 0,
    measured: false, liveProductEnabled: false, telephoneCalls: 0,
    pricesAreInvoice: false, pendingReservations: state.entries.filter(e => e.status !== "spent").length,
    caveats: ["no paid requests, no latency/quality evidence",
      "Gemini documentation says AUDIO-only; TEXT rejection/success has not been checked by handshake",
      "Owner reference context differs from production STT; disclose in any future comparison",
      "native plain-EN output has no translation; preserve the old judge rubric and disclose this limitation"],
  }, null, 2), { mode: 0o600 });
  await fs.writeFile(join(root, "comparison.csv"),
    "provider,status,p50_ms,p95_ms,quality,coverage,cost_usd\n" +
    "OpenAI,NOT_RUN_PREPARATION_ONLY,,,,,\nGemini,NOT_RUN_PREPARATION_ONLY,,,,,\n", { mode: 0o600 });
} finally { await ledger.close(); }
if (sha(await fs.readFile(join(source, "series-ledger.json"))) !== oldLedgerHash)
  throw Error("PREVIOUS_LEDGER_CHANGED_DURING_PREPARATION");
console.log(JSON.stringify({
  status: plan.status, corpusHash: corpus.corpusHash, fixtures: corpus.fixtures.length,
  fixedPanel: corpus.panel.length, oldLedgerUnchanged: true, paidRequests: 0,
  result: root + "/comparison.json",
}));
