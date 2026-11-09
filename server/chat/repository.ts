import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { ChatError, hash, type MessageInput, type Message, type Attachment } from "./contracts";
import { proposedPlan, type ChatPlanAction } from "./plans";

function camel(row: any): any {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [
    k.replace(/_([a-z])/g, (_, a) => a.toUpperCase()), v instanceof Date ? v.toISOString() : v,
  ]));
}
function publicMessage(row: any): Message {
  const { usage, input_hash, lease_until, provider_request_id, ...visible } = row;
  return { ...camel(visible), ...(usage?.event ? { event: usage.event } : {}),
    ...(usage?.context ? { context: usage.context } : {}) };
}
export class ChatRepository {
  constructor(private pool: Pool) {}
  private async transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try { await c.query("BEGIN"); const result = await fn(c); await c.query("COMMIT"); return result; }
    catch (e) { await c.query("ROLLBACK"); throw e; }
    finally { c.release(); }
  }
  async create(user: string, id: string, title = "New chat") {
    const fingerprint = hash([title]);
    const result = await this.pool.query(`INSERT INTO chat_conversations
      (id,user_id,client_request_id,input_hash,title) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (user_id,client_request_id) DO UPDATE SET client_request_id=EXCLUDED.client_request_id
      RETURNING *`, [randomUUID(), user, id, fingerprint, title]);
    const row = result.rows[0];
    if (row.input_hash !== fingerprint) throw new ChatError("IDEMPOTENCY_CONFLICT");
    return camel(row);
  }
  async list(user: string, before?: string) {
    const result = await this.pool.query(`SELECT * FROM chat_conversations
      WHERE user_id=$1 AND ($2::text IS NULL OR (updated_at,id) <
        (SELECT updated_at,id FROM chat_conversations WHERE user_id=$1 AND id=$2))
      ORDER BY updated_at DESC,id DESC LIMIT 101`, [user, before || null]);
    return { conversations: result.rows.slice(0, 100).map(camel),
      nextCursor: result.rows.length > 100 ? result.rows[99].id : null };
  }
  async messages(user: string, conversation: string, before?: number, admin = false) {
    const owns = await this.pool.query("SELECT id FROM chat_conversations WHERE id=$1 AND user_id=$2", [conversation, user]);
    if (!owns.rowCount) throw new ChatError("NOT_FOUND", 404);
    // Never restart paid work after a process loss, even when a UI reconnects.
    await this.pool.query(`UPDATE chat_messages SET status='interrupted', error_code='GENERATION_INTERRUPTED',
      updated_at=now() WHERE user_id=$1 AND conversation_id=$2
      AND status IN ('queued','generating') AND lease_until < now()`, [user, conversation]);
    const result = await this.pool.query(`SELECT * FROM chat_messages WHERE user_id=$1 AND conversation_id=$2
      AND ($3::integer IS NULL OR sequence < $3)
      AND ($4::boolean OR COALESCE(usage->>'visibility','user')<>'admin')
      ORDER BY sequence DESC LIMIT 101`, [user, conversation, before || null, admin]);
    return { messages: result.rows.slice(0, 100).reverse().map(publicMessage), hasMore: result.rows.length > 100 };
  }
  async one(user: string, conversation: string, id: string, admin = false): Promise<Message> {
    await this.messages(user, conversation);
    const r = await this.pool.query("SELECT * FROM chat_messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3",
      [user, conversation, id]);
    if (!r.rowCount || (!admin && r.rows[0].usage?.visibility === "admin")) throw new ChatError("NOT_FOUND", 404);
    return publicMessage(r.rows[0]);
  }
  async accept(user: string, conversation: string, input: MessageInput, available: boolean) {
    const fingerprint = hash([input.text, input.attachmentIds, input.language, ...(input.context ? [input.context] : [])]);
    return this.transaction(async c => {
      // Serializes per owner, including sends to different conversations.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,92731))", [user]);
      const conv = await c.query("SELECT * FROM chat_conversations WHERE id=$1 AND user_id=$2 FOR UPDATE", [conversation, user]);
      if (!conv.rowCount) throw new ChatError("NOT_FOUND", 404);
      const previous = await c.query(`SELECT * FROM chat_messages WHERE user_id=$1 AND conversation_id=$2
        AND client_request_id=$3 ORDER BY sequence`, [user, conversation, input.clientRequestId]);
      if (previous.rowCount) {
        if (previous.rows[0].input_hash !== fingerprint) throw new ChatError("IDEMPOTENCY_CONFLICT");
        return { message: camel(previous.rows[0]), reply: camel(previous.rows[1]), created: false };
      }
      if (!available) throw new ChatError("MODEL_UNAVAILABLE", 503);
      await c.query(`UPDATE chat_messages SET status='interrupted',error_code='GENERATION_INTERRUPTED',
        updated_at=now() WHERE user_id=$1 AND status IN ('queued','generating') AND lease_until < now()`, [user]);
      const busy = await c.query("SELECT id FROM chat_messages WHERE user_id=$1 AND status IN ('queued','generating') LIMIT 1", [user]);
      if (busy.rowCount) throw new ChatError("CHAT_BUSY");
      const rate = await c.query(`SELECT count(*)::int AS n FROM chat_messages
        WHERE user_id=$1 AND role='user' AND created_at > now()-interval '1 hour'`, [user]);
      if (rate.rows[0].n >= 60) throw new ChatError("CHAT_RATE_LIMIT", 429);
      if (input.attachmentIds.length) {
        const attachments = await c.query(`SELECT id FROM chat_attachments WHERE user_id=$1
          AND id=ANY($2::varchar[]) AND status='ready'`, [user, input.attachmentIds]);
        if (attachments.rowCount !== input.attachmentIds.length) throw new ChatError("ATTACHMENT_NOT_READY", 400);
      }
      const sequence = conv.rows[0].next_sequence;
      const result = await c.query(`INSERT INTO chat_messages
        (id,user_id,conversation_id,sequence,client_request_id,input_hash,role,text,status,attachment_ids,lease_until,usage)
        VALUES ($1,$2,$3,$4,$5,$6,'user',$7,'complete',$8::jsonb,NULL,$11::jsonb),
        ($9,$2,$3,$10,$5,$6,'assistant','','queued','[]'::jsonb,now()+interval '120 seconds',NULL)
        RETURNING *`, [randomUUID(), user, conversation, sequence, input.clientRequestId, fingerprint,
        input.text, JSON.stringify(input.attachmentIds), randomUUID(), sequence + 1,
        JSON.stringify({ language: input.language, ...(input.context ? { context: input.context } : {}) })]);
      await c.query(`UPDATE chat_conversations SET next_sequence=next_sequence+2,updated_at=now(),
        title=CASE WHEN next_sequence=1 AND title='New chat' THEN $3 ELSE title END WHERE id=$1 AND user_id=$2`,
        [conversation, user, (input.text || "Attachment").replace(/\s+/g, " ").slice(0, 70)]);
      return { message: camel(result.rows[0]), reply: camel(result.rows[1]), created: true };
    });
  }
  async claim(user: string, id: string): Promise<boolean> {
    const r = await this.pool.query(`UPDATE chat_messages SET status='generating',updated_at=now()
      WHERE id=$1 AND user_id=$2 AND status='queued' AND lease_until>now() RETURNING id`, [id, user]);
    return !!r.rowCount;
  }
  async save(user: string, id: string, text: string, status: string, errorCode: string | null = null,
    evidence: { model?: string; requestId?: string; usage?: unknown; action?: ChatPlanAction } = {}) {
    const r = await this.pool.query(`UPDATE chat_messages SET text=$3,status=$4,error_code=$5,updated_at=now(),
      model=COALESCE($6,model),provider_request_id=COALESCE($7,provider_request_id),usage=COALESCE($8::jsonb,usage),
      action=COALESCE($9::jsonb,action)
      WHERE id=$1 AND user_id=$2 AND status IN ('queued','generating') AND lease_until>now() RETURNING id`,
      [id, user, text, status, errorCode, evidence.model || null, evidence.requestId || null,
      evidence.usage ? JSON.stringify(evidence.usage) : null,
      evidence.action ? JSON.stringify(evidence.action) : null]);
    if (!r.rowCount) throw new ChatError("GENERATION_LEASE_LOST");
  }
  async confirmPlan(user: string, conversation: string, message: string, expectedHash: string,
    apply: (action: ChatPlanAction) => Promise<ChatPlanAction["result"]>) {
    return this.transaction(async c => {
      // Same lock as accept: a correction and confirmation cannot pass each other.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,92731))", [user]);
      const row = (await c.query(`SELECT * FROM chat_messages
        WHERE user_id=$1 AND conversation_id=$2 AND id=$3 FOR UPDATE`, [user, conversation, message])).rows[0];
      if (!row) throw new ChatError("NOT_FOUND", 404);
      if (row.role !== "assistant" || row.status !== "complete" || !row.action)
        throw new ChatError("PLAN_NOT_READY");
      const checked = proposedPlan(row.action.plan);
      if (checked.planHash !== expectedHash || row.action.planHash !== expectedHash)
        throw new ChatError("PLAN_CHANGED");
      const later = await c.query(`SELECT id FROM chat_messages WHERE user_id=$1
        AND conversation_id=$2 AND sequence>$3 AND role='user' LIMIT 1`, [user, conversation, row.sequence]);
      if (later.rowCount) throw new ChatError("PLAN_STALE");
      if (row.action.status !== "confirmed") {
        const result = await apply(checked);
        row.action = { ...checked, status: "confirmed", result };
        await c.query("UPDATE chat_messages SET action=$3::jsonb,updated_at=now() WHERE user_id=$1 AND id=$2",
          [user, message, JSON.stringify(row.action)]);
      }
      return camel(row) as Message;
    });
  }
  async attachment(user: string, id: string): Promise<Attachment> {
    const r = await this.pool.query("SELECT * FROM chat_attachments WHERE id=$1 AND user_id=$2", [id, user]);
    if (!r.rowCount) throw new ChatError("NOT_FOUND", 404);
    return camel(r.rows[0]);
  }
  async attachmentIntent(user: string, request: string, a: Omit<Attachment, "id" | "status">) {
    return this.transaction(async c => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,92731))", [user]);
      const existing = await c.query("SELECT * FROM chat_attachments WHERE user_id=$1 AND client_request_id=$2 FOR UPDATE", [user, request]);
      if (existing.rowCount) {
        const row = camel(existing.rows[0]);
        if (row.inputHash !== a.inputHash) throw new ChatError("IDEMPOTENCY_CONFLICT");
        return { attachment: row as Attachment, created: false };
      }
      const quota = await c.query("SELECT count(*)::int AS n,COALESCE(sum(size),0)::bigint AS bytes FROM chat_attachments WHERE user_id=$1", [user]);
      if (quota.rows[0].n >= 200 || Number(quota.rows[0].bytes) + a.size > 100 * 1024 * 1024)
        throw new ChatError("ATTACHMENT_QUOTA", 429);
      const r = await c.query(`INSERT INTO chat_attachments
        (id,user_id,client_request_id,input_hash,name,mime_type,size,storage_key,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'uploading') RETURNING *`,
        [randomUUID(), user, request, a.inputHash, a.name, a.mimeType, a.size, a.storageKey]);
      return { attachment: camel(r.rows[0]) as Attachment, created: true };
    });
  }
  async attachmentStatus(user: string, id: string, status: string) {
    await this.pool.query("UPDATE chat_attachments SET status=$3 WHERE user_id=$1 AND id=$2", [user, id, status]);
  }
}
