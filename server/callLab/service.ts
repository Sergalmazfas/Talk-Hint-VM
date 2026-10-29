import type { Pool } from "pg";
import { isBenchmarkAdmin } from "../benchmark/adminGate";
import { GmailLabMail } from "./mail";
import { startHintDaily } from "./dailyReport";
import { completeLabReport } from "./processReport";
import { LabStore } from "./store";
import { runHintLab, checkHintLabRuntime, cleanupLabScratch, labAnalysisFailure } from "./process";
import { authorizedHintSource, registerLabSourceOwner } from "./source";
import { startHintWatchdog } from "./watchdog";
import { labStartupReady, labStartupStatus, labStartupStep, resetLabStartup } from "./startup";
import { ownerCallsSql, modeNotice } from "./policy";
import { attachProductFollowup } from "./productContext";

const environment = () => process.env.NODE_ENV === "production" ? "production" : "development";
let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | undefined;
let active: AbortController | undefined;
let boundOwnerId: string | undefined;
let stopping = false;
let stopWatchdog: (() => void) | undefined;
let stopDaily: (() => void) | undefined;
let bootstrapping: Promise<void> | undefined;
export const labEnvironment = environment;

export function labConfiguration() {
  const env = environment();
  return {
    environment: env, owner: boundOwnerId ?? process.env.LAB_OWNER_ID,
    allowed: process.env.LAB_ENABLED === "true" && process.env.LAB_TARGET_ENVIRONMENT === env &&
      !!(boundOwnerId ?? process.env.LAB_OWNER_ID),
  };
}

// Monitoring is independent from LAB_ENABLED and the analysis kill switch.
export function ownerMonitoringConfiguration() {
  const c = labConfiguration();
  return { ...c, allowed: !!c.owner && process.env.LAB_TARGET_ENVIRONMENT === c.environment };
}

export async function bindLabOwner(pool: Pick<Pool, "query">, ownerId: string, mail = new GmailLabMail()) {
  const q = await pool.query("SELECT id,email FROM users WHERE id=$1", [ownerId]);
  const user = q.rows[0];
  if (!user || !isBenchmarkAdmin(user.email)) throw new Error("LAB_OWNER_NOT_ADMIN");
  return mail.bindingFor(user.email);
}

export async function bootstrapLab(pool: Pool, options: { expectedOwnerId?: string; startup?: boolean } = {}) {
  if (!bootstrapping) {
    bootstrapping = (async () => {
      const connectionId = await labStartupStep("configuration", async () => {
        if (!process.env.LAB_GMAIL_CONNECTION_ID) throw new Error("LAB_GMAIL_NOT_PINNED");
        return process.env.LAB_GMAIL_CONNECTION_ID;
      });
      const profile = await labStartupStep("gmail", () => new GmailLabMail().profile(connectionId));
      const owner = await labStartupStep("owner", async () => {
        if (!isBenchmarkAdmin(profile)) throw new Error("LAB_OWNER_NOT_ADMIN");
        const value = (await pool.query("SELECT id FROM users WHERE lower(email)=$1", [profile])).rows[0];
        if (!value) throw new Error("LAB_OWNER_NOT_FOUND");
        if ((process.env.LAB_OWNER_ID && value.id !== process.env.LAB_OWNER_ID) ||
            (options.expectedOwnerId && value.id !== options.expectedOwnerId))
          throw new Error("LAB_OWNER_MISMATCH");
        return value;
      });
      const env = environment(), key = `${env}:${owner.id}`;
      const autoResume = options.startup !== false && env === "production" &&
        process.env.LAB_ENABLED === "true" && process.env.LAB_TARGET_ENVIRONMENT === env;
      const autoMonitor = env === "production" && process.env.LAB_TARGET_ENVIRONMENT === env;
      await labStartupStep("control", () => pool.query(`INSERT INTO call_lab_controls
        (key,environment,owner_id,recipient,connection_id,enabled)
        VALUES($1,$2,$3,$4,$5,false) ON CONFLICT(key) DO UPDATE
        SET recipient=EXCLUDED.recipient,connection_id=EXCLUDED.connection_id`,
      [key, env, owner.id, profile, connectionId]));
      boundOwnerId = owner.id;
      registerLabSourceOwner(owner.id);
      // Establish independent duty coverage before checking the Python worker.
      for (const prefix of ["owner-ops:", "hint-daily:"]) {
        await pool.query(`INSERT INTO call_lab_controls
          (key,environment,owner_id,recipient,connection_id,enabled)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(key) DO UPDATE
          SET recipient=EXCLUDED.recipient,connection_id=EXCLUDED.connection_id,
          enabled=CASE WHEN $6 THEN true ELSE call_lab_controls.enabled END`,
        [`${prefix}${key}`, env, owner.id, profile, connectionId, autoMonitor]);
      }
      stopWatchdog ??= startHintWatchdog(pool, ownerMonitoringConfiguration);
      stopDaily ??= startHintDaily(pool, ownerMonitoringConfiguration);
      await labStartupStep("worker", async () => {
        await checkHintLabRuntime();
        if (!process.env.OPENAI_API_KEY) throw new Error("LAB_MODEL_NOT_CONFIGURED");
      });
      // Failed readiness never enables analysis. Successful production readiness
      // implements the owner's standing authorization without a post-publish click.
      if (autoResume) await pool.query("UPDATE call_lab_controls SET enabled=true WHERE key=$1", [key]);
      labStartupReady();
    })();
  }
  const attempt = bootstrapping;
  try {
    await attempt;
    if (options.expectedOwnerId && options.expectedOwnerId !== boundOwnerId)
      throw new Error("LAB_OWNER_MISMATCH");
  } finally { if (bootstrapping === attempt) bootstrapping = undefined; }
}

