import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { GmailLabMail } from "./mail";
import { hintWatchdogStatus } from "./watchdog";
import { ownerCallsSql, labRelease } from "./policy";
import { messageIdFor } from "./store";

const zone = "America/Denver";
const supportedMessageId = /^[a-f0-9]+@talkhint-lab\.invalid$/;
export function dailyMessageId(environment: string, owner: string, day: string) {
  const digest = createHash("sha256").update(JSON.stringify(["hint-daily", environment, owner, day])).digest("hex");
  return messageIdFor(digest);
}
const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric",
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const parts = (d: Date) => Object.fromEntries(formatter.formatToParts(d)
  .filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
function midnight(y: number, m: number, d: number) {
  const nominal = Date.UTC(y, m - 1, d);
  let guess = nominal;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(guess));
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess = nominal - (represented - guess);
  }
  return new Date(guess);
}
export function dueHintDay(now: Date) {
  const p = parts(now);
  if (p.hour < 8) return null;
  const previous = new Date(Date.UTC(p.year, p.month - 1, p.day - 1));
  const y = previous.getUTCFullYear(), m = previous.getUTCMonth() + 1, d = previous.getUTCDate();
  return { day: previous.toISOString().slice(0, 10), zone,
    start: midnight(y, m, d).toISOString(), end: midnight(p.year, p.month, p.day).toISOString() };
}
export function renderHintDaily(day: NonNullable<ReturnType<typeof dueHintDay>>, rows: any[],
  monitor: ReturnType<typeof hintWatchdogStatus>, now: Date, enabled: boolean) {
  const reports = rows.filter(r => r.report);
  const sent = rows.filter(r => r.mail_status === "sent_confirmed").length;
  const accepted = reports.filter(r => r.report.qa_status === "QA: принято").length;
  const failed = reports.filter(r => r.report.execution === "analysis_not_completed").length;
  const notices = reports.filter(r => r.report.execution === "mode_analysis_not_connected").length;
  const measured = reports.filter(r => Number.isFinite(r.report.deterministic?.recorded_attempts));
  const sum = (key: string) => measured.reduce((n, r) => n + (r.report.deterministic[key] ?? 0), 0);
  const fresh = monitor.checkedAt && Number.isFinite(Date.parse(monitor.checkedAt)) &&
    now.getTime() >= Date.parse(monitor.checkedAt) && now.getTime() - Date.parse(monitor.checkedAt) < 60_000;
  const status = !enabled ? "лаборатория выключена" : !fresh ? "свежая проверка отсутствует"
    : monitor.state !== "checked" && monitor.state !== "attention" ? "проверка не завершена"
    : monitor.activeIncidents ? `открытых сбоев: ${monitor.activeIncidents}` : "свежая проверка выполнена; это не оценка качества подсказок";
  return { subject: `Звонки владельца · сутки ${day.day} · писем ${sent} из ${rows.length} · дежурный`,
    body: [`Отчёт P.OPS за ${day.day}, сутки по Денверу. Расписание: 08:00 ${zone}.`,
      `Лаборатория: ${labRelease.version} (${labRelease.framework}).`,
      `Hint: ${status}.`,
      `Завершённых звонков: ${rows.length}; разборов, принятых проверкой: ${accepted}; писем SENT: ${sent}.`,
      `Разбор не завершён: ${failed}; нет готового разбора: ${rows.length - reports.length}.`,
      `Режим без подключённого разбора: ${notices} (уведомление, не успешная QA).`,
      `Измерения сохранены для ${measured.length} из ${rows.length} звонков.`,
      measured.length ? `В сохранённых измерениях: попыток ${sum("recorded_attempts")}, отправлено ${sum("sent")}, подтверждено телефоном ${sum("acknowledged")}.`
        : "Подсказки и их показ: неизвестно — нет измерений, не ноль.",
      "Показ на экране, перевод и задержки: подробности в отчёте каждого звонка; отсутствующие измерения не считаются выполнением.",
      "Катя, Translator, Prepare, Copilot: контроль факта звонка/уведомления; качество этих режимов не проверено. History и остальные системы — не проверено.",
      "Внешний монитор не подключён. При остановке этого сервера он сам не сможет отправить предупреждение.",
      "https://talkhint.app/api/admin/call-lab — отчёты и состояние, нужен вход владельца.",
      "SENT означает отправку Gmail, не прочтение или приёмку владельцем."].join("\n") };
}
const deadline = async <T>(promise: Promise<T>) => {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<T>((_, reject) =>
    { timer = setTimeout(() => reject(new Error("DAILY_MAIL_TIMEOUT")), 30_000); })]); }
  finally { clearTimeout(timer!); }
};
type Config = { environment: string; owner?: string; allowed: boolean };
let snapshot: { state: string; checkedAt: string | null; day?: string; delivery?: string } =
  { state: "not_checked", checkedAt: null };
