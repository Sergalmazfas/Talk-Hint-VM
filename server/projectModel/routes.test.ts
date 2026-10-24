import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
vi.mock("../db", () => ({ pool: null, dbReady: Promise.resolve() }));
vi.mock("../auth", () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    const id = req.get("x-test-user");
    if (!id) return res.sendStatus(401);
    req.user = { id, email: `${id}@example.test` }; next();
  },
}));
import { registerProjectModel } from "./routes";
import { applyCommand, ModelError } from "./domain";
import { initialModel } from "./seed";
import type { ModelRepository } from "./repository";
import type { ProjectModelState } from "../../shared/projectModel";

class MemoryRepository implements ModelRepository {
  states = new Map<string, ProjectModelState>();
  async read(owner: string) {
    if (!this.states.has(owner)) this.states.set(owner, initialModel());
    return structuredClone(this.states.get(owner)!);
  }
  async update(owner: string, revision: number, command: any) {
    const old = await this.read(owner);
    // In-memory unit tests run serial mutations; real concurrency covered by PG smoke.
    if (old.revision !== revision) throw new ModelError(409, "Conflict");
    const next = applyCommand(old, command, owner);
    this.states.set(owner, next); return structuredClone(next);
  }
}
describe("project model HTTP boundary", () => {
  let app: express.Express, repo: MemoryRepository;
  const path = "/api/admin/project-model";
  beforeEach(() => {
    vi.stubEnv("BENCHMARK_ADMIN_EMAILS", "owner@example.test,second@example.test");
    repo = new MemoryRepository(); app = express(); app.use(express.json()); registerProjectModel(app, repo);
  });
  const mutation = { revision: 0, command: { type: "saveDocument", title: "Internal", text: "Private", url: "", elementIds: ["TH-CLIENT"] } };
  const post = (app: express.Express, body: any, user = "owner") => request(app).post(path).set("x-test-user", user).set("Origin", "http://127.0.0.1").set("Host", "127.0.0.1").send(body);
  it("rejects guest, regular Google account and missing allowlist on reads and writes", async () => {
    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).get(path).set("x-test-user", "ordinary")).status).toBe(403);
    expect((await post(app, mutation, "ordinary")).status).toBe(403);
    vi.stubEnv("BENCHMARK_ADMIN_EMAILS", "");
    expect((await request(app).get(path).set("x-test-user", "owner")).status).toBe(403);
    expect(repo.states.size).toBe(0);
  });
  it("denies CSRF/missing origin and spoofed owner/history", async () => {
    expect((await request(app).post(path).set("x-test-user", "owner").send(mutation)).status).toBe(403);
    expect((await request(app).post(path).set("x-test-user", "owner").set("Origin", "https://evil.test").send(mutation)).status).toBe(403);
    expect((await post(app, { ...mutation, owner: "second" })).status).toBe(400);
  });
  it("persists and reloads real commands, keeps owner namespaces separate and rejects stale revisions", async () => {
    expect((await post(app, mutation)).status).toBe(200);
    const r = await request(app).get(path).set("x-test-user", "owner");
    expect(r.body.documents.at(-1).text).toBe("Private");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect((await post(app, mutation)).status).toBe(409);
    const b = await request(app).get(path).set("x-test-user", "second");
    expect(b.body.revision).toBe(0);
    expect(b.body.documents.some((d: any) => d.title === "Internal")).toBe(false);
  });
  it("fails visibly without pretending success or leaking storage errors", async () => {
    const broken = express(); broken.use(express.json());
    registerProjectModel(broken, { read: async () => { throw Error("PRIVATE_CONNECTION_STRING"); }, update: async () => { throw Error("PRIVATE_CONNECTION_STRING"); } });
    const r = await request(broken).get(path).set("x-test-user", "owner");
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain("PRIVATE_CONNECTION");
    expect((await post(broken, mutation)).status).toBe(503);
  });
});