export function unavailableReport(call: any, reason: string) {
  return {
    format: "talkhint.plab.call-report", version: 1, mode: "hint", call_id: call.call_sid,
    environment: environment(), synthetic: false, ended_at: call.ended_at, languages: [],
    duration_ms: Number.isFinite(Date.parse(call.ended_at) - Date.parse(call.started_at))
      ? Date.parse(call.ended_at) - Date.parse(call.started_at) : null,
    framework: { version: "1.15.30" }, model: process.env.LAB_MODEL || "gpt-5.2",
    model_basis: "configured; execution not confirmed",
    execution: "analysis_not_completed",
    analysis: { summary_ru: "Разбор не завершён", findings: [], limitations: [reason], proposals: [] },
    replay: { status: "не выполнен" }, qa_status: "НЕ ПРОВЕРЕНО QA", qa_issues: [reason],
    letter: { summary_ru: "Материалы звонка получены лабораторией, но надёжный разбор не завершён.",
      quality_ru: "Неизвестно. Оценки не выдуманы.", limitations_ru: [reason],
      proposals_ru: ["Проверить блокер в закрытом журнале лаборатории."] },
    metrics: { ai_classified_errors: null, confirmed_missed_hints: null, wer: null, minute_price: null },
    mail_status: "prepared", delivery_confirmed: false,
  };
}

async function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new Error("LAB_MAIL_DEADLINE")), ms);
    })]);
  } finally { if (t) clearTimeout(t); }
}

