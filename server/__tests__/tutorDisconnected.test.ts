import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";

// A leftover credential must not enable the retired connection.
vi.hoisted(() => { process.env.TUTOR_ENGINE_API_KEY = "offline-disconnected-test-key"; });
vi.mock("../auth", () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    if (!req.headers["x-test-user"]) return res.sendStatus(401);
    req.user = { id: String(req.headers["x-test-user"]) };
    next();
  },
}));
vi.mock("../storage", () => ({ storage: { getUserPhoneNumbers: vi.fn(async () => []) } }));
vi.mock("../tutorStorage", () => ({
  createTutorSessionRow: vi.fn(), endTutorSessionRow: vi.fn(),
  getTutorSessionRow: vi.fn(), getCallMemoryByEngineSession: vi.fn(),
  listTutorSessions: vi.fn(async (userId: string) => [{ id: "local-session", userId }]),
  saveCallMemory: vi.fn(),
  listCallMemories: vi.fn(async (userId: string) => [{ id: "local-memory", userId }]),
  getCallMemory: vi.fn(), updateCallMemoryFields: vi.fn(), confirmCallMemory: vi.fn(),
}));
vi.mock("../tutorTranslate", () => ({
  translateTutorText: vi.fn(), validateTranslateInput: vi.fn(),
}));

import { registerTutorRoutes } from "../tutorRoutes";
import {
  tutorEngineConfigured, getCapabilities, getTutorCatalog,
  completeTutorSession, startCallMemoryGeneration, fetchCallMemory,
} from "../tutorEngine";
import { externalTutorConnectionEnabled } from "../tutorConnectionPolicy";
import { createTutorSessionRow } from "../tutorStorage";

describe("External Tutor disconnected, local application preserved", () => {
  const app = express();
  app.use(express.json());
  registerTutorRoutes(app);
  const forbiddenFetch = vi.fn(() => { throw new Error("Unexpected external request"); });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", forbiddenFetch);
  });
  afterEach(() => {
    expect(forbiddenFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not activate from a saved API key", () => {
    expect(externalTutorConnectionEnabled()).toBe(false);
    expect(tutorEngineConfigured()).toBe(false);
  });
  it("blocks the adapter before any network request", async () => {
    for (const operation of [
      () => getCapabilities(), () => getTutorCatalog(),
      () => completeTutorSession("fixture"),
      () => startCallMemoryGeneration("fixture"), () => fetchCallMemory("fixture"),
    ]) {
      await expect(operation()).rejects.toMatchObject({ kind: "disabled" });
    }
  });
  it("keeps the local page and explicitly reports disconnected status/catalog", async () => {
    await request(app).get("/tutor").expect(200);
    const status = await request(app).get("/api/tutor/status").set("x-test-user", "owner").expect(200);
    expect(status.body).toMatchObject({ configured: false, ready: false, disabled: true, callMemoryReady: false });
    expect(status.body.message).toContain("отключено");
    const catalog = await request(app).get("/api/tutor/tutors").set("x-test-user", "owner").expect(200);
    expect(catalog.body).toMatchObject({ tutors: [], disabled: true });
  });
  it("rejects remote lifecycle/smoke requests without creating local sessions", async () => {
    for (const path of ["/api/tutor/sessions", "/api/tutor/sessions/fixture/end"]) {
      const result = await request(app).post(path).set("x-test-user", "owner").send({}).expect(503);
      expect(result.body.error).toBe("tutor_engine_disabled");
    }
    await request(app).get("/api/tutor/smoke").set("x-test-user", "owner").expect(503);
    expect(createTutorSessionRow).not.toHaveBeenCalled();
  });
  it("preserves authenticated owner-scoped local history", async () => {
    for (const path of ["/api/tutor/sessions", "/api/tutor/memories"]) {
      await request(app).get(path).expect(401);
      for (const owner of ["owner-a", "owner-b"]) {
        const result = await request(app).get(path).set("x-test-user", owner).expect(200);
        expect(result.body).toEqual([expect.objectContaining({ userId: owner })]);
      }
    }
    await request(app).post("/api/tutor/sessions").send({}).expect(401);
  });
  it("removes publishing/workflow dependency and retires the direct live probe", () => {
    const read = (path: string) => readFileSync(path, "utf8");
    const build = read("script/build.ts");
    expect(build).not.toContain("runTutorEngineContractProbe");
    expect(build).not.toContain("spawnSync");
    expect(build).toContain("verifyMcpBuild");
    expect(read(".replit")).not.toContain('"tutor-engine-contract"');
    const probe = read("scripts/tutor-engine-contract-probe.ts").split("async function main()")[1];
    expect(probe.indexOf("if (!externalTutorConnectionEnabled())")).toBeLessThan(probe.indexOf("await checkCapabilities()"));
    expect(probe).toContain("process.exitCode = 2");
  });
});
