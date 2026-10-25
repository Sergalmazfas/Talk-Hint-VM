import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  create: vi.fn(), existing: vi.fn(), attach: vi.fn(), preDial: vi.fn(), getTask: vi.fn(), listTasks: vi.fn(),
  history: vi.fn(), getCall: vi.fn(), clone: vi.fn(), ready: vi.fn(), query: vi.fn(), feed: vi.fn(),
  modelAvailable: vi.fn(), prepareCall: vi.fn(), outgoingContext: vi.fn(), retellReady: vi.fn(),
}));
vi.mock("../secretary/voice", async importOriginal => ({
  ...await importOriginal<typeof import("../secretary/voice")>(),
  requireSecretaryAudioModel: f.modelAvailable,
}));
vi.mock("../db", () => ({ db: { select: () => ({
  from: () => ({ where: () => ({ limit: f.query, orderBy: () => ({ limit: f.query }) }) }),
}) } }));
vi.mock("../storage", () => ({ storage: { getUserCalls: f.history, getCall: f.getCall } }));
vi.mock("../secretary/personalities/defaults", () => ({
  prepareDefaultCall: f.prepareCall,
  confirmedOutgoingContext: f.outgoingContext,
  contextHash: () => "a".repeat(64),
}));
vi.mock("../secretary/retellPhone", () => ({ requireRetellPhone: f.retellReady }));
vi.mock("../secretary/dialer", () => ({ secretaryCallbackOrigin: () => "https://fixture.example.test" }));
vi.mock("../voiceLab/store", () => ({ getClone: f.clone, getCartesiaClone: f.clone }));
vi.mock("../translation/cloneSpeech", () => ({ requireReadyTranslatorClone: f.ready }));
vi.mock("../secretary/feed", () => ({ publishSecretaryFeedEvent: f.feed }));
vi.mock("../secretary/tasks", () => ({
  createLiveSecretaryTask: f.create, getLiveSecretaryTaskByClientRequest: f.existing,
  getSecretaryTaskById: f.getTask, listSecretaryTasks: f.listTasks,
  attachSecretaryCall: f.attach, markSecretaryPreDialFailed: f.preDial,
  toSecretaryTaskReport: (row: any) => row,
}));
import { secretaryBackend } from "./secretary";
import { SecretaryPreDialError } from "../secretary/dialErrors";
import express from "express";
import request from "supertest";
import { registerChatGPTIntegration } from "./routes";
import { digest } from "./security";
import { testMarkerStore } from "./testSupport";
import { mcpReleaseConfiguration } from "./releaseConfig";
vi.mock("../auth", () => ({ authMiddleware: (_req: any, res: any) => res.sendStatus(401) }));
const input = {
  phoneNumber: "+12025550123", instruction: "Ask for opening hours",
  clientRequestId: "56fa4264-8b0a-4692-bcb2-77b03c145631",
  voiceProvider: "openai" as const, translationLanguage: "ru" as const,
};
const row = {
  id: "task1", userId: "alice", status: "starting", ...input,
  transcript: "private words", transcriptTurns: [{ text: "private words" }],
  metadata: { internal: "not for tools" }, createdAt: new Date(), updatedAt: new Date(),
};
beforeEach(() => {
  vi.clearAllMocks();
  f.prepareCall.mockImplementation(async (_owner, call) => call);
  f.outgoingContext.mockResolvedValue(undefined);
  f.retellReady.mockResolvedValue("fixture-agent");
  vi.stubEnv("OPENAI_API_KEY", "fake-test-only");
  vi.stubEnv("ELEVENLABS_API_KEY", "fake-test-only");
  vi.stubEnv("CARTESIA_API_KEY", "fake-test-only");
  f.query.mockResolvedValue([{ id: "number" }]);
  f.clone.mockResolvedValue({ status: "ready", voiceId: "fake" });
  f.existing.mockResolvedValue(undefined);
  f.create.mockResolvedValue({ created: true, task: row });
  f.attach.mockResolvedValue(row);
  f.ready.mockReturnValue("fake");
});
import { afterEach } from "vitest";
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("Secretary adapter uses durable native launch helpers", () => {
  it.each(["openai", "retell"] as const)("executes OAuth/refresh -> exact owner approval -> one %s mock launch -> task result", async voiceProvider => {
    const selectedInput = { ...input, voiceProvider };
    const outgoingContext = voiceProvider === "retell" ? { version: 1, numberId: "fixture-personal",
      fromNumber: "+12025550999", scope: "personal" as const, cardIds: [], cards: [],
      personality: { personalityId: "fixture-katya", version: 2, snapshot: { name: "Катя" } } } : undefined;
    const resolvedInput = outgoingContext ? { ...selectedInput, secretaryNumberId: outgoingContext.numberId,
      outgoingContextHash: "a".repeat(64), outgoingSummary: { fromNumber: outgoingContext.fromNumber,
        scope: outgoingContext.scope, personality: { id: "fixture-katya", name: "Катя", version: 2 } } } : selectedInput;
    f.prepareCall.mockResolvedValue(resolvedInput);
    f.outgoingContext.mockResolvedValue(outgoingContext);
    const app = express();
    app.use(express.json());
    let won = false;
    const task = { ...row, ...resolvedInput, outgoingContext, summary: "" };
    f.create.mockImplementation(async () => {
      const created = !won; won = true;
      return { created, task };
    });
    f.getTask.mockImplementation(async () => task);
    const dial = vi.fn().mockResolvedValue({ sid: `CA${"a".repeat(32)}`, callId: "fixture-call" });
    const origin = "https://outbound-fixture.example.test", clientId = "talkhint-chatgpt";
    const resource = `${origin}/api/chatgpt/mcp`;
    const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
    const config = mcpReleaseConfiguration({
      CHATGPT_SECRETARY_ORIGIN: origin, CHATGPT_SECRETARY_REDIRECT_URI: redirectUri,
      CHATGPT_SECRETARY_CALL_MODE: "owner-confirmed",
    }, true, () => "outbound-only-isolated-fixture-key-not-secret");
    expect(config.outboundEnabled).toBe(true);
    registerChatGPTIntegration(app, config, testMarkerStore(), secretaryBackend(dial), (req, res, next) => {
      const id = req.header("x-fixture-owner");
      if (!id) return void res.sendStatus(401);
      req.user = { id } as any;
      next();
    });
    const scope = "calls:read secretary:start offline_access";
    expect((await request(app).post("/api/chatgpt/connections").set("x-fixture-owner", "alice")
      .send({ approved: true, scope })).status).toBe(201);
    const verifier = "outbound-fixture-pkce-verifier-forty-three-characters-long";
    const authorized = await request(app).get("/api/chatgpt/oauth/authorize").set("x-fixture-owner", "alice")
      .query({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, resource,
        scope, state: "isolated-outbound-state", code_challenge_method: "S256", code_challenge: digest(verifier) });
    const tokens = await request(app).post("/api/chatgpt/oauth/token").type("form").send({
      client_id: clientId, redirect_uri: redirectUri, resource, grant_type: "authorization_code",
      code_verifier: verifier, code: new URL(authorized.headers.location).searchParams.get("code"),
    });
    expect(tokens.status).toBe(200);
    let accessToken = tokens.body.access_token;
    const rpc = (name: string, args: object) => request(app).post("/api/chatgpt/mcp")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    f.listTasks.mockResolvedValue([{ ...row, id: "historical-failed", status: "failed",
      createdAt: new Date("2026-09-27T00:00:00Z") }]);
    const oldHistory = await rpc("list_tasks", {});
    expect(oldHistory.body.result.structuredContent.tasks[0]).toMatchObject({
      id: "historical-failed", status: "failed",
    });
    // Expire the short-lived access token, then renew without another login or consent.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 601_000);
    expect((await rpc("get_profile", {})).body.result.isError).toBe(true);
    const renewed = await request(app).post("/api/chatgpt/oauth/token").type("form").send({
      client_id: clientId, resource, grant_type: "refresh_token", refresh_token: tokens.body.refresh_token,
    });
    expect(renewed.status).toBe(200);
    expect(renewed.body.scope).toBe(scope);
    accessToken = renewed.body.access_token;
    expect((await rpc("get_profile", {})).body.result.isError).toBe(false);
    // Simulate an installed plugin's frozen descriptor, not a fresh tools scan.
    const cachedTemplate = await request(app).post("/api/chatgpt/mcp")
      .send({ jsonrpc: "2.0", id: 3, method: "resources/read",
        params: { uri: "ui://talkhint/call-approval/v2.html" } });
    expect(cachedTemplate.status).toBe(200);
    expect(cachedTemplate.body.result.contents[0].uri).toBe("ui://talkhint/call-approval/v2.html");
    expect(cachedTemplate.body.result.contents[0].text).toContain("Подтвердить и позвонить");
    const prepared = await rpc("prepare_call", selectedInput);
    expect(prepared.body.result.structuredContent.call).toEqual(resolvedInput);
    if (voiceProvider === "retell") {
      expect(prepared.body.result.structuredContent.execution).toMatchObject({
        voice: "retell-Merritt", reasoning: "medium", outgoing: { personality: { name: "Катя", version: 2 } },
      });
      expect(dial).not.toHaveBeenCalled();
    }
    expect(prepared.body.result.structuredContent.execution.provider).toBe(voiceProvider);
    expect(prepared.body.result.structuredContent).not.toHaveProperty("approval_url");
    expect(prepared.body.result.structuredContent.confirmationMethod).toBe("inline_card");
    expect(f.create).not.toHaveBeenCalled();
    const { confirmation } = prepared.body.result.structuredContent;
    expect((await rpc("start_call", { confirmation, confirmed: true })).body.result.isError).toBe(true);
    expect((await rpc("start_call", { confirmation })).body.result.isError).toBe(true);
    expect(dial).not.toHaveBeenCalled();
    expect((await request(app).post("/api/chatgpt/confirmations/approve")
      .set("Authorization", `Bearer ${tokens.body.access_token}`)
      .send({ approved: true, confirmation })).status).toBe(401);
    const { confirmation: cardConfirmation, approvalToken } = prepared.body.result._meta["talkhint/cardApproval"];
    const card = { confirmation: cardConfirmation, approvalToken };
    const confirmed = await rpc("confirm_call_from_card", { ...card, decision: "approve" });
    expect(confirmed.body.result.isError).toBe(false);
    expect(confirmed.body.result.structuredContent.task_id).toBe(task.id);
    // Treat the first successful response as lost. Both a double click and a
    // network retry must recover the same durable task, not dial another number.
    const repeatedClicks = await Promise.all([
      rpc("confirm_call_from_card", { ...card, decision: "approve" }),
      rpc("confirm_call_from_card", { ...card, decision: "approve" }),
    ]);
    for (const repeated of repeatedClicks) {
      expect(repeated.body.result.isError).toBe(false);
      expect(repeated.body.result.structuredContent.task_id).toBe(task.id);
    }
    const starts = await Promise.all([rpc("start_call", { confirmation }), rpc("start_call", { confirmation })]);
    for (const response of starts) {
      expect(response.body.result.isError).toBe(false);
      expect(response.body.result.structuredContent.task_id).toBe(task.id);
      expect(response.body.result.structuredContent.task_id).not.toBe("historical-failed");
    }
    await vi.waitFor(() => expect(f.attach).toHaveBeenCalledTimes(1));
    expect(dial).toHaveBeenCalledTimes(1);
    expect(f.create).toHaveBeenCalledWith("alice", { ...resolvedInput, outgoingContext });
    expect(f.modelAvailable).toHaveBeenCalledTimes(voiceProvider === "openai" ? 1 + repeatedClicks.length + starts.length : 0);
    task.status = "finalizing";
    expect((await rpc("get_task", { id: task.id })).body.result.structuredContent.status).toBe("finalizing");
    task.status = "completed";
    task.summary = "Fixture result: opening hours confirmed";
    const result = await rpc("get_task", { id: task.id });
    expect(result.body.result.structuredContent).toMatchObject({
      id: task.id, status: "completed", summary: "Fixture result: opening hours confirmed",
    });
    expect(result.body.result.structuredContent).not.toHaveProperty("transcript");
    expect((await rpc("get_task", { id: task.id, includeTranscript: true })).body.result.isError).toBe(true);
    // All persistence, clone lookup and provider dialing in this test are fakes.
    // The production Twilio dialer, database and worker are never imported.
  });
  it("recovers existing attempts without dialing or leaking transcripts", async () => {
    f.existing.mockResolvedValue(row);
    const dial = vi.fn();
    const result = await secretaryBackend(dial).start("alice", input);
    expect(result.reused).toBe(true);
    expect(result.task).not.toHaveProperty("transcript");
    expect(result.task).not.toHaveProperty("metadata");
    expect(f.create).not.toHaveBeenCalled();
    expect(dial).not.toHaveBeenCalled();
  });
  it("only the single winning durable lease dials under concurrent requests", async () => {
    let won = false;
    f.create.mockImplementation(async () => {
      const created = !won; won = true; return { created, task: row };
    });
    const dial = vi.fn().mockResolvedValue({ sid: `CA${"a".repeat(32)}`, callId: "call1" });
    const backend = secretaryBackend(dial);
    const results = await Promise.all([backend.start("alice", input), backend.start("alice", input)]);
    await vi.waitFor(() => expect(f.attach).toHaveBeenCalledTimes(1));
    expect(dial).toHaveBeenCalledTimes(1);
    expect(results.filter(r => r.reused)).toHaveLength(1);
    expect(results[0].task).not.toHaveProperty("transcript");
  });
  it("returns a durable task while the provider is still pending", async () => {
    let resolve!: (value: any) => void;
    const dial = vi.fn(() => new Promise<any>(r => { resolve = r; }));
    const result = await secretaryBackend(dial).start("alice", input);
    expect(result.task.id).toBe("task1");
    expect(f.attach).not.toHaveBeenCalled();
    resolve({ sid: `CA${"a".repeat(32)}`, callId: "c1" });
    await vi.waitFor(() => expect(f.attach).toHaveBeenCalledTimes(1));
  });
  it("never redials after an ambiguous provider failure", async () => {
    const dial = vi.fn().mockRejectedValue(new Error("ambiguous timeout"));
    const backend = secretaryBackend(dial);
    await backend.start("alice", input);
    f.existing.mockResolvedValue(row);
    await backend.start("alice", input);
    expect(dial).toHaveBeenCalledTimes(1);
    expect(f.preDial).not.toHaveBeenCalled();
  });
  it("releases the task only for typed, certain pre-dial failure", async () => {
    const dial = vi.fn().mockRejectedValue(new SecretaryPreDialError("Not configured"));
    await secretaryBackend(dial).start("alice", input);
    await vi.waitFor(() => expect(f.preDial).toHaveBeenCalledWith("task1"));
    expect(dial).toHaveBeenCalledTimes(1);
  });
  it("does not reserve or dial without a number, ready clone and conversation service", async () => {
    const dial = vi.fn();
    const backend = secretaryBackend(dial);
    f.query.mockResolvedValueOnce([]);
    await expect(backend.start("alice", input)).rejects.toMatchObject({ status: 409 });
    f.modelAvailable.mockRejectedValueOnce(new Error("Model not ready"));
    await expect(backend.start("alice", input)).rejects.toThrow("Model not ready");
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(backend.start("alice", input)).rejects.toMatchObject({ status: 503 });
    expect(dial).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });
  it("checks ownership before returning call/task details", async () => {
    f.getCall.mockResolvedValue({ ...row, userId: "bob" });
    f.getTask.mockResolvedValue({ ...row, userId: "bob" });
    const backend = secretaryBackend(vi.fn());
    await expect(backend.call("alice", "task1", true)).rejects.toMatchObject({ status: 404 });
    await expect(backend.task("alice", "task1", true)).rejects.toMatchObject({ status: 404 });
  });
  it("redacts transcripts by default and keeps the request ID for recovery", async () => {
    f.getCall.mockResolvedValue(row);
    f.getTask.mockResolvedValue(row);
    f.listTasks.mockResolvedValue([row]);
    const backend = secretaryBackend(vi.fn());
    expect(await backend.call("alice", "task1", false)).not.toHaveProperty("transcript");
    expect(await backend.task("alice", "task1", false)).not.toHaveProperty("transcriptTurns");
    expect(await backend.task("alice", "task1", true)).toHaveProperty("transcript", "private words");
    expect((await backend.tasks("alice"))[0].clientRequestId).toBe(input.clientRequestId);
  });
  it("links saved summaries only to this owner's calls, never to a foreign report", async () => {
    f.history.mockResolvedValue([{ id: "call1", userId: "alice", status: "completed" }]);
    f.listTasks.mockResolvedValue([
      { ...row, callId: "call1", summary: "Own saved summary" },
      { ...row, userId: "bob", callId: "call1", summary: "Foreign private summary" },
    ]);
    const backend = secretaryBackend(vi.fn());
    expect((await backend.history("alice"))[0].summary).toBe("Own saved summary");
    f.getCall.mockResolvedValue({ id: "call1", userId: "alice", metadata: { secretaryTaskId: "task1" } });
    f.getTask.mockResolvedValue({ ...row, userId: "bob", callId: "call1", summary: "Foreign private summary" });
    expect((await backend.call("alice", "call1", false)).summary).toBeNull();
    f.getTask.mockResolvedValue({ ...row, callId: "different-call", summary: "Unrelated own summary" });
    expect((await backend.call("alice", "call1", false)).summary).toBeNull();
    f.getTask.mockResolvedValue({ ...row, callId: "call1", summary: "Own saved summary" });
    expect((await backend.call("alice", "call1", false)).summary).toBe("Own saved summary");
    expect(f.create).not.toHaveBeenCalled();
  });
});