export async function hintLabTick(pool: Pool, dependencies: {
  run: typeof runHintLab; mail: Pick<GmailLabMail, "verify" | "sent" | "send">;
  product?: typeof attachProductFollowup;
} = {
  run: runHintLab, mail: new GmailLabMail(),
}) {
  const config = labConfiguration();
  if (!config.owner) return;
  const client = await pool.connect();
  const lockName = `hint-lab:${config.environment}:${config.owner}`;
  let locked = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [lockName])).rows[0].ok;
    if (!locked) return;
    const store = new LabStore(client);
    const finishWithProduct = async (key: string, source: any, report: any) => {
      const result = await (dependencies.product ?? attachProductFollowup)(pool, report, source,
        { owner: config.owner!, environment: config.environment });
      await store.finish(key, source, result);
      // Existing per-call execution journal, not an independent product catalogue.
      const decisions = result.product_followup.issues.filter((i: any) => i.decision === "awaiting_owner").length;
      await store.note(key, `product:decision_prepared:${decisions}:${result.product_followup.decisionStatus}`);
      if (result.product_followup.contextStatus !== "available") await store.note(key, "product:context_unavailable");
    };
    await store.retention(config.environment, config.owner);
    if (!config.allowed) return;
    const control = (await client.query("SELECT * FROM call_lab_controls WHERE key=$1",
      [`${config.environment}:${config.owner}`])).rows[0];
    if (!control?.enabled) return;
    await dependencies.mail.verify(control);
    await store.recover(config.environment, config.owner);
    // Source reconciliation recovers the gap between source commit and a process crash.
    // No old calls, guessed modes, synthetic production calls or other users.
    const candidates = await client.query(`SELECT c.call_sid FROM (${ownerCallsSql}) c
      WHERE c.user_id=$1 AND c.started_at>=$2 AND c.ended_at IS NOT NULL
      AND coalesce(c.metadata#>>'{labHintSource,environment}',$3)=$3
      AND NOT EXISTS(SELECT 1 FROM call_lab_jobs j WHERE j.environment=$3 AND j.owner_id=$1 AND j.call_sid=c.call_sid)
      ORDER BY c.ended_at LIMIT 100`, [config.owner, control.activated_at, config.environment]);
    for (const row of candidates.rows) await store.enqueue(config.environment, config.owner, row.call_sid);
    const job = await store.claim(config.environment, config.owner);
    if (job) {
      await store.note(job.key, "analysis:claimed");
      const call = (await client.query(`SELECT * FROM (${ownerCallsSql}) c
        WHERE call_sid=$1 AND user_id=$2`, [job.call_sid, config.owner])).rows[0];
      // Deleted or re-owned calls never leave an informational email with private content.
      if (!call) {
        await store.fail(job.key, "source:scope_rejected");
      } else if (call.lab_mode !== "hint") {
        await finishWithProduct(job.key, null, modeNotice(call, config.environment));
        await store.note(job.key, `mode:${call.lab_mode}:analysis_not_connected`);
      } else {
        const source = authorizedHintSource(call, control, config.environment);
        if (!source) {
          await finishWithProduct(job.key, null, completeLabReport(
            unavailableReport(call, "SOURCE_UNAVAILABLE: нет достаточного разрешённого сохранённого текста."),
            null, job.key));
        } else {
          active = new AbortController();
          const aborter = active;
          // Kill switch remains responsive during model processing.
          let watcherBusy = false;
          const watcher = setInterval(() => {
            if (watcherBusy) return;
            watcherBusy = true;
            void pool.query("SELECT enabled FROM call_lab_controls WHERE key=$1", [control.key])
              .then(q => { if (!q.rows[0]?.enabled || !labConfiguration().allowed) aborter.abort(); })
              .catch(() => aborter.abort()).finally(() => { watcherBusy = false; });
          }, 3_000);
          try {
            const report = await dependencies.run(source, { signal: aborter.signal });
            if (aborter.signal.aborted) {
              await store.fail(job.key, "analysis:canceled");
            } else {
              await finishWithProduct(job.key, source, completeLabReport(report, source, job.key));
              await store.note(job.key, `qa:${report.qa_status === "QA: принято" ? "accepted" : "unverified_or_returned"}`);
            }
          } catch (error) {
            if (aborter.signal.aborted) await store.fail(job.key, "analysis:canceled");
            else {
              const failure = labAnalysisFailure(error);
              console.warn(`[HintLab] Analysis failed stage=${failure.stage} code=${failure.code}`);
              const report = { ...unavailableReport(call, `MODEL_FAILURE: ${failure.code}; этап ${failure.stage}.`),
                analysis_failure: failure };
              await finishWithProduct(job.key, source, completeLabReport(report, source, job.key));
              await store.note(job.key, `analysis:failed:${failure.stage}:${failure.code}`);
            }
          } finally {
            clearInterval(watcher);
            active = undefined;
          }
        }
      }
    }
    // Re-read switch before ANY non-idempotent external write.
    const enabled = (await client.query("SELECT enabled FROM call_lab_controls WHERE key=$1", [control.key])).rows[0]?.enabled;
    if (!enabled || !labConfiguration().allowed || stopping) return;
    const unknown = await client.query(`SELECT * FROM call_lab_outbox WHERE environment=$1 AND owner_id=$2
      AND status='unknown' AND reconcile_count<3 AND updated_at<now()-interval '30 seconds' LIMIT 10`,
    [config.environment, config.owner]);
    for (const row of unknown.rows) {
      const found = await deadline(dependencies.mail.sent(control, row.message_id, row.gmail_id), 30_000);
      if (found) await store.mailState(row.key, "sent_confirmed", found);
      else await client.query(`UPDATE call_lab_outbox SET reconcile_count=reconcile_count+1,
        status=CASE WHEN reconcile_count>=2 THEN 'needs_review' ELSE 'unknown' END,updated_at=now() WHERE key=$1`, [row.key]);
      // Absence in SENT never grants permission to resend an ambiguous delivery.
    }
    const message = await store.claimMail(config.environment, config.owner);
    if (!message) return;
    try {
      await store.note(message.key, "mail:send_started");
      const existing = await deadline(dependencies.mail.sent(control, message.message_id), 30_000);
      if (existing) await store.mailState(message.key, "sent_confirmed", existing);
      else {
        const id = await deadline(dependencies.mail.send(control, message.message_id, message.report, async () =>
          !stopping && labConfiguration().allowed &&
          !!(await client.query("SELECT enabled FROM call_lab_controls WHERE key=$1", [control.key])).rows[0]?.enabled), 60_000);
        await store.mailState(message.key, "gmail_accepted", id);
        // Confirm the known Gmail ID; the transport can rewrite RFC Message-ID.
        // SENT still does not prove inbox delivery or the owner's acceptance.
        const found = await deadline(dependencies.mail.sent(control, message.message_id, id), 30_000);
        if (found) await store.mailState(message.key, "sent_confirmed", found);
        else await store.mailState(message.key, "unknown", id);
      }
    } catch (error) {
      await store.mailState(message.key, error instanceof Error && error.message === "LAB_MAIL_PAUSED" ? "paused" : "unknown");
    }
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]).catch(() => {});
    client.release();
  }
}

