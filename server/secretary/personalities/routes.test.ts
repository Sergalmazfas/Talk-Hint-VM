import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  enabled: true, writes: vi.fn(), revise: vi.fn(), create: vi.fn(), list: vi.fn(),
  binding: vi.fn(), stream: vi.fn(),
}));
vi.mock("../../auth", () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    if (!req.headers["x-owner"]) return res.status(401).json({ error: "Unauthorized" });
    req.user = { id: req.headers["x-owner"] }; next();
  },
}));
vi.mock("../../storage", () => ({ storage: {
  getUser: async (id: string) => ({ email: id }),
  getUserPhoneNumbers: async () => [],
} }));
vi.mock("../../benchmark/adminGate", () => ({ isBenchmarkAdmin: (email: string) => email === "admin" }));
vi.mock("./store", () => ({
  personalitiesEnabled: () => f.enabled,
  problem: (status: number, message: string) => Object.assign(new Error(message), { status }),
  ownedNumber: async (owner: string, id: string) => {
    if (id !== owner + "-number") throw Object.assign(new Error("Номер не найден"), { status: 404 });
    return { id, type: "personal" };
  },
  readBinding: f.binding, assignPersonality: f.writes, revisePersonality: f.revise,
  createPersonality: f.create, listPersonalities: f.list, personalityDetails: async () => ({}),
  numberMode: (type: string) => type === "work" ? "work" : "personal",
}));
vi.mock("../conversationEngine", () => ({ streamSecretaryResponse: f.stream }));
import { registerPersonalityRoutes } from "./routes";
const app = express(); app.use(express.json()); registerPersonalityRoutes(app);
const body = { name: "Test", description: "Test", rules: "Warm", examples: [],
  modeGuidance: { personal: "Personal", work: "Work" } };
beforeEach(() => {
  vi.clearAllMocks(); f.enabled = true;
  f.binding.mockResolvedValue(undefined);
  f.list.mockResolvedValue({ items: [], nextCursor: null });
  f.writes.mockResolvedValue(undefined);
});
describe("Dev personality HTTP ownership, permissions and legacy behavior", () => {
  it("requires auth, and keeps the entire API disabled in production", async () => {
    expect((await request(app).get("/api/secretary-personalities")).status).toBe(401);
    f.enabled = false;
    expect((await request(app).get("/api/secretary-personalities").set("x-owner", "admin")).status).toBe(404);
  });
  it("does not appoint Katya by default and does not pretend personal incoming is implemented", async () => {
    const r = await request(app).get("/api/secretary-personalities/numbers/alice-number").set("x-owner", "alice");
    expect(r.status).toBe(200); expect(r.body.assignment).toBeNull();
    expect(r.body.support.incoming).toBe(false);
    expect(f.writes).not.toHaveBeenCalled();
    expect((await request(app).get("/api/secretary-personalities/numbers/alice-number").set("x-owner", "bob")).status).toBe(404);
  });
  it("validates number assignment and delegates owner identity from auth, not caller JSON", async () => {
    const r = await request(app).put("/api/secretary-personalities/numbers/alice-number").set("x-owner", "alice")
      .send({ personalityId: "katya-record", version: 1 });
    expect(r.status).toBe(200);
    expect(f.writes).toHaveBeenCalledWith("alice", "alice-number", "katya-record", 1);
    expect((await request(app).put("/api/secretary-personalities/numbers/alice-number").set("x-owner", "alice")
      .send({ personalityId: "id", version: null })).status).toBe(400);
    expect((await request(app).put("/api/secretary-personalities/numbers/alice-number").set("x-owner", "alice")
      .send({ personalityId: "id", version: 1, userId: "bob" })).status).toBe(400);
  });
  it("restricts catalog edits to existing admins and bounds list/search", async () => {
    expect((await request(app).post("/api/secretary-personalities").set("x-owner", "alice")
      .send({ ...body, slug: "test" })).status).toBe(403);
    expect((await request(app).post("/api/secretary-personalities").set("x-owner", "admin")
      .send({ ...body, slug: "test" })).status).toBe(201);
    expect((await request(app).put("/api/secretary-personalities/id").set("x-owner", "admin")
      .send({ ...body, status: "retired", expectedVersion: 1 })).status).toBe(200);
    expect(f.revise).toHaveBeenCalledWith("id", 1, "retired", body);
    expect((await request(app).get("/api/secretary-personalities?limit=1000").set("x-owner", "alice")).status).toBe(400);
    await request(app).get("/api/secretary-personalities?includeRetired=true").set("x-owner", "alice");
    expect(f.list).toHaveBeenLastCalledWith("", undefined, 25, false);
  });
  it("provides a real Engine text-only preview without tools or automatic card loading", async () => {
    f.stream.mockImplementation(async function* () { yield { type: "text", text: "Текстовый ответ" }; });
    const r = await request(app).post("/api/secretary-personalities/preview").set("x-owner", "alice")
      .send({ numberId: "alice-number", text: "Привет" });
    expect(r.status).toBe(200); expect(r.body.text).toBe("Текстовый ответ");
    expect(r.body.testOnly).toBe(true); expect(r.body.personality).toBeNull();
    expect(f.stream.mock.calls[0][1]).toEqual({ tools: [] });
    expect(f.stream.mock.calls[0][0].instructions).not.toContain("secretary-dev-fixture");
    expect((await request(app).post("/api/secretary-personalities/preview").set("x-owner", "bob")
      .send({ numberId: "alice-number", text: "Привет" })).status).toBe(404);
  });
});
