import express from "express";
import request from "supertest";
import { describe, it, expect, vi } from "vitest";
import { finalCallResult } from "./finalResult";
import { registerChatGPTIntegration, type IntegrationConfig } from "./routes";
import { Credentials, fail, grantId, type Scope } from "./security";
import { testMarkerStore } from "./testSupport";

const turns = [{ id: "a", role: "secretary", text: "Hello." },
  { id: "b", role: "guest", text: "Nine tomorrow." }];
const config: IntegrationConfig = { enabled: true, origin: "https://fixture.example.test",
  clientId: "fixture", redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
  signingKey: () => "synthetic-final-result-fixture-not-a-real-key", outboundEnabled: true };
async function fixture(scopes: Scope[] = ["calls:read", "calls:transcript", "offline_access"], owner = "alice") {
  let status = "completed";
  const backend: any = { start: vi.fn(), prepare: vi.fn(), history: vi.fn(), call: vi.fn(), tasks: vi.fn().mockResolvedValue([
    { id: "task-alice", clientRequestId: "56fa4264-8b0a-4692-bcb2-77b03c145631" },
  ]), task: vi.fn(async (who: string, id: string) => {
    if (who !== "alice" || id !== "task-alice") return fail(404, "Owned task not found");
    return { id, status, summary: status === "completed" ? "Hours confirmed" : "", transcriptTurns: turns };
  }) };
  const app = express(); app.use(express.json());
  const store = testMarkerStore(), grant = grantId(config.clientId, scopes);
  await store.put({ id: grant, userId: owner, expiresAt: new Date(Date.now() + 600_000) });
  const credentials = new Credentials(config.signingKey, `${config.origin}/api/chatgpt/mcp`);
  const token = credentials.issue({ type: "access", sub: owner, grant, client: config.clientId, scopes, exp: Date.now() + 120_000 });
  registerChatGPTIntegration(app, config, store, backend);
  const rpc = (name: string, args: object) => request(app).post("/api/chatgpt/mcp").auth(token, { type: "bearer" })
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  return { app, rpc, backend, setStatus(value: string) { status = value; } };
}
describe("saved final result; no ChatGPT live transport", () => {
  it.each(["starting", "ringing", "connected", "finalizing"])("never leaks live text for %s", status => {
    const result = finalCallResult({ id: "t", status, summary: "partial", transcriptTurns: turns });
    expect(result.ready).toBe(false);
    expect(result).not.toHaveProperty("transcript");
    expect(result).not.toHaveProperty("summary");
  });
  it.each(["completed", "failed", "cancelled", "canceled"])("returns actual saved partial/full speech for %s", status => {
    const result = finalCallResult({ id: "t", status, transcriptTurns: turns });
    expect(result).toMatchObject({ ready: true, summary: null, status,
      transcript: "Секретарь: Hello.\n\nСобеседник: Nine tomorrow." });
  });
  it("does not invent missing text, summaries or outcomes", () => {
    expect(finalCallResult({ id: "t", status: "failed" })).toMatchObject({
      ready: true, summary: null, outcome: null, transcript: "", turnCount: 0 });
  });
  it("preserves complete saved speech without the old turn/cursor or character limit", () => {
    const speech = "RU EN ES ".repeat(20_000);
    expect(finalCallResult({ id: "t", status: "completed", transcriptTurns: [{ role: "guest", text: speech }] }).transcript)
      .toBe("Собеседник: " + speech);
  });
  it("retrieves the same owned result repeatedly without preparing or starting work", async () => {
    const f = await fixture();
    for (let i = 0; i < 2; i++) {
      const r = await f.rpc("get_call_result", { id: "task-alice" });
      expect(r.body.result.structuredContent).toMatchObject({ ready: true, summary: "Hours confirmed",
        transcript: "Секретарь: Hello.\n\nСобеседник: Nine tomorrow." });
    }
    expect(f.backend.start).not.toHaveBeenCalled();
    expect(f.backend.prepare).not.toHaveBeenCalled();
  });
  it("recovers only an existing exact clientRequestId after a lost start response", async () => {
    const f = await fixture();
    const r = await f.rpc("get_call_result", { clientRequestId: "56fa4264-8b0a-4692-bcb2-77b03c145631" });
    expect(r.body.result.structuredContent.task_id).toBe("task-alice");
    expect(f.backend.tasks).toHaveBeenCalledWith("alice");
    expect(f.backend.start).not.toHaveBeenCalled();
  });
  it("enforces transcript permission before reading speech", async () => {
    const f = await fixture(["calls:read", "offline_access"]);
    expect((await f.rpc("get_call_result", { id: "task-alice" })).body.result.isError).toBe(true);
    expect(f.backend.task).not.toHaveBeenCalled();
  });
  it("does not read another owner's task", async () => {
    const f = await fixture(undefined, "bob");
    expect((await f.rpc("get_call_result", { id: "task-alice" })).body.result.isError).toBe(true);
    expect(f.backend.start).not.toHaveBeenCalled();
  });
  it("legacy get_call and get_task cannot be used as a live transcript feed", async () => {
    const f = await fixture();
    f.setStatus("connected");
    f.backend.call.mockResolvedValue({ id: "call-alice", status: "in-progress", transcript: "private live speech" });
    const call = await f.rpc("get_call", { id: "call-alice", includeTranscript: true });
    const task = await f.rpc("get_task", { id: "task-alice", includeTranscript: true });
    expect(call.body.result.structuredContent).not.toHaveProperty("transcript");
    expect(task.body.result.structuredContent).not.toHaveProperty("transcriptTurns");
    expect(task.body.result.structuredContent.ready).toBe(false);
  });
  it("blocks removed model/UI monitor tools and no longer registers old player endpoints", async () => {
    const f = await fixture();
    for (const name of ["open_call_monitor", "read_call_turns"])
      expect((await f.rpc(name, { id: "task-alice" })).body.error.code).toBe(-32602);
    expect((await request(f.app).get("/api/chatgpt/monitor/stream")).status).toBe(404);
    const listed = await request(f.app).post("/api/chatgpt/mcp").send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(listed.body.result.tools.map((t: any) => t.name)).not.toContain("open_call_monitor");
  });
  it("rejects mixed or absent result locators without reading a task", async () => {
    const f = await fixture();
    expect((await f.rpc("get_call_result", {})).body.result.isError).toBe(true);
    expect((await f.rpc("get_call_result", { id: "task-alice", clientRequestId: "56fa4264-8b0a-4692-bcb2-77b03c145631" })).body.result.isError).toBe(true);
    expect(f.backend.task).not.toHaveBeenCalled();
  });
});
