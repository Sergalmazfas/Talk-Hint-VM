/**
 * Explicit owner-requested review of ONE already-authorized snapshot.
 * No source/prod writes, calls, audio replay or scheduling.
 * Email submission requires the separate --send-prepared-once action.
 * Stable private Dev job key prevents a second paid pass of the same snapshot.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pool, dbReady } from "../server/db";
import { authorizedHintSource } from "../server/callLab/source";
import { runHintLab, labAnalysisFailure } from "../server/callLab/process";
import { unavailableReport } from "../server/callLab/service";
import { completeLabReport, renderProcessLetter } from "../server/callLab/processReport";
import { GmailLabMail } from "../server/callLab/mail";
import { safeLabError } from "../server/callLab/startup";
import { messageIdFor } from "../server/callLab/store";

let stage = "input";
async function privateDevOwner() {
  const controls = (await pool!.query(`SELECT owner_id,recipient,connection_id FROM call_lab_controls
    WHERE environment='development' LIMIT 2`)).rows;
  stage = "dev_owner";
  if (controls.length !== 1 || controls[0].connection_id !== process.env.LAB_GMAIL_CONNECTION_ID)
    throw new Error("PRIVATE_DEV_OWNER_REQUIRED");
  stage = "gmail_verification";
  await new GmailLabMail().verify(controls[0]);
  return controls[0];
}

async function sendPreparedOnce() {
  const key = process.argv[process.argv.indexOf("--report-key") + 1];
  if (!process.argv.includes("--report-key") || !/^[a-f0-9]{64}$/.test(key))
    throw new Error("MANUAL_INPUT_REQUIRED");
  const binding = await privateDevOwner();
  const result = await pool!.query(`SELECT report FROM call_lab_jobs WHERE key=$1
    AND environment='development' AND owner_id=$2 AND status='manual_report_ready'`, [key, binding.owner_id]);
  const report = result.rows[0]?.report;
  if (!report?.manual_trigger || report.source_environment !== "production")
    throw new Error("AUTHORIZED_EXISTING_SOURCE_REQUIRED");
  const reserved = await pool!.query(`INSERT INTO call_lab_outbox(key,environment,owner_id,message_id,status)
    VALUES($1,'development',$2,$3,'sending') ON CONFLICT DO NOTHING RETURNING key`,
  [key, binding.owner_id, messageIdFor(key)]);
  if (!reserved.rows.length) throw new Error("MANUAL_PASS_ALREADY_RESERVED_NO_RETRY");
  stage = "manual_mail";
  const mail = new GmailLabMail();
  try {
    const id = await mail.send(binding, messageIdFor(key), report);
    await pool!.query("UPDATE call_lab_outbox SET status='unknown',gmail_id=$2,updated_at=now() WHERE key=$1", [key, id]);
    const found = await mail.sent(binding, messageIdFor(key), id);
    if (found) await pool!.query("UPDATE call_lab_outbox SET status='sent_confirmed',updated_at=now() WHERE key=$1", [key]);
    console.log(JSON.stringify({ manualMail: found ? "sent_confirmed" : "unknown", automaticRetries: false }));
  } catch {
    await pool!.query("UPDATE call_lab_outbox SET status='unknown',updated_at=now() WHERE key=$1", [key]);
    throw new Error("LAB_MAIL_DEADLINE");
  }
}

async function main() {
  await dbReady;
  if (process.env.NODE_ENV === "production" || !pool ||
      !process.argv.includes("--execute-once") && !process.argv.includes("--send-prepared-once"))
    throw new Error("DEV_EXPLICIT_MANUAL_PASS_ONLY");
  if (process.argv.includes("--send-prepared-once")) return sendPreparedOnce();
  const diagnostic = process.argv.includes("--diagnostic-pass-2");
  const binding = await privateDevOwner(); // read-only, never sends
  let snapshot: any, source: any, previousManualKey: string | undefined;
  stage = "source";
  if (diagnostic) {
    previousManualKey = process.argv[process.argv.indexOf("--source-report-key") + 1];
    if (!process.argv.includes("--source-report-key") || !/^[a-f0-9]{64}$/.test(previousManualKey || ""))
      throw new Error("MANUAL_INPUT_REQUIRED");
    const previous = (await pool.query(`SELECT source,report,call_sid FROM call_lab_jobs
      WHERE key=$1 AND environment='development' AND owner_id=$2 AND status='manual_report_ready'`,
    [previousManualKey, binding.owner_id])).rows[0];
    source = previous?.source;
    if (!previous?.report?.manual_trigger || previous.report.source_environment !== "production" ||
        !source || source.environment !== "production" || source.mode !== "hint" ||
        source.owner_verified !== true || source.processing_authorized !== true ||
        source.call_id !== previous.call_sid)
      throw new Error("AUTHORIZED_EXISTING_SOURCE_REQUIRED");
    snapshot = {
      previous_report_key: previous.report.previous_report_key,
      call: { call_sid: source.call_id, ended_at: source.ended_at,
        started_at: Number.isFinite(source.duration_ms)
          ? new Date(Date.parse(source.ended_at) - source.duration_ms).toISOString() : undefined },
    };
    const expectedParent = createHash("sha256")
      .update(`owner-requested-reanalysis-v1:${snapshot.previous_report_key}`).digest("hex");
    if (previousManualKey !== expectedParent) throw new Error("AUTHORIZED_EXISTING_SOURCE_REQUIRED");
  } else {
    const input = process.argv[process.argv.indexOf("--input") + 1];
    if (!input || !process.argv.includes("--input")) throw new Error("MANUAL_INPUT_REQUIRED");
    snapshot = JSON.parse(await readFile(input, "utf8"));
    source = authorizedHintSource(snapshot.call, snapshot.control, snapshot.control.environment);
  }
  if (!source || !/^[a-f0-9]{64}$/.test(snapshot.previous_report_key))
    throw new Error("AUTHORIZED_EXISTING_SOURCE_REQUIRED");
  const key = createHash("sha256")
    .update(`owner-requested-reanalysis-${diagnostic ? "v2" : "v1"}:${snapshot.previous_report_key}`).digest("hex");
  const inserted = await pool.query(`INSERT INTO call_lab_jobs
    (key,environment,owner_id,call_sid,status,attempts,journal)
    VALUES($1,'development',$2,$3,'manual_running',1,
      '[{"kind":"owner_requested_cross_environment_review"}]'::jsonb)
    ON CONFLICT DO NOTHING RETURNING key`,
  [key, binding.owner_id, snapshot.call.call_sid]);
  if (!inserted.rows.length) throw new Error("MANUAL_PASS_ALREADY_RESERVED_NO_RETRY");
  stage = "analysis";
  let report: any;
  try {
    report = await runHintLab(source);
  } catch (error) {
    report = { ...unavailableReport(snapshot.call, "Повторный разбор не завершён."),
      analysis_failure: labAnalysisFailure(error) };
  }
  report = completeLabReport({ ...report, environment: "development",
    source_environment: source.environment, execution_environment: "development",
    execution: report.execution === "analysis_not_completed" ? report.execution : "owner_requested_crewai_reanalysis",
    manual_trigger: true, automatic_production_execution: false,
    previous_report_key: snapshot.previous_report_key,
    ...(diagnostic ? { manual_pass: 2, previous_manual_report_key: previousManualKey,
      diagnostic_authorization: "Owner explicitly approved one additional diagnostic pass; no email submission." } : {}),
    provenance: "One owner-authorized CrewAI pass over the saved production snapshot. Original unchanged.",
  }, source, key);
  stage = "save";
  const saved = await pool.query(`UPDATE call_lab_jobs SET status='manual_report_ready',source=$2::jsonb,
    report=$3::jsonb,updated_at=now() WHERE key=$1`, [key, JSON.stringify(source), JSON.stringify(report)]);
  if (saved.rowCount !== 1) throw new Error("MANUAL_RESULT_NOT_SAVED");
  // Intentionally no outbox insertion; a saved file is not a sent email.
  const directory = path.resolve(diagnostic
    ? "generated-artifacts/mint-hint-reanalysis-diagnostic-2" : "generated-artifacts/mint-hint-reanalysis");
  await mkdir(directory, { recursive: true });
  const letter = renderProcessLetter(report);
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(directory, "letter.txt"), `${letter.subject}\n\n${letter.body}`);
  const escape = (v: string) => v.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  await writeFile(path.join(directory, "report.html"), `<!doctype html><html lang="ru"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>Hint · повторный разбор Mint</title>
    <style>body{max-width:760px;margin:24px auto;padding:0 18px;font:16px/1.5 system-ui;color:#172033}
    pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}summary{cursor:pointer}h1{font-size:24px}</style>
    <h1>Hint · повторный разбор Mint</h1><p>Ручной запуск CrewAI по сохранённому production-снимку.
    Выполнен из Dev. Исходный отчёт не изменён. Это не приёмка владельцем.</p>
    <pre>${escape(letter.body)}</pre><details><summary>Полные данные и ограничения</summary>
    <pre>${escape(JSON.stringify(report, null, 2))}</pre></details></html>`);
  console.log(JSON.stringify({ key, execution: report.execution, qa: report.qa_status,
    failure: report.analysis_failure ?? null, measurements: report.deterministic,
    privateReportPath: report.private_report_path, files: directory, mailSent: false }));
}

main().catch(error => {
  const ownCodes = new Set(["DEV_EXPLICIT_MANUAL_PASS_ONLY", "MANUAL_INPUT_REQUIRED",
    "AUTHORIZED_EXISTING_SOURCE_REQUIRED", "PRIVATE_DEV_OWNER_REQUIRED", "MANUAL_PASS_ALREADY_RESERVED_NO_RETRY"]);
  console.error(JSON.stringify({ status: "blocked", stage,
    code: ownCodes.has(error?.message) ? error.message : safeLabError(error), mailSent: false }));
  process.exitCode = 1;
})
  .finally(async () => { await pool?.end(); });
