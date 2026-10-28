/** One bounded authorized saved-call diagnostic. Never mail or production writes. */
import { readFile, writeFile, open } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runHintLab, labAnalysisFailure } from "../server/callLab/process";
import { completeLabReport, renderProcessLetter } from "../server/callLab/processReport";
const pass = Number(process.argv.find(v => v.startsWith("--pass="))?.split("=")[1]);
assert([2, 3].includes(pass) && process.env.NODE_ENV !== "production");
const dir = "generated-artifacts/hint-owner-feedback-1";
await readFile(`${dir}/coffee-analysis-reservation.json`);
if (pass === 3) await readFile(`${dir}/coffee-pass-2-reservation.json`);
const source = JSON.parse(await readFile(`${dir}/coffee-diagnostic-source.json`, "utf8"));
assert(source.owner_verified && source.processing_authorized && source.mode === "hint");
const reservation = await open(`${dir}/coffee-pass-${pass}-reservation.json`, "wx");
await reservation.writeFile(JSON.stringify({ at: new Date().toISOString(), callId: source.call_id,
  pass, limit: 3, source: "Решение владельца 27.10.2026 / текущая задача", emailSent: false }));
await reservation.close();
try {
  const raw = await runHintLab(source);
  await writeFile(`${dir}/coffee-pass-${pass}-worker.json`, JSON.stringify(raw, null, 2));
  const key = createHash("sha256").update(`${source.call_id}:diagnostic:${pass}`).digest("hex");
  const report = completeLabReport({ ...raw, manual_trigger: true,
    owner_feedback: { usedHints: 0, basis: "direct_owner_feedback" } }, source, key);
  const letter = renderProcessLetter(report);
  await writeFile(`${dir}/coffee-pass-${pass}-report.json`, JSON.stringify(report, null, 2));
  await writeFile(`${dir}/coffee-pass-${pass}-letter.txt`, `${letter.subject}\n\n${letter.body}`);
  console.log(JSON.stringify({ completed: true, pass, qa: report.qa_status, qaIssues: report.qa_issues, emailSent: false }));
} catch (error) {
  const failure = labAnalysisFailure(error);
  await writeFile(`${dir}/coffee-pass-${pass}-failure.json`, JSON.stringify(failure, null, 2));
  console.log(JSON.stringify({ completed: false, pass, failure }));
  process.exitCode = 1;
}