export async function startHintLab(pool: Pool) {
  if (timer) return;
  stopping = false;
  resetLabStartup();
  let bootstrapped = false, nextBootstrapAttempt = 0;
  const tick = async () => {
    if (running || stopping) return;
    running = (async () => {
      if (!bootstrapped && labStartupStatus().status === "ready") bootstrapped = true;
      if (!bootstrapped) {
        if (Date.now() < nextBootstrapAttempt) return;
        try {
          await labStartupStep("scratch", cleanupLabScratch);
          await bootstrapLab(pool);
          bootstrapped = true;
          console.log("[HintLab] Resources checked; saved owner switch controls new Hint calls");
        } catch {
          nextBootstrapAttempt = Date.now() + 30_000;
          const s = labStartupStatus();
          console.warn(`[HintLab] BLOCKED stage=${s.stage} code=${s.code}; retry in 30s; calls unaffected`);
          if (s.runtimeDiagnostic)
            console.warn(`[HintLab] Python runtime diagnostic ${JSON.stringify(s.runtimeDiagnostic)}`);
          return;
        }
      }
      if (stopping) return;
      await hintLabTick(pool);
    })().catch(() => console.warn("[HintLab] BLOCKED: tick failed; see private status"))
      .finally(() => { running = undefined; });
    await running;
  };
  timer = setInterval(tick, 5_000);
  timer.unref();
  await tick();
}
export function stopHintLab() {
  stopping = true;
  stopWatchdog?.();
  stopWatchdog = undefined;
  stopDaily?.();
  stopDaily = undefined;
  if (timer) clearInterval(timer);
  timer = undefined;
  active?.abort();
}
export function abortHintLabProcessing() { active?.abort(); }
