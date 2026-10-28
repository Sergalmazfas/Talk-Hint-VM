/** Authorized $10 text-judging job. No candidate generation, app, DB, audio or mail. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, open, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { performance } from "node:perf_hooks";
import { parseJson } from "./unified-hint-metrics";
import { quotaFailure } from "./unified-hint-budget";
import { validateV2 } from "./unified-hint-rescore-checks";
assert(process.argv.includes("--owner-authorized-10-usd"));
const dir = "generated-artifacts/hint-unified-rescore", out = `${dir}/execution`;
const auth = JSON.parse(await readFile(`${dir}/AUTHORIZATION.json`, "utf8"));
assert.equal(auth.ownerBudgetAuthorization.answer, "До $10");
assert.equal(auth.ownerBudgetAuthorization.maximumUSD, 10);
const plan = JSON.parse(await readFile(`${dir}/preflight.json`, "utf8"));
const ct = await readFile(`${dir}/calibration.json`, "utf8"), jt = await readFile(`${dir}/judge-jobs.json`, "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
assert.equal(sha(ct), auth.calibrationFileSHA256); assert.equal(sha(jt), auth.jobsSHA256);
const calibration = JSON.parse(ct), jobs = JSON.parse(jt);
assert.equal(calibration.length, 20); assert.equal(jobs.length, 636);
assert([...calibration, ...jobs].every(j => sha(j.messages[0].content) === plan.judgeSystemSHA256));
const frozen = await readFile("generated-artifacts/hint-unified-preflight/frozen-reference-v1.json", "utf8");
assert.equal(sha(frozen), plan.freezeSHA256);
const fs = JSON.parse(frozen);
await mkdir(out, { recursive: true });
const lock = await open(`${out}/RUN_ONCE.json`, "wx");
await lock.writeFile(JSON.stringify({ startedAt: new Date().toISOString(), authorization: auth,
  calibrationSHA256: sha(ct), jobsSHA256: sha(jt), generationRequests: 0, maximumUSD: 10,
  maxRequests: 656, concurrency: 5, retries: 0 }));
await lock.close();
const sdk = new OpenAI({ maxRetries: 0, timeout: 60_000 });
const rate = plan.pricing.publicRate;
let used = 0, reserved = 0, actualUsage = 0, attempted = 0, stop: string | null = null;
let writeChain = Promise.resolve();
const rows: any[] = [], judgments: any[] = [];
const tally = () => ({ attemptedRequests: attempted, conservativeUSD: +used.toFixed(6),
  pricedUsageUSD: +actualUsage.toFixed(6), inflightReservedUSD: +reserved.toFixed(6), stopReason: stop });
async function persist() {
  writeChain = writeChain.then(() => writeFile(`${out}/progress.json`, JSON.stringify({ at: new Date().toISOString(), ...tally() })));
  await writeChain;
}
async function evaluate(job: any, isCalibration: boolean) {
  const inputBytes = Buffer.byteLength(JSON.stringify(job.messages));
  const bound = ((inputBytes + 256) * rate.inputPerMillionUSD + 1500 * rate.outputPerMillionUSD) / 1e6;
  const r: any = { id: job.id, sourceId: job.sourceId, fixtureId: job.fixtureId,
    kind: isCalibration ? "calibration" : "judge", sourceGroup: job.sourceGroup,
    status: "blocked", qualityStatus: "unknown", model: plan.model };
  rows.push(r); if (!isCalibration) judgments.push(r);
  if (stop) { r.stopReason = stop; return r; }
  if (attempted >= 656 || used + reserved + bound > 10) { stop = "budget_or_request_cap"; r.stopReason = stop; return r; }
  reserved += bound; attempted++;
  r.requestNumber = attempted; r.startedAt = new Date().toISOString(); r.status = "started";
  r.reservedUpperUSD = bound; r.messageSHA256 = sha(JSON.stringify(job.messages));
  const name = `${out}/request-${String(attempted).padStart(4, "0")}.json`;
  await writeFile(name, JSON.stringify(r), { flag: "wx" });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 60_000);
  const start = performance.now();
  try {
    const answer = await sdk.chat.completions.create({ model: plan.model, messages: job.messages,
      max_completion_tokens: 1500, reasoning_effort: "none", response_format: { type: "json_object" } },
      { signal: ctl.signal });
    r.rawOutput = answer.choices[0]?.message?.content ?? "";
    r.usage = answer.usage; r.providerModel = answer.model; r.finishReason = answer.choices[0]?.finish_reason;
    r.parsed = parseJson(r.rawOutput);
    const body = JSON.parse(job.messages[1].content);
    r.sourceAuditProblems = validateV2(r.parsed, body.candidate, body.reference);
    if (r.providerModel !== plan.model) r.sourceAuditProblems.push("unexpected judge snapshot");
    if (r.finishReason !== "stop") r.sourceAuditProblems.push("incomplete model output");
    r.status = "complete";
    r.qualityStatus = r.sourceAuditProblems.length ? "unknown" : "usable_ai_estimate";
    if (isCalibration) {
      r.expected = job.expected;
      r.expectedMismatches = Object.entries(job.expected).filter(([k, v]) => r.parsed[k] !== v)
        .map(([k, v]) => ({ field: k, expected: v, actual: r.parsed[k] }));
      r.calibrationMatched = r.qualityStatus === "usable_ai_estimate" && !r.expectedMismatches.length;
    }
  } catch (e: any) {
    r.status = "failed";
    r.error = e instanceof OpenAI.APIError ? { status: e.status, code: e.code, type: e.type }
      : { code: ctl.signal.aborted ? "TIMEOUT" : "PARSE_OR_TRANSPORT_ERROR" };
    if (e instanceof OpenAI.APIError && quotaFailure(e)) stop = "provider_quota_exhausted";
    if (e instanceof OpenAI.APIError && [401,403,404].includes(e.status ?? 0)) stop = "provider_access_or_model_unavailable";
  } finally {
    clearTimeout(timer);
    r.durationMs = performance.now() - start;
    reserved -= bound;
    r.accountedUSD = r.usage ? (r.usage.prompt_tokens * rate.inputPerMillionUSD +
      r.usage.completion_tokens * rate.outputPerMillionUSD) / 1e6 : bound;
    used += r.accountedUSD; if (r.usage) actualUsage += r.accountedUSD;
    if (used > 10) stop = "usage_exceeded_reservation_stop";
    await writeFile(name, JSON.stringify(r, null, 2));
    await appendFile(`${out}/ledger.jsonl`, JSON.stringify({ id: r.id, requestNumber: r.requestNumber,
      status: r.status, usage: r.usage ?? null, accountedUSD: r.accountedUSD }) + "\n");
    await persist();
  }
  return r;
}
async function group(input: any[], isCalibration: boolean) {
  let i = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (i < input.length) await evaluate(input[i++], isCalibration);
  }));
}
await group(calibration, true);
const cal = rows.filter(r => r.kind === "calibration");
const passed = cal.length === 20 && cal.every(r => r.calibrationMatched === true);
await writeFile(`${out}/calibration-results.json`, JSON.stringify(cal, null, 2));
console.log(JSON.stringify({ event: "CALIBRATION_COMPLETE", matched: cal.filter(r => r.calibrationMatched).length, passed, ...tally() }));
if (passed) await group(jobs, false);
await writeFile(`${out}/judgments.json`, JSON.stringify(judgments, null, 2));
const result = { completedAt: new Date().toISOString(), ...tally(),
  calibrationPassed: passed, calibrationMatched: cal.filter(r => r.calibrationMatched).length,
  calibrationExpected: 20, calibrationFailedCases: cal.filter(r => !r.calibrationMatched).map(r => ({
    id: r.id, status: r.status, expectedMismatches: r.expectedMismatches ?? [],
    sourceAuditProblems: r.sourceAuditProblems ?? [], error: r.error ?? null })),
  rescoredRequests: judgments.filter(r => r.requestNumber).length,
  rescoreUsableAI: judgments.filter(r => r.qualityStatus === "usable_ai_estimate").length,
  generationRequests: 0, maximumUSD: 10, retries: 0,
  candidatePromptChanged: false, productChanged: false, ownerModelSelected: false };
await writeFile(`${dir}/RESULT.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ event: "ALL_COMPLETE", ...result }));
