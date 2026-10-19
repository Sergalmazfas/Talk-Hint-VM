import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  create: vi.fn(), existing: vi.fn(), attach: vi.fn(), preDial: vi.fn(), getTask: vi.fn(), listTasks: vi.fn(),
  history: vi.fn(), getCall: vi.fn(), clone: vi.fn(), ready: vi.fn(), query: vi.fn(), feed: vi.fn(),
}));
vi.mock("../db", () => ({ db: { select: () => ({
  from: () => ({ where: () => ({ limit: f.query, orderBy: () => ({ limit: f.query }) }) }),
}) } }));
vi.mock("../storage", () => ({ storage: { getUserCalls: f.history, getCall: f.getCall } }));
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
const input = {
  phoneNumber: "+12025550123", instruction: "Ask for opening hours",
  clientRequestId: "56fa4264-8b0a-4692-bcb2-77b03c145631",
  voiceProvider: "elevenlabs" as const, translationLanguage: "ru" as const,
};
const row = {
  id: "task1", userId: "alice", status: "starting", ...input,
  transcript: "private words", transcriptTurns: [{ text: "private words" }],
  metadata: { internal: "not for tools" }, createdAt: new Date(), updatedAt: new Date(),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "fake-test-only");
  f.query.mockResolvedValue([{ id: "number" }]);
  f.clone.mockResolvedValue({ status: "ready", voiceId: "fake" });
  f.existing.mockResolvedValue(undefined);
  f.create.mockResolvedValue({ created: true, task: row });
  f.attach.mockResolvedValue(row);
  f.ready.mockReturnValue("fake");
});
import { afterEach } from "vitest";
afterEach(() => vi.unstubAllEnvs());
describe("Secretary adapter uses durable native launch helpers", () => {
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
    f.ready.mockImplementationOnce(() => { throw new Error("Clone not ready"); });
    await expect(backend.start("alice", input)).rejects.toThrow("Clone not ready");
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
});
