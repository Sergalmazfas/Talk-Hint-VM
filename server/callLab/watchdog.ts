import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { GmailLabMail } from "./mail";
import { messageIdFor } from "./store";
import { ownerCallsSql, labRelease } from "./policy";

// Technical grace periods, not approved business deadlines or quality KPIs.
export const watchdogPolicy = {
  pollMs: 15_000, missingEventMs: 60_000, queuedMs: 120_000,
  analysisMs: 11 * 60_000, mailMs: 120_000, scanLimit: 200,
};
type Config = { environment: string; owner?: string; allowed: boolean };
type Row = {
  call_sid: string; ended_at: string | Date | null; closed_at: string | null;
  job_key: string | null; job_status: string | null; job_created: string | Date | null;
  job_updated: string | Date | null; execution: string | null; qa_status: string | null;
  mail_status: string | null; mail_updated: string | Date | null;
};
export type Incident = {
  code: string; lastStep: string; expected: string; reason: string;
};
type Delivery = "prepared" | "sending" | "unknown" | "needs_review" | "sent_confirmed";
type Entry = Incident & {
  callRef: string;
  detectedAt: string; lastSeenAt: string; resolvedAt?: string;
  delivery: Delivery; gmailId?: string; checks?: number;
};
type State = Record<string, Entry>;
let snapshot: { state: string; checkedAt: string | null; attemptedAt: string | null; activeIncidents: number;
  notificationProblems: number; error?: string } = {
  state: "not_checked", checkedAt: null, attemptedAt: null, activeIncidents: 0, notificationProblems: 0,
};
export const hintWatchdogStatus = () => ({ ...snapshot,
  state: (snapshot.state === "checking" && older(snapshot.attemptedAt, 3 * watchdogPolicy.pollMs, Date.now())) ||
    (snapshot.state === "checked" && older(snapshot.checkedAt, 3 * watchdogPolicy.pollMs, Date.now()))
    ? "stale" : snapshot.state,
  policy: watchdogPolicy,
  scope: "All owner modes / calls after duty activation; last 200 calls within 90 days",
  limitations: "Same-server monitor requires a working server and database. SENT is not proof of reading." });

function older(value: string | Date | null, ms: number, now: number) {
  if (!value) return false;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && now - parsed >= ms;
}
export function detectHintIncident(row: Row, now = Date.now()): Incident | null {
  if (!row.ended_at) return older(row.closed_at, watchdogPolicy.missingEventMs, now)
    ? { code: "CALL_END_MISSING", lastStep: "Зафиксировано закрытие Hint",
      expected: "Подтверждённое завершение звонка", reason: "Событие завершения не сохранено за время ожидания." } : null;
  if (!row.job_key) return older(row.ended_at, watchdogPolicy.missingEventMs, now)
    ? { code: "JOB_MISSING", lastStep: "Звонок завершён",
      expected: "Задание лаборатории", reason: "Задание не появилось за время ожидания." } : null;
  if (row.job_status === "failed") return { code: "ANALYSIS_FAILED", lastStep: "Создано задание",
    expected: "Разбор и QA", reason: "Задание имеет сохранённый статус failed; причина — в закрытом журнале." };
  if (row.job_status === "pending" && older(row.job_created, watchdogPolicy.queuedMs, now))
    return { code: "QUEUE_DELAY", lastStep: "Задание поставлено в очередь",
      expected: "Начало разбора", reason: "Задание ожидает больше технического порога. Причина задержки ещё не установлена." };
  if (row.job_status === "running" && older(row.job_updated, watchdogPolicy.analysisMs, now))
    return { code: "ANALYSIS_DELAY", lastStep: "Разбор начат",
      expected: "Результат разбора и QA", reason: "Нет сохранённого результата после технического тайм-аута." };
  if (row.job_status !== "report_ready") return null;
  if (row.execution === "mode_analysis_not_connected")
    return row.mail_status === "sent_confirmed" ? null :
      older(row.job_updated, watchdogPolicy.mailMs, now)
        ? { code: "MODE_NOTICE_MISSING", lastStep: "Режим без разбора зафиксирован",
          expected: "Короткое письмо владельцу", reason: "Нет подтверждения отправки уведомления о звонке." } : null;
  if (row.execution === "analysis_not_completed") return { code: "ANALYSIS_UNAVAILABLE",
    lastStep: "Материалы приняты", expected: "Завершённый разбор", reason: "Сохранён отчёт о незавершённом разборе, а не успешный результат." };
  if (row.qa_status !== "QA: принято") return { code: "QA_UNACCEPTED", lastStep: "Разбор сохранён",
    expected: "Приёмка QA", reason: "QA не подтвердил приёмку. Возврат или отсутствие проверки не считаются успехом." };
  if (!row.mail_status && older(row.job_updated, watchdogPolicy.missingEventMs, now))
    return { code: "OUTBOX_MISSING", lastStep: "Разбор и QA сохранены",
      expected: "Письмо в очереди", reason: "Запись отправки отсутствует." };
  if (["unknown", "needs_review", "paused"].includes(row.mail_status ?? ""))
    return { code: "MAIL_UNCONFIRMED", lastStep: "Подготовлена отправка",
      expected: "Подтверждение Gmail SENT", reason: "Доставка не подтверждена. Сам отчёт повторно не отправляется вслепую." };
  if (row.mail_status && row.mail_status !== "sent_confirmed" &&
      older(row.mail_updated, watchdogPolicy.mailMs, now))
    return { code: "MAIL_DELAY", lastStep: "Разбор и QA сохранены",
      expected: "Подтверждение Gmail SENT", reason: "Этап отправки дольше технического порога; это не доказательство потери письма." };
  return null;
}

