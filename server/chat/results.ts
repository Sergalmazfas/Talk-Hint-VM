import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { secretaryInstruction } from "../../shared/callPlan";
import { ChatError, hash } from "./contracts";
import { isBenchmarkAdmin } from "../benchmark/adminGate";

export type ChatSource = { conversationId: string; messageId: string };
export type ChatEvent = {
  kind: "call_result" | "crew_result" | "followup_task";
  sourcePath: string; taskId: string;
};
const terminal = new Set(["completed", "failed", "canceled", "cancelled", "busy", "no-answer", "no_answer", "unknown"]);
const line = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value.replace(/[\r\n]+/g, " ").slice(0, 1200) : fallback;
const labels: Record<string, [string, string, string, string, string, string, string]> = {
  en: ["Result not confirmed.", "No confirmed problems are recorded.", "Outcome",
    "Review the result; another call needs your Start.", "No confirmed summary.", "Not verified.", "Owner decision needed."],
  ru: ["Результат не подтверждён.", "Подтверждённых проблем в сохранённом итоге не указано.", "Исход",
    "Проверьте итог; новый звонок требует вашего запуска.", "Нет подтверждённой сводки.", "Не проверено.", "Нужно решение владельца."],
  es: ["Resultado no confirmado.", "No constan problemas confirmados.", "Resultado",
    "Revise el resultado; otra llamada requiere su confirmación.", "No hay resumen confirmado.", "Sin verificar.", "Se necesita su decisión."],
  kk: ["Нәтиже расталмады.", "Расталған мәселелер тіркелмеген.", "Нәтиже",
    "Нәтижені тексеріңіз; жаңа қоңырауды өзіңіз бастауыңыз керек.", "Расталған қорытынды жоқ.", "Тексерілмеген.", "Иесінің шешімі қажет."],
  uk: ["Результат не підтверджено.", "Підтверджених проблем не записано.", "Результат",
    "Перевірте результат; новий дзвінок потребує вашого запуску.", "Немає підтвердженого підсумку.", "Не перевірено.", "Потрібне рішення власника."],
};
function resultLabels(language?: string) { return labels[language?.split(/[-_]/)[0].toLowerCase() ?? "en"] ?? labels.en; }
export function resultLines(task: any, language = "en") {
  const l = resultLabels(language);
  return [
    line(task.summary, l[0]),
    task.outcome === "resolved" ? l[1] : `${l[2]}: ${task.outcome ?? task.status}.`,
    line(task.next_step, l[3]),
  ].join("\n");
}
export class ChatResults {
  constructor(private pool: Pool) {}
  private async transaction<T>(fn: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try { await c.query("BEGIN"); const value = await fn(c); await c.query("COMMIT"); return value; }
    catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }
  async bind(owner: string, source: ChatSource, task: { id: string; instruction: string; phoneNumber: string }) {
    return this.transaction(async c => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,92731))", [owner]);
      const row = (await c.query(`SELECT action,sequence FROM chat_messages
        WHERE user_id=$1 AND conversation_id=$2 AND id=$3 FOR UPDATE`,
        [owner, source.conversationId, source.messageId])).rows[0];
      const action = row?.action;
      if (!action || action.status !== "confirmed" || action.plan.targetPhone !== task.phoneNumber ||
          secretaryInstruction(action.plan) !== task.instruction) throw new ChatError("CHAT_TASK_SOURCE_REJECTED");
      if (action.result?.taskId && action.result.taskId !== task.id) throw new ChatError("CHAT_PLAN_ALREADY_STARTED");
      if (!action.result?.taskId) {
        const later = await c.query(`SELECT id FROM chat_messages
          WHERE user_id=$1 AND conversation_id=$2 AND role='user' AND sequence>$3 LIMIT 1`,
          [owner, source.conversationId, row.sequence]);
        if (later.rowCount) throw new ChatError("PLAN_STALE");
        action.result = { ...action.result, taskId: task.id, status: "started" };
        await c.query("UPDATE chat_messages SET action=$3::jsonb WHERE user_id=$1 AND id=$2",
          [owner, source.messageId, JSON.stringify(action)]);
      }
    });
  }
  private async append(owner: string, conversation: string, key: string, text: string,
    event: ChatEvent, admin = false) {
    await this.transaction(async c => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,92731))", [owner]);
      // Deterministic event identity, independent of model requests. No new CRM/table.
      const h = hash([key]);
      const request = `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
      const prior = await c.query(`SELECT id FROM chat_messages
        WHERE user_id=$1 AND conversation_id=$2 AND client_request_id=$3 LIMIT 1`, [owner, conversation, request]);
      if (prior.rowCount) return;
      const conv = (await c.query("SELECT next_sequence FROM chat_conversations WHERE user_id=$1 AND id=$2 FOR UPDATE",
        [owner, conversation])).rows[0];
      if (!conv) throw new ChatError("NOT_FOUND", 404);
      await c.query(`INSERT INTO chat_messages
        (id,user_id,conversation_id,sequence,client_request_id,input_hash,role,text,status,attachment_ids,usage)
        VALUES($1,$2,$3,$4,$5,$6,'assistant',$7,'complete','[]'::jsonb,$8::jsonb)`,
        [randomUUID(), owner, conversation, conv.next_sequence, request, hash([text, event]),
          text, JSON.stringify({ visibility: admin ? "admin" : "user", event })]);
      await c.query("UPDATE chat_conversations SET next_sequence=next_sequence+1,updated_at=now() WHERE user_id=$1 AND id=$2",
        [owner, conversation]);
    });
  }
  async sync(owner: string, conversation: string, admin: boolean) {
    const linked = await this.pool.query(`SELECT DISTINCT t.*,
      (SELECT h.usage->>'language' FROM chat_messages h WHERE h.user_id=$1 AND h.conversation_id=$2
        AND h.role='user' ORDER BY h.sequence DESC LIMIT 1) AS ui_language FROM chat_messages m
      JOIN secretary_tasks t ON t.id=m.action->'result'->>'taskId' AND t.user_id=m.user_id
      WHERE m.user_id=$1 AND m.conversation_id=$2`, [owner, conversation]);
    for (const task of linked.rows) {
      if (!terminal.has(task.status)) continue;
      await this.append(owner, conversation, `call-result:${task.id}`, resultLines(task, task.ui_language ?? "en"), {
        kind: "call_result", taskId: task.id, sourcePath: `/api/secretary/tasks/${encodeURIComponent(task.id)}`,
      });
      if (!admin || !task.call_sid) continue;
      const review = (await this.pool.query(`SELECT key,report FROM call_lab_jobs WHERE owner_id=$1 AND call_sid=$2
        AND environment=$3 AND report IS NOT NULL ORDER BY updated_at DESC LIMIT 1`,
        [owner, task.call_sid, process.env.NODE_ENV === "production" ? "production" : "development"])).rows[0];
      const summary = review?.report?.secretary_summary;
      const l = resultLabels(task.ui_language);
      if (summary) await this.append(owner, conversation, `crew-result:${task.id}`, [
        line(summary.learned, l[4]), line(summary.wentWrong, l[5]),
        line(summary.nextAction, l[6]),
      ].join("\n"), { kind: "crew_result", taskId: task.id,
        sourcePath: `/api/chat-v1/conversations/${conversation}/crew-results/${task.id}` }, true);
    }
  }
  async crewDetails(owner: string, conversation: string, taskId: string) {
    const result = await this.pool.query(`SELECT j.report FROM chat_messages m
      JOIN secretary_tasks t ON t.id=m.action->'result'->>'taskId' AND t.user_id=m.user_id
      JOIN call_lab_jobs j ON j.owner_id=t.user_id AND j.call_sid=t.call_sid AND j.environment=$4
      WHERE m.user_id=$1 AND m.conversation_id=$2 AND t.id=$3 AND j.report IS NOT NULL
      ORDER BY j.updated_at DESC LIMIT 1`, [owner, conversation, taskId,
        process.env.NODE_ENV === "production" ? "production" : "development"]);
    if (!result.rowCount) throw new ChatError("NOT_FOUND", 404);
    return result.rows[0].report;
  }
  async followup(owner: string, conversation: string, taskId: string, text: string) {
    const linked = await this.pool.query(`SELECT m.id FROM chat_messages m
      JOIN secretary_tasks t ON t.id=m.action->'result'->>'taskId' AND t.user_id=m.user_id
      WHERE m.user_id=$1 AND m.conversation_id=$2 AND t.id=$3`, [owner, conversation, taskId]);
    if (!linked.rowCount) throw new ChatError("NOT_FOUND", 404);
    await this.append(owner, conversation, `followup:${taskId}:${hash([text])}`, text,
      { kind: "followup_task", taskId, sourcePath: `/api/secretary/tasks/${taskId}` });
  }
}

/** Only called after the existing native signed confirmation; no external actions here. */
export async function bindChatSecretaryTask(owner: string, source: ChatSource | undefined,
  task: { id: string; instruction: string; phoneNumber: string }) {
  if (!source) return;
  const { pool, dbReady } = await import("../db"); await dbReady;
  if (!pool) throw new ChatError("CHAT_STORAGE_UNAVAILABLE", 503);
  await new ChatResults(pool).bind(owner, source, task);
}

export async function syncChatSecretaryResults(taskId: string) {
  const { pool, dbReady } = await import("../db"); await dbReady;
  if (!pool) throw new ChatError("CHAT_STORAGE_UNAVAILABLE", 503);
  await syncStoredChatResults(pool, taskId);
}
export async function syncStoredChatResults(pool: Pool, taskId: string) {
  const links = await pool.query(`SELECT DISTINCT m.user_id,m.conversation_id,u.email FROM chat_messages m
    JOIN secretary_tasks t ON t.id=m.action->'result'->>'taskId' AND t.user_id=m.user_id
    JOIN users u ON u.id=m.user_id WHERE t.id=$1`, [taskId]);
  const results = new ChatResults(pool);
  for (const row of links.rows) await results.sync(row.user_id, row.conversation_id, isBenchmarkAdmin(row.email));
}
