import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./review", () => ({ reviewRehearsal: vi.fn(async (row, save) => {
  row.report.rehearsal.review.status = "completed"; await save(); return 1000;
}) }));
import { reviewRehearsal } from "./review";
import { RehearsalRuntime } from "./runtime";
import { defaultRehearsalScenes, rehearsalVersions } from "./catalog";
describe("rehearsal admission, persistence and bounded review", () => {
  let runtime: RehearsalRuntime, store: any, audio: any, budget: any, lab: any, rows: Map<string, any>, input: any;
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "");
    for (const key of ["RETELL_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) vi.stubEnv(key, "fixture");
    rows = new Map();
    store = { list: vi.fn(async () => ({ scenes: [], history: [] })),
      save: vi.fn(async (_owner, row) => { rows.set(row.id, structuredClone(row)); }),
      get: vi.fn(async (owner, id) => {
        if (owner !== "owner" || !rows.has(id)) throw Object.assign(Error("REHEARSAL_NOT_FOUND"), { status: 404 });
        return structuredClone(rows.get(id));
      }) };
    audio = { ready: vi.fn().mockResolvedValue(undefined), capture: vi.fn().mockResolvedValue(undefined) };
    budget = { state: vi.fn().mockResolvedValue({ limitMicroUsd: 30e6, spentMicroUsd: 0, reservedMicroUsd: 0, remainingMicroUsd: 30e6 }),
      reserve: vi.fn().mockResolvedValue(undefined), settle: vi.fn().mockResolvedValue(undefined) };
    runtime = new RehearsalRuntime(store, audio, budget);
    lab = { reports: vi.fn(() => []), create: vi.fn(async (_owner, body) => ({
      id: "s", call: { access_token: "ephemeral-sdk-only" }, report: { id: "s", callId: "web-owned", status: "connecting",
        instruction: body.instruction, model: "gpt-6-sol", voice: "retell-Merritt",
        createdAt: new Date().toISOString(), turns: [] },
    })), stop: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(runtime as any, "lab").mockResolvedValue({ lab, api: {}, selection: { id: "persona", version: 2, mode: "work" } });
    const scene = defaultRehearsalScenes()[0], version = rehearsalVersions()[1];
    input = { sceneId: scene.id, sceneHash: scene.hash, versionId: version.id, versionHash: version.hash,
      clientRequestId: randomUUID(), consent: true, recordingConsent: true };
    vi.mocked(reviewRehearsal).mockClear();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it.each(["model", "phoneNumber", "tools", "publish"])("refuses extra capability %s before admission", async field => {
    await expect(runtime.create("owner", { ...input, [field]: "injected" })).rejects.toThrow();
    expect(budget.reserve).not.toHaveBeenCalled(); expect(lab.create).not.toHaveBeenCalled();
  });
  it("refuses stale scene/version snapshots and missing recording consent before budget", async () => {
    await expect(runtime.create("owner", { ...input, sceneHash: "old" })).rejects.toThrow("SNAPSHOT_CHANGED");
    await expect(runtime.create("owner", { ...input, recordingConsent: false })).rejects.toThrow("CONFIRMATION_REQUIRED");
    expect(budget.reserve).not.toHaveBeenCalled();
  });
  it("storage must be accessible BEFORE any paid admission", async () => {
    audio.ready.mockRejectedValue(Error("missing"));
    await expect(runtime.create("owner", input)).rejects.toThrow("NOT_READY");
    expect(budget.reserve).not.toHaveBeenCalled();
  });
  it("uses the SAME series budget, persists snapshots but never the SDK credential", async () => {
    const result = await runtime.create("owner", input);
    expect(budget.reserve).toHaveBeenCalledWith(input.clientRequestId, "C");
    expect(result.call.access_token).toBe("ephemeral-sdk-only");
    expect(JSON.stringify(rows.get("s"))).not.toContain("ephemeral-sdk-only");
    expect(rows.get("s").report.rehearsal.scene.hash).toBe(input.sceneHash);
    expect(rows.get("s").report.rehearsal.version.hash).toBe(input.versionHash);
  });
  it("budget exhaustion cannot start voice or a model", async () => {
    budget.reserve.mockRejectedValue(Error("SPEED_SERIES_BUDGET_EXHAUSTED"));
    await expect(runtime.create("owner", input)).rejects.toThrow("BUDGET_EXHAUSTED");
    expect(lab.create).not.toHaveBeenCalled(); expect(reviewRehearsal).not.toHaveBeenCalled();
  });
  it("stops an admitted web call once if persistence fails, with conservative debit and no retry", async () => {
    store.save.mockRejectedValue(Error("disk"));
    await expect(runtime.create("owner", input)).rejects.toThrow("disk");
    expect(lab.create).toHaveBeenCalledOnce(); expect(lab.stop).toHaveBeenCalledWith("owner", "s");
    expect(budget.settle).toHaveBeenCalledWith(input.clientRequestId, null);
  });
  function ended() {
    const scene = defaultRehearsalScenes()[0], version = rehearsalVersions()[1];
    rows.set("saved", { id: "saved", kind: "rehearsal", requestId: "old",
      report: { id: "saved", status: "ended", instruction: "x", model: "m", voice: "v", createdAt: "2026-01-01",
        turns: [{ id: "t", role: "guest", text: "We have a tire", atMs: 1000 }],
        rehearsal: { scene, version, codeVersion: version.hash, recordingConsent: true,
          audio: { status: "pending" }, review: { status: "not_started" } } } });
  }
  it("does not expose another owner's saved result", async () => {
    ended(); await expect(runtime.get("other", "saved")).rejects.toThrow("NOT_FOUND");
    expect(reviewRehearsal).not.toHaveBeenCalled();
  });
  it("completed review is read back, never automatically requested again", async () => {
    ended(); await runtime.analyse("owner", "saved");
    await new Promise(r => setTimeout(r, 0));
    expect((await runtime.get("owner", "saved")).report.rehearsal.review.status).toBe("completed");
    await runtime.analyse("owner", "saved"); expect(reviewRehearsal).toHaveBeenCalledOnce();
    expect(budget.settle).toHaveBeenCalledWith(expect.any(String), 1000);
  });
  it("unknown after interruption is charged, NEVER re-run", async () => {
    ended(); const row = rows.get("saved"); row.reviewRequestId = "old-review";
    row.report.rehearsal.review.status = "running";
    const result = await runtime.get("owner", "saved");
    expect(result.report.rehearsal.review.status).toBe("unknown");
    expect(budget.settle).toHaveBeenCalledWith("old-review", null);
    await runtime.analyse("owner", "saved"); expect(reviewRehearsal).not.toHaveBeenCalled();
  });
  it("insufficient review budget is explicit, not an infinite pending state or paid attempt", async () => {
    ended(); budget.reserve.mockRejectedValue(Error("SPEED_SERIES_BUDGET_EXHAUSTED"));
    const result = await runtime.analyse("owner", "saved");
    expect(result.report.rehearsal.review.status).toBe("failed");
    expect(reviewRehearsal).not.toHaveBeenCalled();
  });
});
