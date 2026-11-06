import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { ChatRepository } from "./repository";
import { sendMessage } from "./contracts";
import { ChatService } from "./service";
import { chatRouter } from "./routes";
import express from "express";
import request from "supertest";

// Explicit opt-in, development DB only; never imported via server/db legacy initialization.
describe.skipIf(process.env.CHAT_DB_TESTS !== "1")("Chat 1A PostgreSQL durability and concurrency", () => {
  const owner = "__chat1a_test_" + randomUUID(), other = "__chat1a_other_" + randomUUID();
  let pool: Pool, repo: ChatRepository;
  beforeAll(() => {
    if (process.env.NODE_ENV !== "test") throw Error("Test DB guard");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    repo = new ChatRepository(pool);
  });
  afterAll(async () => {
    await pool.query("DELETE FROM chat_messages WHERE user_id=ANY($1::varchar[])", [[owner, other]]);
    await pool.query("DELETE FROM chat_conversations WHERE user_id=ANY($1::varchar[])", [[owner, other]]);
    await pool.query("DELETE FROM chat_attachments WHERE user_id=ANY($1::varchar[])", [[owner, other]]);
    await pool.end();
  });
  const input = (text = "Hello") => sendMessage.parse({ clientRequestId: randomUUID(), text });
  it("creates once and refuses different payload under the same request ID", async () => {
    const id = randomUUID();
    const a = await repo.create(owner, id, "First");
    expect((await repo.create(owner, id, "First")).id).toBe(a.id);
    await expect(repo.create(owner, id, "Different")).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect((await repo.list(other)).conversations).toHaveLength(0);
    await expect(repo.messages(other, a.id)).rejects.toThrow("NOT_FOUND");
  });
  it("concurrent duplicate sends allocate exactly two ordered messages; fresh process can read them", async () => {
    const c = await repo.create(owner, randomUUID());
    const body = input();
    const [a, b] = await Promise.all([repo.accept(owner, c.id, body, true), repo.accept(owner, c.id, body, true)]);
    expect(a.message.id).toBe(b.message.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    const fresh = new ChatRepository(pool);
    expect((await fresh.messages(owner, c.id)).messages.map(m => m.sequence)).toEqual([1, 2]);
    expect(await fresh.claim(owner, a.reply.id)).toBe(true);
    expect(await fresh.claim(owner, a.reply.id)).toBe(false);
    await expect(fresh.accept(owner, c.id, input(), true)).rejects.toThrow("CHAT_BUSY");
    await fresh.save(owner, a.reply.id, "Hello back", "complete");
    expect((await fresh.one(owner, c.id, a.reply.id)).text).toBe("Hello back");
    await expect(fresh.one(other, c.id, a.reply.id)).rejects.toThrow("NOT_FOUND");
    await expect(fresh.accept(owner, c.id, { ...body, text: "Changed" }, true)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("expired in-flight generation becomes interrupted, survives restart, never claims again", async () => {
    const c = await repo.create(other, randomUUID());
    const accepted = await repo.accept(other, c.id, input(), true);
    await pool.query("UPDATE chat_messages SET lease_until=now()-interval '1 second',text='partial' WHERE id=$1", [accepted.reply.id]);
    const row = (await new ChatRepository(pool).messages(other, c.id)).messages[1];
    expect(row.status).toBe("interrupted");
    expect(row.text).toBe("partial");
    expect(await repo.claim(other, accepted.reply.id)).toBe(false);
    expect((await repo.accept(other, c.id, { ...input(), clientRequestId: accepted.message.clientRequestId }, true)).created).toBe(false);
  });
  it("missing model does not acknowledge a user message as sent", async () => {
    const c = await repo.create(owner, randomUUID());
    await expect(repo.accept(owner, c.id, input(), false)).rejects.toThrow("MODEL_UNAVAILABLE");
    expect((await repo.messages(owner, c.id)).messages).toEqual([]);
  });
  it("prevents another user's attachment from entering model context", async () => {
    const a = await repo.attachmentIntent(owner, randomUUID(), { name: "private.txt", size: 3, mimeType: "text/plain",
      storageKey: "test-private", inputHash: "test" });
    await repo.attachmentStatus(owner, a.attachment.id, "ready");
    await expect(repo.attachment(other, a.attachment.id)).rejects.toThrow("NOT_FOUND");
    const c = await repo.create(other, randomUUID());
    await expect(repo.accept(other, c.id, { ...input(), attachmentIds: [a.attachment.id] }, true)).rejects.toThrow("ATTACHMENT_NOT_READY");
  });
  it("HTTP + PostgreSQL + streaming service roundtrip, duplicate send, file isolation and reopening", async () => {
    const blobs = new Map<string, Buffer>();
    let modelCalls = 0;
    const storage: any = {
      list: async () => ({ ok: true, value: [] }),
      uploadFromBytes: async (key: string, bytes: Buffer) => { blobs.set(key, bytes); return { ok: true, value: null }; },
      downloadAsBytes: async (key: string) => ({ ok: true, value: [blobs.get(key)] }),
    };
    const provider = { available: () => true, generate: async function* (_history, files) {
      modelCalls++;
      expect(files[0].bytes.toString()).toBe("Private test file");
      yield { text: "A real persisted ", requestId: "req_mock_no_network" };
      yield { text: "test response." };
      yield { complete: true, usage: { output_tokens: 5 } };
    } };
    const svc = new ChatService(repo, provider, storage);
    const app = express(); app.use(express.json());
    app.use("/api/chat-v1", chatRouter((req, _res, next) => {
      (req as any).user = { id: req.headers["x-test-owner"] === "other" ? other : owner }; next();
    }, async () => svc));
    const created = await request(app).post("/api/chat-v1/conversations").set("Authorization", "Bearer unit-test")
      .send({ clientRequestId: randomUUID() });
    expect(created.status).toBe(200);
    const id = created.body.conversation.id;
    const upload = await request(app).post("/api/chat-v1/attachments").set("Authorization", "Bearer unit-test")
      .send({ clientRequestId: randomUUID(), name: "private.txt", mimeType: "text/plain",
        dataBase64: Buffer.from("Private test file").toString("base64") });
    expect(upload.status).toBe(200);
    expect(upload.body.attachment).not.toHaveProperty("storageKey");
    const file = upload.body.attachment.id;
    expect((await request(app).get(`/api/chat-v1/attachments/${file}/info`).set("x-test-owner", "other")).status).toBe(404);
    expect((await request(app).get(`/api/chat-v1/attachments/${file}`).set("x-test-owner", "other")).status).toBe(404);
    const info = await request(app).get(`/api/chat-v1/attachments/${file}/info`);
    expect(info.body.attachment.name).toBe("private.txt");
    const downloaded = await request(app).get(`/api/chat-v1/attachments/${file}`);
    expect(downloaded.headers["x-content-type-options"]).toBe("nosniff");
    expect(downloaded.headers["content-disposition"]).toContain("attachment;");
    const body = { clientRequestId: randomUUID(), text: "Read this", attachmentIds: [file] };
    const sent = await request(app).post(`/api/chat-v1/conversations/${id}/messages`)
      .set("Authorization", "Bearer unit-test").send(body);
    expect(sent.status).toBe(202);
    const duplicate = await request(app).post(`/api/chat-v1/conversations/${id}/messages`)
      .set("Authorization", "Bearer unit-test").send(body);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.message.id).toBe(sent.body.message.id);
    let reply: any;
    for (let i = 0; i < 40; i++) {
      reply = (await request(app).get(`/api/chat-v1/conversations/${id}/messages/${sent.body.reply.id}`)).body.message;
      if (reply.status === "complete") break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(reply.status).toBe("complete");
    expect(reply.text).toBe("A real persisted test response.");
    expect(modelCalls).toBe(1);
    expect((await new ChatRepository(pool).messages(owner, id)).messages).toHaveLength(2);
    expect((await request(app).get(`/api/chat-v1/conversations/${id}/messages`).set("x-test-owner", "other")).status).toBe(404);
    expect((await request(app).get("/api/chat-v1/conversations").set("Origin", "https://evil.invalid")).status).toBe(403);
  });
});
