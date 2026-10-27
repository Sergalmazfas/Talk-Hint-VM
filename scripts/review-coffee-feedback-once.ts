/** One explicit Dev diagnostic of the owner-authorized saved coffee call. No mail or DB writes. */
import assert from "node:assert/strict";
import { readFile, writeFile, open } from "node:fs/promises";
import { runHintLab, labAnalysisFailure } from "../server/callLab/process";
import { hintMeasurements } from "../server/callLab/measurements";
import { completeLabReport, renderProcessLetter } from "../server/callLab/processReport";

const dir = "generated-artifacts/hint-owner-feedback-1";
assert.notEqual(process.env.NODE_ENV, "production");
assert.ok(process.argv.includes("--execute-once"));
const corpus = JSON.parse(await readFile(`${dir}/corpus.json`, "utf8"));
const call = corpus.find((c: any) => c.callSid === "CAc2db7d6facd5da845fc21422f33bda0b");
assert.ok(call?.metadata?.labHintSource?.mode === "hint");
assert.equal(call.metadata.labHintSource.environment, "production");
// Ownership was verified through a production read-only join before this run.
// Current owner instruction explicitly authorizes the laboratory examination.
const source = {
  call_id: call.callSid, mode: "hint", environment: "production", synthetic: false,
  owner_verified: true, processing_authorized: true,
  source_basis: "Owner feedback #1: manual Dev diagnostic; production owner/source JOIN verified read-only. No new audio/calls.",
  ended_at: call.endedAt, duration_ms: Date.parse(call.endedAt) - Date.parse(call.startedAt),
  goal: "Owner's stated purpose: constructive feedback on the coffee lid/spill and confirmation of emailed photos; not a request for money. This context is supplied for the manual review, not proof of the saved runtime goal.",
  languages: [], transcript: call.transcript,
  hints: call.metadata.hintLatency.entries.map((e: any) => ({
    id: String(e.utteranceId), text: e.text, outcome: e.outcome, drop_reason: e.dropReason ?? null,
    delivered_at: e.deliveredAt ?? null, sent_at: e.sentAt ?? null, stt_final_at: e.sttFinalAt ?? null,
  })),
  full_hint_history: false, reference_verified: false,
  ui_visibility: call.metadata.hintUiVisibility,
  latency_summary: call.metadata.hintLatency.summary,
  limitations: ["Owner reports zero hint use; lexical speech matches cannot override this.",
    "No audio, reference, intermediate STT or raw model output. No authenticated speaker-end-to-reading latency.",
    "Source is saved production; execution is manually authorized Dev. Not an automated production recovery.",
    "The historical production MODEL_FAILURE cause was not preserved and remains unknown."],
};
const reservation = await open(`${dir}/coffee-analysis-reservation.json`, "wx");
await reservation.writeFile(JSON.stringify({ call: call.callSid, at: new Date().toISOString(),
  maxPasses: 1, noMail: true, noProductionWrites: true }));
await reservation.close();
await writeFile(`${dir}/coffee-diagnostic-source.json`, JSON.stringify(source, null, 2));
try {
  const raw = await runHintLab(source);
  const report = completeLabReport({ ...raw, manual_trigger: true, execution_environment: "development",
    source_environment: "production", owner_feedback: { usedHints: 0, basis: "direct owner report" },
    deterministic: hintMeasurements(source) }, source, "");
  await writeFile(`${dir}/coffee-diagnostic-report.json`, JSON.stringify(report, null, 2));
  const letter = renderProcessLetter(report);
  await writeFile(`${dir}/coffee-diagnostic-letter.txt`, `${letter.subject}\n\n${letter.body}`);
  console.log(JSON.stringify({ completed: true, qa: report.qa_status, qaReturns: report.qa_returns,
    qaIssues: report.qa_issues, sent: false }));
} catch (error) {
  const failure = labAnalysisFailure(error);
  await writeFile(`${dir}/coffee-diagnostic-failure.json`, JSON.stringify({ at: new Date().toISOString(), failure,
    sourcePreserved: true, productionUnchanged: true, emailSent: false }, null, 2));
  console.log(JSON.stringify({ completed: false, failure, sourcePreserved: true, noAutomaticRepeat: true }));
  process.exitCode = 1;
}