export function hintDailyStatus() { return { ...snapshot, schedule: "08:00", timeZone: zone, scope: "Owner calls; Hint QA, other modes notices only" }; }
export async function hintDailyTick(pool: Pool, config: Config, now = new Date(), mail = new GmailLabMail()) {
  if (!config.allowed || !config.owner) { snapshot.state = "paused"; return; }
  const day = dueHintDay(now);
  if (!day) { snapshot = { state: "before_0800", checkedAt: now.toISOString() }; return; }
  const key = `hint-daily:${config.environment}:${config.owner}`;
  const client = await pool.connect();
  let locked = false;
  try {
    locked = !!(await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [key])).rows[0]?.locked;
    if (!locked) return;
    const control = (await client.query("SELECT * FROM call_lab_controls WHERE key=$1", [key])).rows[0];
    snapshot = { state: "checked", checkedAt: now.toISOString(), day: day.day };
    if (!control?.enabled) { snapshot.state = "paused"; return; }
    const state = control.watchdog ?? {};
    state.reports ??= {};
    let entry = state.reports[day.day];
    const save = async () => {
      await client.query("UPDATE call_lab_controls SET watchdog=$2::jsonb WHERE key=$1", [key, JSON.stringify(state)]);
      snapshot.delivery = entry.status;
    };
    if (entry?.status === "sent_confirmed" || entry?.status === "needs_review") {
      snapshot.delivery = entry.status; return;
    }
    // A crash after sending must only be reconciled. It never grants a resend.
    if (entry && ["sending", "unknown"].includes(entry.status)) {
      // Historical daily IDs were rejected by both encoder and SENT lookup.
      // Preserve the evidence, stop the silent failing loop, never resend.
      if (typeof entry.messageId !== "string" || !supportedMessageId.test(entry.messageId)) {
        entry.status = "needs_review";
        entry.errorCode = "LAB_BAD_MESSAGE_ID";
        await save(); return;
      }
      const found = await deadline(mail.sent(control, entry.messageId, entry.gmailId));
      entry.status = found ? "sent_confirmed" : (entry.checks ?? 0) >= 2 ? "needs_review" : "unknown";
      entry.checks = (entry.checks ?? 0) + 1;
      if (found) entry.gmailId = found;
      await save(); return;
    }
    const rows = (await client.query(`SELECT c.call_sid,j.report,o.status AS mail_status
      FROM (${ownerCallsSql}) c LEFT JOIN call_lab_jobs j ON j.call_sid=c.call_sid AND j.owner_id=$1 AND j.environment=$2
      LEFT JOIN call_lab_outbox o ON o.key=j.key
      WHERE c.user_id=$1 AND c.ended_at >= $3 AND c.ended_at < $4
      `,
    [config.owner, config.environment, day.start, day.end])).rows;
    const lab = (await client.query("SELECT enabled FROM call_lab_controls WHERE key=$1",
      [`${config.environment}:${config.owner}`])).rows[0];
    const letter = renderHintDaily(day, rows, hintWatchdogStatus(), now, lab?.enabled === true);
    entry = state.reports[day.day] = { status: "sending", at: now.toISOString(),
      messageId: dailyMessageId(config.environment, config.owner, day.day),
      subject: letter.subject, body: letter.body, checks: 0 };
    await save(); // Durable intent before the non-idempotent Gmail request.
    const canSend = async () => (await pool.query("SELECT enabled FROM call_lab_controls WHERE key=$1", [key])).rows[0]?.enabled === true;
    try {
      entry.gmailId = await deadline(mail.sendNotice(control, entry.messageId, letter.subject, letter.body, canSend));
      entry.status = await deadline(mail.sent(control, entry.messageId, entry.gmailId)) ? "sent_confirmed" : "unknown";
    } catch { entry.status = "unknown"; }
    await save();
  } catch { snapshot.state = "failed"; }
  finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]).catch(() => {});
    client.release();
  }
}
export function startHintDaily(pool: Pool, configuration: () => Config) {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void hintDailyTick(pool, configuration()).finally(() => { running = false; });
  };
  const timer = setInterval(tick, 30_000);
  timer.unref(); tick();
  return () => clearInterval(timer);
}
