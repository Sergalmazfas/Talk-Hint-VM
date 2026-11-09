import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { ChatRepository } from "./repository";
import { sendMessage } from "./contracts";
import { ChatService } from "./service";
import { chatRouter } from "./routes";
import express from "express";
import request from "supertest";
import { proposedPlan } from "./plans";

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
  it("hides crew events from non-admin history and direct reads", async () => {
    const c = await repo.create(owner, randomUUID());
    const pair = await repo.accept(owner, c.id, input("Private review"), true);
    await repo.claim(owner, pair.reply.id);
    await repo.save(owner, pair.reply.id, "Internal crew report", "complete");
    await pool.query(`UPDATE chat_messages SET usage=$2::jsonb WHERE id=$1`,
      [pair.reply.id, JSON.stringify({ visibility: "admin", event: { kind: "crew_result", taskId: randomUUID(), sourcePath: "/api/private" } })]);
    expect((await repo.messages(owner, c.id)).messages.map(m => m.id)).not.toContain(pair.reply.id);
    const admin = (await repo.messages(owner, c.id, undefined, true)).messages.find(m => m.id === pair.reply.id)!;
    expect(admin.event?.kind).toBe("crew_result");
    expect((admin as any).usage).toBeUndefined();
    await expect(repo.one(owner, c.id, pair.reply.id)).rejects.toThrow("NOT_FOUND");
    expect((await repo.one(owner, c.id, pair.reply.id, true)).text).toBe("Internal crew report");
    await expect(repo.messages(other, c.id, undefined, true)).rejects.toThrow("NOT_FOUND");
  });
  it("persists the exact phone snapshot and rejects changed-snapshot retries", async () => {
    const c = await repo.create(owner, randomUUID());
    const context = { localTime: new Date().toISOString(), timeZone: "America/Chicago" };
    const body = { ...input("Find places"), context };
    const pair = await repo.accept(owner, c.id, body, true);
    expect((await repo.messages(owner, c.id)).messages[0].context).toEqual(context);
    expect((await repo.accept(owner, c.id, body, true)).created).toBe(false);
    await expect(repo.accept(owner, c.id, { ...body, context: { ...context, timeZone: "America/Denver" } }, true))
      .rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await repo.claim(owner, pair.reply.id); await repo.save(owner, pair.reply.id, "Done", "complete");
  });
  it("missing model does not acknowledge a user message as sent", async () => {
    const c = await repo.create(owner, randomUUID());
    await expect(repo.accept(owner, c.id, input(), false)).rejects.toThrow("MODEL_UNAVAILABLE");
    expect((await repo.messages(owner, c.id)).messages).toEqual([]);
  });
  it("persists a proposed plan, confirms once across races/restart, rejects wrong owner/hash and later corrections", async () => {
    const c = await repo.create(owner, randomUUID());
    const sent = await repo.accept(owner, c.id, input("Prepare a Hint call"), true);
    const action = proposedPlan({ goal: "Ask total price, maximum $400", ownerFacts: [],
      sayAsk: ["Ask total price"], expectedQuestions: [{ q: "Number?", answer: null }], unknowns: [],
      disclosurePolicy: { allowed: [], forbidden: ["Do not pay"] }, language: "en", executor: "hint" });
    await repo.claim(owner, sent.reply.id);
    await repo.save(owner, sent.reply.id, "Please review", "complete", null, { action });
    const fresh = new ChatRepository(pool);
    expect((await fresh.one(owner, c.id, sent.reply.id)).action).toEqual(action);
    let saves = 0;
    const apply = async () => { saves++; return { id: "existing-plan-store", status: "pending" }; };
    await expect(fresh.confirmPlan(other, c.id, sent.reply.id, action.planHash, apply)).rejects.toThrow("NOT_FOUND");
    await expect(fresh.confirmPlan(owner, c.id, sent.reply.id, "0".repeat(64), apply)).rejects.toThrow("PLAN_CHANGED");
    const confirmed = await Promise.all(Array.from({ length: 3 }, () =>
      fresh.confirmPlan(owner, c.id, sent.reply.id, action.planHash, apply)));
    expect(saves).toBe(1);
    expect(confirmed.every(m => m.action?.status === "confirmed")).toBe(true);
    await new ChatRepository(pool).confirmPlan(owner, c.id, sent.reply.id, action.planHash, apply);
    expect(saves).toBe(1);
    const correction = await repo.accept(owner, c.id, input("Correction: maximum $350"), true);
    await expect(fresh.confirmPlan(owner, c.id, sent.reply.id, action.planHash, apply)).rejects.toThrow("PLAN_STALE");
    expect(saves).toBe(1);
    await repo.claim(owner, correction.reply.id);
    await repo.save(owner, correction.reply.id, "Updated price", "complete");
  });
  it("rolls back a failed confirmation without losing its proposal; retry uses the same message", async () => {
    const c = await repo.create(owner, randomUUID());
    const sent = await repo.accept(owner, c.id, input("Prepare another plan"), true);
    const action = proposedPlan({ goal: "Ask availability", ownerFacts: [], sayAsk: ["Ask availability"],
      expectedQuestions: [], unknowns: [], disclosurePolicy: { allowed: [], forbidden: [] },
      language: "en", executor: "hint" });
    await repo.claim(owner, sent.reply.id);
    await repo.save(owner, sent.reply.id, "Review", "complete", null, { action });
    await expect(repo.confirmPlan(owner, c.id, sent.reply.id, action.planHash, async () => {
      throw new Error("fixture unavailable");
    })).rejects.toThrow("fixture unavailable");
    expect((await repo.one(owner, c.id, sent.reply.id)).action?.status).toBe("proposed");
    await expect(repo.confirmPlan(owner, c.id, sent.reply.id, action.planHash, async () => ({ status: "pending" })))
      .resolves.toMatchObject({ action: { status: "confirmed" } });
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
