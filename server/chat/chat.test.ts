import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { attachmentBytes, safeName, sendMessage, requestId, ChatError } from "./contracts";
import { chatRouter } from "./routes";
import { limitedHistory, CHAT_INSTRUCTIONS } from "./provider";
import { ChatService } from "./service";

const uuid = () => randomUUID();
describe("Chat 1A input and isolation boundary", () => {
  it("canonicalizes native uppercase UUIDs", () => expect(requestId.parse(uuid().toUpperCase())).toMatch(/^[a-f0-9-]+$/));
  it("rejects hidden permissions, empty sends and oversized text", () => {
    const base = { clientRequestId: uuid(), text: "Hello" };
    expect(sendMessage.safeParse({ ...base, userId: "other" }).success).toBe(false);
    expect(sendMessage.safeParse({ ...base, text: "" }).success).toBe(false);
    expect(sendMessage.safeParse({ ...base, text: "a".repeat(8001) }).success).toBe(false);
  });
  it.each(["image/jpeg", "image/png", "application/pdf"])("checks signature not just claimed %s", mimeType => {
    expect(() => attachmentBytes({ clientRequestId: uuid(), name: "x", mimeType: mimeType as any,
      dataBase64: Buffer.from("<script>hello</script>").toString("base64") })).toThrow("INVALID_ATTACHMENT_TYPE");
  });
  it("bounds decoded bytes, rejects invalid base64/UTF8 and sanitizes download names", () => {
    const file: any = { clientRequestId: uuid(), name: "a", mimeType: "text/plain" };
    expect(() => attachmentBytes({ ...file, dataBase64: "!!!!" })).toThrow();
    expect(() => attachmentBytes({ ...file, dataBase64: Buffer.from([0xff]).toString("base64") })).toThrow("INVALID_TEXT_ENCODING");
    expect(() => attachmentBytes({ ...file, dataBase64: Buffer.alloc(2 * 1024 * 1024 + 1, 65).toString("base64") })).toThrow("ATTACHMENT_TOO_LARGE");
    expect(safeName("../../private\r\n.txt")).not.toMatch(/[/\r\n]/);
  });
  it("uses only bounded completed conversation context, not partial/stale answers", () => {
    const messages = Array.from({ length: 90 }, (_, i) => ({ text: "x".repeat(1000), status: i === 89 ? "interrupted" : "complete" }));
    const bounded = limitedHistory(messages as any);
    expect(bounded.length).toBe(18);
    expect(bounded.every(x => x.status === "complete")).toBe(true);
    expect(CHAT_INSTRUCTIONS).toContain("It never saves, approves, schedules or dials");
  });
  const app = (user = "owner", svc: any = {}) => {
    const a = express(); a.use(express.json());
    a.use("/api/chat-v1", chatRouter((req, _res, next) => { (req as any).user = { id: user }; next(); }, async () => svc));
    return a;
  };
  it("requires browser origin and explicit intent; rejects foreign origin even with Bearer", async () => {
    const path = "/api/chat-v1/conversations";
    expect((await request(app()).post(path).send({})).status).toBe(403);
    expect((await request(app()).post(path).set("Authorization", "Bearer example").set("Origin", "https://evil.invalid").send({})).status).toBe(403);
  });
  it("rejects scoped integration identities and invalid foreign cursors", async () => {
    expect((await request(app("chatgpt:someone")).get("/api/chat-v1/conversations")).status).toBe(401);
    expect((await request(app()).get(`/api/chat-v1/conversations/${uuid()}/messages?beforeSequence=NaN`)).status).toBe(400);
  });
  it("derives owner from auth, emits no-store and hides storage diagnostics", async () => {
    const list = vi.fn().mockRejectedValue(new Error("private connection value"));
    const response = await request(app("alice", { repo: { list } })).get("/api/chat-v1/conversations");
    expect(list).toHaveBeenCalledWith("alice", undefined);
    expect(response.status).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.text).not.toContain("private connection");
  });
  it("returns precise unavailable-file state, never a fake successful upload", async () => {
    const repo: any = { attachmentIntent: vi.fn() };
    const storage: any = { list: vi.fn().mockResolvedValue({ ok: false }) };
    const svc = new ChatService(repo, {} as any, storage);
    await expect(svc.upload("alice", { clientRequestId: uuid(), name: "hello.txt", mimeType: "text/plain",
      dataBase64: Buffer.from("hello").toString("base64") })).rejects.toThrow("ATTACHMENTS_UNAVAILABLE");
    expect(repo.attachmentIntent).not.toHaveBeenCalled();
  });
  it("does not invoke provider for an idempotency replay", async () => {
    const repo: any = { accept: vi.fn().mockResolvedValue({ created: false, message: {}, reply: {} }), claim: vi.fn() };
    const provider: any = { available: () => true, generate: vi.fn() };
    const svc = new ChatService(repo, provider);
    await svc.send("alice", uuid(), sendMessage.parse({ clientRequestId: uuid(), text: "hello" }));
    expect(repo.claim).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });
  it("never downloads another user's file when repository refuses ownership", async () => {
    const repo: any = { attachment: vi.fn().mockRejectedValue(new ChatError("NOT_FOUND", 404)) };
    const objects: any = { downloadAsBytes: vi.fn() };
    await expect(new ChatService(repo, {} as any, objects).download("mallory", uuid())).rejects.toThrow("NOT_FOUND");
    expect(objects.downloadAsBytes).not.toHaveBeenCalled();
  });
});
