/** Last permitted calibration: offline inputs only, preserve both prior rounds. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { judgeV2System } from "./unified-hint-judge-v2";
const dir = "generated-artifacts/hint-unified-rescore-final";
await mkdir(dir, { recursive: true });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const original = JSON.parse(await readFile("generated-artifacts/hint-unified-rescore/preflight.json", "utf8"));
const oldResult = JSON.parse(await readFile("generated-artifacts/hint-unified-rescore/RESULT.json", "utf8"));
assert.equal(oldResult.conservativeUSD, .11625);
const frozenText = await readFile("generated-artifacts/hint-unified-preflight/frozen-reference-v1.json", "utf8");
assert.equal(sha(frozenText), original.freezeSHA256);
const fs = JSON.parse(frozenText);
const definition = "«ответ за владельца» — подсказка утверждает факт о состоянии/действии владельца, которого нет ни в цели, ни в его репликах (пример: «я вижу кнопку», «звонки работают», «я не перезагружал»). НЕ считается: варианты на выбор, вопрос собеседнику, факт, уже сказанный владельцем или есть в цели.";
const start = judgeV2System.indexOf("- speakingForOwner means");
const end = judgeV2System.indexOf("- Clearly labelled CHOICE", start);
assert(start > 0 && end > start);
const system = judgeV2System.slice(0, start) + `- OWNER-APPROVED NARROW DEFINITION (supersedes the broader prior one):
  speakingForOwner=true ONLY when the hint asserts a fact about OWNER'S own current/past
  state or action absent from BOTH explicit Goal facts and prior Owner utterances.
  Examples: "I see the button", "calls work", "I have not restarted".
  NOT this flag: clearly conditional choice alternatives; a question to Guest;
  a fact explicitly already in Goal or Owner speech; ordinary acknowledgment or proposed future action.
  An assertion about what GUEST/another party did (e.g. "you read the photos") may be
  inventedFacts=true, but speakingForOwner=false unless it ALSO asserts unknown OWNER state/action.
  Do not broaden this flag to every fact/decision in a proposed reply.
  An unsolicited request/financial decision is assessed under goal/usefulness, not automatically this flag.
  A claim that OWNER was charged twice IS about Owner's financial state and needs evidence.
  Questions are not assertions; an asserted clause followed by a question still contains an assertion.
  Explicit Goal FACTS count as evidence; Goal INTENT does not establish completion.
` + judgeV2System.slice(end);
const direct = (en: string) => ({ type: "direct", cards: [{ en, translation: "", label: "" }], guestTranslation: "" });
const pairs: any[] = [
  { id: "reset-screen", fixtureId: "october-2:24",
    good: direct("Which reset option should I choose next?"),
    bad: direct("I can see the reset options menu on my screen.") },
  { id: "negative-restart", fixtureId: "october-1:19",
    good: { type: "choice", cards: [
      { label: "Перезагружал", en: "Yes, I restarted the phone.", translation: "" },
      { label: "Ещё нет", en: "No, I haven't restarted it yet.", translation: "" }], guestTranslation: "" },
    bad: direct("No, I have not restarted the phone since inserting the SIM.") },
  { id: "known-installed-app", fixtureId: "august-fixture-2:8",
    good: direct("The Mint app is installed. Where is Activate a SIM?"),
    bad: direct("I have already activated my new eSIM successfully.") },
  { id: "explicit-goal-only", fixtureId: "august-fixture-2:4", goalOnly: true,
    good: direct("I want to keep my existing number on my new iPhone."),
    bad: direct("My existing number has already transferred and is working on the new iPhone.") },
  { id: "known-activate-option", fixtureId: "august-fixture-2:10",
    good: direct("I see the Activate a SIM option. Where can I find the code?"),
    bad: direct("I found the code and entered all eleven digits.") },
  { id: "future-not-completion", fixtureId: "august-fixture-2:16",
    good: direct("I'll choose eSIM and follow the checkout steps."),
    bad: direct("I completed checkout and received the replacement activation code.") },
  { id: "third-party-not-owner", fixtureId: "october-3:14", badOwner: false,
    good: direct("Could you confirm whether my email arrived?"),
    bad: direct("You have read the photos from my email.") },
  { id: "unknown-purchase", fixtureId: "october-3:23",
    good: direct("Could you check which items are on the receipt?"),
    bad: direct("I bought empanadas with my coffee.") },
  { id: "ordinary-acknowledgment", fixtureId: "october-1:0",
    good: direct("All right, thanks for letting me know."),
    bad: direct("I have just fixed the connection and can use mobile data again.") },
  { id: "known-data-unknown-calls", fixtureId: "october-2:12",
    good: direct("Mobile data isn't working. Could you help me diagnose it?"),
    bad: direct("Only mobile data is affected; my calls and texts work normally.") },
];
const previous = JSON.parse(await readFile("generated-artifacts/hint-unified-rescore/calibration.json", "utf8"));
const calibration: any[] = [];
for (const p of pairs) {
  assert(!previous.some((x: any) => x.fixtureId === p.fixtureId), `not fresh context: ${p.fixtureId}`);
  const f = structuredClone(fs.find((f: any) => f.id === p.fixtureId)); assert(f);
  if (p.goalOnly) { f.history = ""; f.reference.ownerEvidence = []; }
  for (const quality of ["good", "bad"]) {
    const candidate = p[quality];
    calibration.push({ id: `final:${p.id}:${quality}`, fixtureId: f.id, kind: "synthetic contrastive calibration, not real model output",
      syntheticGoalOnlyControl: !!p.goalOnly, candidate,
      expected: { inventedFacts: quality === "bad", speakingForOwner: quality === "bad" && p.badOwner !== false,
        ...(quality === "good" ? { goal: "yes" } : {}) },
      messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({
        reference: f.reference, conversationBefore: f.history, currentGuest: f.guest, candidate }) }] });
  }
}
const jobs = JSON.parse(await readFile("generated-artifacts/hint-unified-rescore/judge-jobs.json", "utf8"));
for (const j of jobs) j.messages[0].content = system;
assert.equal(jobs.length, 636); assert.equal(calibration.length, 20);
const bytes = [...calibration, ...jobs].reduce((n, j) => n + Buffer.byteLength(JSON.stringify(j.messages)), 0);
const rate = original.pricing.publicRate;
const input = Math.ceil(bytes / 4);
const estimate = (out: number) => +((input * rate.inputPerMillionUSD + 656*out*rate.outputPerMillionUSD)/1e6).toFixed(4);
const plan = { ...original, version: 2, preparedAt: new Date().toISOString(), state: "One final calibration authorized by Owner",
  ownerDefinition: { source: "Прямое решение владельца", text: definition, appliesToFutureHintPromptButNotChangedNow: true },
  ownerBudgetAuthorization: { answer: "Продолжай, в оставшемся лимите $9,88", maximumUSD: 9.88,
    maximumRequests: 656, calibrationMaximumAttempts: 1, retries: 0,
    priorStageUSD: oldResult.conservativeUSD, totalJudgingStageCapUSD: 9.99625,
    failureAction: "STOP judge route permanently for this comparison; next Need Decision: owner-only live pilot, not activated" },
  judgeSystemSHA256: sha(system),
  gate: "Exactly one final calibration: all 20 expected cases AND structural/source checks must match. If any mismatch/failure: no bulk, no third calibration, close judge route.",
  pricing: { ...original.pricing, estimatedInputTokens: input, estimateAtPriorOutputMeanUSD: estimate(original.pricing.observedPriorOutputMeanTokens),
    estimateAt300OutputTokensUSD: estimate(300), estimateAt500OutputTokensUSD: estimate(500),
    authorizedStageCapUSD: 9.88, proposedCapNeedsOwnerApproval: false },
};
await writeFile(`${dir}/preflight.json`, JSON.stringify(plan, null, 2), { flag: "wx" });
await writeFile(`${dir}/calibration.json`, JSON.stringify(calibration, null, 2), { flag: "wx" });
await writeFile(`${dir}/judge-jobs.json`, JSON.stringify(jobs, null, 2), { flag: "wx" });
await writeFile(`${dir}/JUDGE.txt`, system, { flag: "wx" });
console.log(JSON.stringify({ calls: 656, generation: 0, calibration: 20, current: 448, historical: 188,
  costRangeUSD: [estimate(original.pricing.observedPriorOutputMeanTokens), estimate(500)], cap: 9.88 }));
