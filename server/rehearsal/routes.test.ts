import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../benchmark/adminGate", () => ({ requireBenchmarkAdmin: (req: any, res: any, next: any) => {
  if (req.get("Authorization") !== "Bearer owner") return res.sendStatus(401);
  req.user = { id: "owner" }; next();
} }));
import { registerRehearsalRoutes } from "./routes";
describe("rehearsal owner boundary and no blind starts", () => {
  let app: ReturnType<typeof express>, runtime: any;
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", ""); vi.stubEnv("REPLIT_DEV_DOMAIN", "stand.replit.dev");
    runtime = { snapshot: vi.fn().mockResolvedValue({ scenes: [], versions: [], history: [], ready: true }),
      create: vi.fn().mockResolvedValue({ id: "s", report: { status: "connecting" } }),
      analyse: vi.fn().mockResolvedValue({ report: {} }), saveScene: vi.fn(), waiting: vi.fn(), get: vi.fn(),
      readAudio: vi.fn().mockResolvedValue({ bytes: Buffer.from("private"), type: "audio/wav" }) };
    app = express(); registerRehearsalRoutes(app, runtime);
  });
  afterEach(() => vi.unstubAllEnvs());
  it("requires admin authentication for data and audio", async () => {
    expect((await request(app).get("/api/admin/rehearsal")).status).toBe(401);
    expect((await request(app).get("/api/admin/rehearsal/sessions/id/audio")).status).toBe(401);
    expect(runtime.readAudio).not.toHaveBeenCalled();
  });
  it("is absent on production even for an owner", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await request(app).get("/api/admin/rehearsal").set("Authorization", "Bearer owner")).status).toBe(404);
    expect(runtime.snapshot).not.toHaveBeenCalled();
  });
  it("requires current owner-bound CSRF AND the exact Dev Origin", async () => {
    const base = "/api/admin/rehearsal";
    const state = await request(app).get(base).set("Authorization", "Bearer owner");
    expect(state.body.csrf).toMatch(/^[a-f0-9]{64}$/);
    const post = () => request(app).post(base + "/sessions").set("Authorization", "Bearer owner");
    expect((await post().send({})).status).toBe(403);
    expect((await post().set("X-Rehearsal-CSRF", state.body.csrf).set("Origin", "https://evil.example").send({})).status).toBe(403);
    expect(runtime.create).not.toHaveBeenCalled();
    expect((await post().set("X-Rehearsal-CSRF", state.body.csrf).set("Origin", "https://stand.replit.dev")
      .send({ sceneId: "x" })).status).toBe(201);
    expect(runtime.create).toHaveBeenCalledTimes(1);
  });
  it("does not accept extra keys on analyse or retry an unclear failure", async () => {
    const base = "/api/admin/rehearsal";
    const state = await request(app).get(base).set("Authorization", "Bearer owner");
    const post = () => request(app).post(base + "/sessions/s/analyse").set("Authorization", "Bearer owner")
      .set("X-Rehearsal-CSRF", state.body.csrf).set("Origin", "https://stand.replit.dev");
    expect((await post().send({ ownerApproved: true })).status).toBe(400);
    expect(runtime.analyse).not.toHaveBeenCalled();
    runtime.analyse.mockRejectedValue(Error("MODEL_USAGE_UNKNOWN"));
    const result = await post().send({});
    expect(result.status).toBe(503); expect(result.body.error).toBe("MODEL_USAGE_UNKNOWN");
    expect(runtime.analyse).toHaveBeenCalledTimes(1);
  });
});