export function renderWatchdogNotice(incident: Incident, reference: string, at: string, env: string) {
  return {
    subject: `TalkHint · Дежурный: ${incident.code}`,
    body: ["ДЕЖУРНЫЙ КОНТРОЛЬ ЗВОНКОВ ВЛАДЕЛЬЦА — событие требует внимания",
      `Лаборатория: ${labRelease.version} (${labRelease.framework})`,
      `Окружение: ${env}`, `Обнаружено: ${at}`, `Ссылка события: ${reference}`,
      `Последний подтверждённый шаг: ${incident.lastStep}`,
      `Ожидалось: ${incident.expected}`, `Наблюдение: ${incident.reason}`,
      "Требуемое действие: проверить закрытый журнал лаборатории и передать инженеру недостающий этап.",
      "Это техническое уведомление, не оценка разговора и не приёмка владельцем.",
      "Автоматическое изменение продукта и повтор неопределённой отправки отчёта не выполнялись.",
    ].join("\n"),
  };
}
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("WATCHDOG_MAIL_TIMEOUT")), 30_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function hintWatchdogTick(pool: Pool, configuration: () => Config,
  mail: Pick<GmailLabMail, "sendNotice" | "sent"> = new GmailLabMail()) {
  const config = configuration();
  if (!config.allowed || !config.owner) {
    snapshot = { ...snapshot, state: "paused", error: undefined };
    return;
  }
  let client: PoolClient | undefined;
  let locked = false;
  const key = `owner-ops:${config.environment}:${config.owner}`;
  const lock = `hint-watchdog:${key}`; // independent of the worker's long-running lock
  snapshot = { ...snapshot, state: "checking", attemptedAt: new Date().toISOString() };
  try {
    client = await pool.connect();
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [lock])).rows[0]?.ok;
    if (!locked) { snapshot = { ...snapshot, state: "another_instance" }; return; }
    const control = (await client.query("SELECT * FROM call_lab_controls WHERE key=$1", [key])).rows[0];
    if (!control?.enabled) {
      snapshot = { ...snapshot, state: control ? "paused" : "not_ready", error: undefined };
      return; // Separate P.OPS control, never the analysis switch.
    }
    const now = Date.now(), at = new Date(now).toISOString();
    const state: State = control.watchdog ?? {};
    // Match the watch window; do not forget deduplication while a call remains in scope.
    for (const [id, entry] of Object.entries(state))
      if (older(entry.detectedAt, 90 * 86_400_000, now)) delete state[id];
    const rows = (await client.query(`SELECT c.call_sid,c.ended_at,
      c.metadata#>>'{labHintSource,closedAt}' AS closed_at,
      j.key AS job_key,j.status AS job_status,j.created_at AS job_created,j.updated_at AS job_updated,
      j.report->>'execution' AS execution,j.report->>'qa_status' AS qa_status,
      o.status AS mail_status,o.updated_at AS mail_updated
      FROM (${ownerCallsSql}) c
      LEFT JOIN call_lab_jobs j ON j.call_sid=c.call_sid AND j.owner_id=$1 AND j.environment=$3
      LEFT JOIN call_lab_outbox o ON o.key=j.key
      WHERE c.user_id=$1 AND c.started_at>=$2 AND c.started_at>now()-interval '90 days'
      AND coalesce(c.metadata#>>'{labHintSource,environment}',$3)=$3
      AND coalesce(j.report->>'synthetic','false')<>'true'
      AND coalesce(j.report->>'execution','')<>'manual_assistant_review'
      ORDER BY c.started_at DESC LIMIT 200`, [config.owner, control.activated_at, config.environment])).rows as Row[];
    const active = new Set<string>();
    const scanned = new Set<string>();
    for (const row of rows) {
      const callRef = createHash("sha256").update(row.call_sid).digest("hex");
      scanned.add(callRef);
      const issue = detectHintIncident(row, now);
      if (!issue) continue;
      const id = createHash("sha256").update(JSON.stringify([key, row.call_sid, issue.code])).digest("hex");
      active.add(id);
      state[id] ??= { ...issue, callRef, detectedAt: at, lastSeenAt: at, delivery: "prepared" };
      state[id].lastSeenAt = at;
      delete state[id].resolvedAt;
    }
    for (const [id, entry] of Object.entries(state))
      if (scanned.has(entry.callRef) && !active.has(id) && !entry.resolvedAt) entry.resolvedAt = at;
    const persist = async () => {
      const q = await client!.query(`UPDATE call_lab_controls SET watchdog=$2::jsonb
        WHERE key=$1 AND enabled=true RETURNING key`, [key, JSON.stringify(state)]);
      if (!q.rows.length) throw new Error("WATCHDOG_PAUSED");
    };
    const canSend = async () => configuration().allowed &&
      !!(await client!.query("SELECT enabled FROM call_lab_controls WHERE key=$1", [key])).rows[0]?.enabled;
    await persist();
    let submissions = 0;
    for (const [id, entry] of Object.entries(state)) {
      if (!await canSend()) break;
      // A crash/timeout after sending never grants permission to resend.
      if (["sending", "unknown"].includes(entry.delivery)) {
        entry.delivery = "unknown";
        if ((entry.checks ?? 0) >= 3) { entry.delivery = "needs_review"; await persist(); continue; }
        try {
          const sent = await bounded(mail.sent(control, messageIdFor(id), entry.gmailId));
          if (sent) { entry.delivery = "sent_confirmed"; entry.gmailId = sent; }
        } catch { /* remain uncertain, not prepared */ }
        entry.checks = (entry.checks ?? 0) + 1;
        await persist();
        continue;
      }
      if (entry.delivery !== "prepared" || !active.has(id) || entry.resolvedAt || submissions >= 3) continue;
      // Persist BEFORE the non-idempotent request, even if this process later dies.
      entry.delivery = "sending";
      await persist();
      submissions++;
      try {
        const notice = renderWatchdogNotice(entry, id.slice(0, 12), entry.detectedAt, config.environment);
        entry.gmailId = await bounded(mail.sendNotice(control, messageIdFor(id), notice.subject, notice.body, canSend));
        entry.delivery = "unknown";
        await persist(); // remember known provider ID before looking it up
        const found = await bounded(mail.sent(control, messageIdFor(id), entry.gmailId));
        if (found) entry.delivery = "sent_confirmed";
      } catch { entry.delivery = "unknown"; }
      await persist();
    }
    const problems = Object.values(state).filter(e => ["unknown", "needs_review", "sending"].includes(e.delivery)).length;
    const outstanding = Object.values(state).filter(e => !e.resolvedAt).length;
    snapshot = { state: outstanding || problems ? "attention" : "checked", attemptedAt: at,
      checkedAt: at, activeIncidents: outstanding, notificationProblems: problems };
  } catch {
    snapshot = { ...snapshot, state: "blocked", error: "WATCHDOG_CHECK_OR_MAIL_STATE_UNAVAILABLE" };
    console.warn("[HintLabWatchdog] BLOCKED: cannot verify monitoring/delivery; private status is not green");
  } finally {
    if (locked) await client?.query("SELECT pg_advisory_unlock(hashtext($1))", [lock]).catch(() => {});
    client?.release();
  }
}

export function startHintWatchdog(pool: Pool, configuration: () => Config) {
  let busy = false, stopped = false;
  const tick = () => {
    if (busy || stopped) return;
    busy = true;
    void hintWatchdogTick(pool, () => ({ ...configuration(), allowed: !stopped && configuration().allowed }))
      .finally(() => { busy = false; });
  };
  const timer = setInterval(tick, watchdogPolicy.pollMs);
  timer.unref();
  tick();
  return () => { stopped = true; clearInterval(timer); };
}
