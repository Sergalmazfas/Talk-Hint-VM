/** Prepare inputs, calibration and price ONLY; no SDK/network imports. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { normalizeCandidate } from "./unified-hint-metrics";
import { judgeV2Messages, judgeV2System } from "./unified-hint-judge-v2";
const base = "generated-artifacts/hint-unified-preflight";
const dir = "generated-artifacts/hint-unified-rescore";
await mkdir(dir, { recursive: true });
const fs = JSON.parse(await readFile(`${base}/frozen-reference-v1.json`, "utf8"));
const freeze = JSON.parse(await readFile(`${base}/REFERENCE_FREEZE.json`, "utf8"));
const gens = JSON.parse(await readFile(`${base}/execution/generations.json`, "utf8"));
const old = JSON.parse(await readFile(`${base}/old-answers-preserved.json`, "utf8"));
const original = JSON.parse(await readFile(`${base}/preflight.json`, "utf8"));
assert.equal(createHash("sha256").update(await readFile(`${base}/frozen-reference-v1.json`)).digest("hex"), freeze.sha256);
const card = (text: string, extra = "") => ({ type: "direct", cards: [{ en: text, translation: "", label: "" }], guestTranslation: extra });
const scenarios = [
  { id: "screen", moment: "october-2:20", good: "Could you guide me to that option?", bad: "I'm in Settings now.", owner: true },
  { id: "negative-reboot", moment: "october-1:21", good: "Could you walk me through restarting it?", bad: "I haven't restarted the phone.", owner: true },
  { id: "intention-not-completion", moment: "october-1:35", good: "I'll try that now. Could you stay on the line?", bad: "I completed activation and my mobile data works.", owner: true },
  { id: "refund-offer-not-receipt", moment: "october-3:25", good: "Thank you. Please also share my feedback about the lids.", bad: "I already received the refund.", owner: true },
  { id: "photo-sent-not-received", moment: "october-3:2", good: "Did you receive the photos I emailed?", bad: "You have already received and read my photos.", owner: false },
  { id: "social-ack", moment: "october-2:0", good: "Understood, thank you.", bad: "Thanks, my mobile data is working again now.", owner: true },
  { id: "known-screen-vs-future-step", moment: "october-2:22", good: "I'm in Settings. Where should I look for General Management?", bad: "I have already reset my network settings.", owner: true },
  { id: "owner-over-guest", moment: "october-2:14", good: "Calls and texts are affected too, not just mobile data.", bad: "My calls and texts work fine; only data is affected.", owner: true },
  { id: "guest-translation-not-owner", moment: "october-3:26", good: "Thank you. I mainly wanted to report the lid issue.", bad: "You charged me twice. Please refund the extra charge.", owner: false, translation: "Я верну вам деньги за кофе." },
  { id: "explicit-conditional-options", moment: "august-fixture-2:14", good: "I'll try ordering the replacement now. Please stay on the line.", bad: "I completed the order and received the activation code.", owner: true },
];
const calibration: any[] = [];
for (const s of scenarios) {
  const f = fs.find((f: any) => f.id === s.moment); assert(f, s.moment);
  for (const quality of ["good", "bad"] as const) {
    let candidate: any = card(s[quality], s.translation);
    if (s.id === "explicit-conditional-options" && quality === "good") candidate = {
      type: "choice", cards: [
        { label: "Нашёл", en: "Yes, I found the replacement SIM option.", translation: "" },
        { label: "Ещё нет", en: "I haven't found that option yet. Could you guide me?", translation: "" },
      ], guestTranslation: "",
    };
    calibration.push({ id: `${s.id}:${quality}`, kind: "synthetic calibration example, NOT actual model output",
      fixtureId: f.id, candidate, expected: { inventedFacts: quality === "bad",
        speakingForOwner: quality === "bad" && s.owner, ...(quality === "good" ? { goal: "yes" } : {}) },
      messages: judgeV2Messages(f, candidate) });
  }
}
assert.equal(calibration.length, 20);
const jobs = gens.filter((g: any) => g.status === "complete").map((g: any) => ({
  id: `current:${g.id}`, sourceGroup: "current", sourceId: g.id,
  fixtureId: g.fixtureId, messages: judgeV2Messages(fs.find((f: any) => f.id === g.fixtureId), g.normalized),
}));
for (const [i, a] of old.entries()) {
  const f = fs.find((f: any) => f.callId === "august-fixture-2" && f.sourceTurnIdx === a.turnIdx);
  assert(f);
  jobs.push({ id: `historical:old-${i}`, sourceGroup: "historical", sourceId: `old-${i}`,
    fixtureId: f.id, messages: judgeV2Messages(f, normalizeCandidate(a.output, true)) });
}
assert.equal(jobs.length, 636);
const rate = original.cost.publicRates.find((r: any) => r.model === "gpt-5.4");
const oldJudges = JSON.parse(await readFile(`${base}/execution/judgments.json`, "utf8"));
const success = oldJudges.filter((j: any) => j.usage);
// Estimate input from the complete queued messages, not just shorter early turns.
const all = [...calibration, ...jobs];
const inputBytes = all.reduce((n, j) => n + Buffer.byteLength(JSON.stringify(j.messages)), 0);
const inputEstimate = Math.ceil(inputBytes / 4);
const outputReferenceMean = success.reduce((n: number, j: any) => n + j.usage.completion_tokens, 0) / success.length;
const atOutput = (tokens: number) => +((inputEstimate * rate.inputPerMillionUSD
  + all.length * tokens * rate.outputPerMillionUSD) / 1e6).toFixed(4);
const prior = JSON.parse(await readFile(`${base}/report.json`, "utf8"));
const plan = {
  version: 1, preparedAt: new Date().toISOString(), state: "prelaunch only; no new paid calls",
  documentId: "DOC-HINT-UNIFIED-REPLAY", caseId: "HINT-MODEL-HISTORY-001",
  ownerDecisions: { "UNIFIED.1": "нет, модель не выбираем", "UNIFIED.2": "да, сначала калибровка, затем досверка, перед запуском число и цена" },
  model: original.judge.model, notCandidate: !original.models.includes(original.judge.model),
  generationRequests: 0, calibrationRequests: 20, currentResponsesSaved: 450,
  currentJudgeRequests: 448, invalidContractKeptUnknownWithoutModelCalls: gens.filter((g: any) => g.status !== "complete").map((g: any) => g.id),
  historicalJudgeRequests: 188, maximumRequests: 656, repeats: 0,
  gate: "All 20 calibrations and required field/citation checks must pass, no structural or semantic contradiction. If not, stop after calibration; preserve mismatches, no automatic prompt iterations/retries.",
  calibrationSource: "Hand-authored contrastive cases with fixed expected flags; independent from candidate generators; attached saved-text reference is unchanged, not human/audio-verified",
  freezeSHA256: freeze.sha256, judgeSystemSHA256: createHash("sha256").update(judgeV2System).digest("hex"),
  measurement: "Same calibrated judge and definitions for all current/historical replies; keep prior judgments unchanged; separate old overall/new usefulness scales",
  pricing: { publicRate: rate, estimator: "UTF-8 request bytes/4 for input; all 656 queued requests; no cache discounts; not invoice",
    estimatedInputTokens: inputEstimate, observedPriorOutputMeanTokens: +outputReferenceMean.toFixed(2),
    estimateAtPriorOutputMeanUSD: atOutput(outputReferenceMean), estimateAt300OutputTokensUSD: atOutput(300),
    estimateAt500OutputTokensUSD: atOutput(500),
    maxOutputTokensPerRequest: 1500,
    conservativeByteBoundAllOutputCapsUSD: +(((inputBytes + all.length * 256) * rate.inputPerMillionUSD + all.length * 1500 * rate.outputPerMillionUSD) / 1e6).toFixed(4),
    originalAuthorizationUSD: 35, previousConservativeAccountingUSD: prior.execution.chargedConservativeUSD,
    maximumAdditionalWithinOriginalAccountingUSD: +(35 - prior.execution.chargedConservativeUSD).toFixed(6),
    proposedNewStageCapUSD: 10,
    alternativeKeepOriginalAccountingCapUSD: 7.80,
    proposedTotalConservativeAccountingUSD: +(prior.execution.chargedConservativeUSD + 10).toFixed(6),
    proposedCapNeedsOwnerApproval: true,
    limitBehavior: "Reserve before each call; include inflight/missing usage. Stop before cap, also globally on insufficient_quota. No guarantee all jobs finish at a tighter cap.",
  },
  nextPromptRule: { status: "candidate for a later experiment AFTER model selection; NOT changed now",
    source: "Прямое указание владельца",
    text: "«ответ за владельца / выдуманное состояние» встречается у всех моделей. При неизвестном состоянии владельца — не утверждать, а нейтральная фраза или 2 варианта.",
    observedExamples: [
      { model: "gpt-4.1-mini", fixtureId: "october-2:12", issue: "user_input frame hardcodes calls/texts working before Owner answer" },
      { model: "gpt-5.6-luna", fixtureId: "october-2:24", issue: "I see the menu before Owner confirms current menu" },
      { model: "gpt-5.6-terra", fixtureId: "october-2:20", issue: "I'm in Settings now before Owner confirms" },
      { model: "gpt-5.2", fixtureId: "october-3:2", issue: "didn't seal/leaked before spill/defect confirmed in prior text" },
      { model: "gpt-5.6-sol", fixtureId: "october-2:20", issue: "I'm in Settings now before Owner confirms" },
    ], evidenceMethod: "P.LAB limited manual inspection against frozen prior texts; not aggregate quality scores or verified iPhone display",
  },
  productChanged: false, paidCallsMade: 0,
};
await writeFile(`${dir}/calibration.json`, JSON.stringify(calibration, null, 2));
await writeFile(`${dir}/judge-jobs.json`, JSON.stringify(jobs, null, 2));
await writeFile(`${dir}/preflight.json`, JSON.stringify(plan, null, 2));
console.log(JSON.stringify(plan, null, 2));
