/**
 * Explicit developer smoke test against the running Dev HTTPS API.
 * Creates synthetic users through real auth; tokens/passwords stay in memory.
 * No model request unless --model is explicitly supplied. No phone/STT endpoints.
 */
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { Client } from "@replit/object-storage";

const origin = `https://${process.env.REPLIT_DEV_DOMAIN ?? ""}`;
assert(new URL(origin).hostname.endsWith(".replit.dev"), "Dev origin required");
assert(process.env.NODE_ENV !== "production", "Never production");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const identities: { id: string; token: string }[] = [];
const storageKeys: string[] = [];
const report: Record<string, unknown> = { origin, realModelRequested: process.argv.includes("--model") };
async function call(path: string, identity?: typeof identities[number], body?: unknown) {
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(identity ? { Authorization: `Bearer ${identity.token}` } : {}), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(95_000),
  });
  const data = await response.json();
  return { status: response.status, data };
}
try {
  assert.equal((await call("/api/chat-v1/capabilities")).status, 401);
  report.unauthenticatedRejected = true;
  for (let i = 0; i < 2; i++) {
    const auth = await call("/api/auth/register", undefined, {
      email: `chat-dev-probe-${randomUUID()}@example.invalid`,
      password: randomBytes(32).toString("hex"), language: "en",
    });
    assert.equal(auth.status, 200, "Synthetic Dev registration");
    identities.push({ id: auth.data.user.id, token: auth.data.token });
  }
  const [a, b] = identities;
  const caps = await call("/api/chat-v1/capabilities", a);
  assert.equal(caps.status, 200, "Real authenticated capabilities");
  report.capabilities = caps.data;
  const creation = { clientRequestId: randomUUID(), title: "Synthetic Dev connectivity check" };
  const created = await call("/api/chat-v1/conversations", a, creation);
  assert.equal(created.status, 200);
  const conversation = created.data.conversation.id;
  const duplicate = await call("/api/chat-v1/conversations", a, creation);
  assert.equal(duplicate.data.conversation.id, conversation);
  report.createIdempotent = true;
  assert.equal((await call(`/api/chat-v1/conversations/${conversation}/messages`, b)).status, 404);
  report.crossUserRejected = true;
  const freshLoginRows = await pool.query("SELECT id FROM chat_conversations WHERE id=$1 AND user_id=$2", [conversation, a.id]);
  assert.equal(freshLoginRows.rowCount, 1);
  assert((await call("/api/chat-v1/conversations", a)).data.conversations.some((c: any) => c.id === conversation));
  report.postgresAndHttpReadback = true;
  let attachmentId: string | undefined;
  if (caps.data.attachments.available) {
    const upload = await call("/api/chat-v1/attachments", a, {
      clientRequestId: randomUUID(), name: "synthetic.txt", mimeType: "text/plain",
      dataBase64: Buffer.from("Synthetic test marker: green-42.").toString("base64"),
    });
    assert.equal(upload.status, 200, "Real App Storage upload");
    attachmentId = upload.data.attachment.id;
    const keys = await pool.query("SELECT storage_key FROM chat_attachments WHERE id=$1 AND user_id=$2", [attachmentId, a.id]);
    storageKeys.push(keys.rows[0].storage_key);
    assert.equal((await call(`/api/chat-v1/attachments/${attachmentId}/info`, b)).status, 404);
    const bytes = await fetch(origin + `/api/chat-v1/attachments/${attachmentId}`, { headers: { Authorization: `Bearer ${a.token}` } });
    assert.equal(await bytes.text(), "Synthetic test marker: green-42.");
    report.realStorageUploadDownload = true;
  } else report.realStorageUploadDownload = "unavailable; not mocked";
  if (process.argv.includes("--model")) {
    const body = { clientRequestId: randomUUID(), text: "Reply only: green-42", attachmentIds: attachmentId ? [attachmentId] : [], language: "en" };
    const sent = await call(`/api/chat-v1/conversations/${conversation}/messages`, a, body);
    assert.equal(sent.status, 202, "One real model request");
    const repeated = await call(`/api/chat-v1/conversations/${conversation}/messages`, a, body);
    assert.equal(repeated.data.reply.id, sent.data.reply.id);
    let reply;
    for (let n = 0; n < 90; n++) {
      reply = (await call(`/api/chat-v1/conversations/${conversation}/messages/${sent.data.reply.id}`, a)).data.message;
      if (["complete", "failed", "interrupted"].includes(reply.status)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    report.realModel = { status: reply.status, text: reply.text, errorCode: reply.errorCode };
    const evidence = await pool.query("SELECT model,provider_request_id,usage FROM chat_messages WHERE id=$1 AND user_id=$2",
                                     [sent.data.reply.id, a.id]);
    report.modelEvidence = evidence.rows[0];
    assert.equal(reply.status, "complete", "Real model must finish; no retries/fallback");
    const history = await call(`/api/chat-v1/conversations/${conversation}/messages`, a);
    assert.equal(history.data.messages.length, 2);
    report.realModelDuplicateAndHistory = true;
  }
} catch (error: any) {
  report.failed = error.code ?? error.message;
  process.exitCode = 1;
} finally {
  // Delete only objects/rows belonging to synthetic accounts created by this process.
  for (const key of storageKeys) {
    const deleted = await new Client().delete(key);
    if (!deleted.ok) report.storageCleanupFailed = true;
  }
  for (const identity of identities) {
    for (const table of ["chat_messages", "chat_conversations", "chat_attachments", "sessions"]) {
      await pool.query(`DELETE FROM ${table} WHERE user_id=$1`, [identity.id]);
    }
    await pool.query("DELETE FROM users WHERE id=$1 AND email LIKE 'chat-dev-probe-%@example.invalid'", [identity.id]);
  }
  await pool.end();
  console.log(JSON.stringify(report, null, 2));
}
