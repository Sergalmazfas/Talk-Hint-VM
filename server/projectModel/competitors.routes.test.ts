import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { initialModel } from "./seed";
import { applyHypothesisCommand, readHypothesis } from "./hypotheses";
import { ModelError } from "./domain";
import { initialAIPhoneSnapshot } from "./competitorInitial";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import type { ModelRepository } from "./repository";

class Repository implements ModelRepository {
  rows = new Map<string, ProjectModelState>();
  root(owner: string) {
    if (!this.rows.has(owner)) {
      const root = initialModel(), alternative = initialModel();
      if (!alternative.elements.some(e => e.id === "TH-PILOT-COMPETITORS"))
        alternative.elements.push({
          id: "TH-PILOT-COMPETITORS", title: "Конкуренты", section: "Бизнес-модель", scope: "talkhint",
          kind: "context", description: "", details: {}, contentStatus: "question",
          implementationStatus: "not_started", version: 1, updatedAt: "2026-10-24", needsReview: false,
        });
      root.alternatives = [{ id: "new-country", title: "Новая", model: alternative }];
      this.rows.set(owner, root);
    }
    return this.rows.get(owner)!;
  }
  async read(owner: string, hypothesis = "original") { return readHypothesis(this.root(owner), hypothesis); }
  async update(owner: string, revision: number, command: ModelCommand, hypothesis = "original") {
    const old = this.root(owner);
    if (old.revision !== revision) throw new ModelError(409, "Conflict");
    const next = applyHypothesisCommand(old, hypothesis, command, owner);
    this.rows.set(owner, next);
    return readHypothesis(next, hypothesis);
  }
}
describe("competitor directory HTTP protections", () => {
  let app: express.Express, repo: Repository;
  const path = "/api/admin/project-model?hypothesis=new-country";
  const mutation = () => ({
    revision: 0, command: { type: "saveCompetitor", baseVersion: 0, reason: "Согласованный снимок", snapshot: structuredClone(initialAIPhoneSnapshot) },
  });
  const post = (body: any, url = path) => request(app).post(url)
    .set("x-test-user", "owner").set("Host", "127.0.0.1").set("Origin", "http://127.0.0.1").send(body);
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BENCHMARK_ADMIN_EMAILS", "owner@example.test,second@example.test");
    repo = new Repository(); app = express(); app.use(express.json()); registerProjectModel(app, repo);
  });
  afterEach(() => vi.unstubAllEnvs());
  it("persists and reloads only the authenticated owner's selected hypothesis", async () => {
    expect((await request(app).get(path)).status).toBe(401);
    const result = await post(mutation());
    expect(result.status).toBe(200);
    expect(result.body.competitorDirectory.records).toHaveLength(1);
    const read = await request(app).get(path).set("x-test-user", "owner");
    expect(read.body.competitorDirectory.records[0].revisions[0].snapshot.plans[2].price).toBe(59.99);
    const other = await request(app).get(path).set("x-test-user", "second");
    expect(other.body.competitorDirectory).toBeUndefined();
    const original = await request(app).get("/api/admin/project-model").set("x-test-user", "owner");
    expect(original.body.competitorDirectory).toBeUndefined();
  });
  it("rejects duplicate stale requests and stale individual card updates", async () => {
    const saved = await post(mutation());
    expect((await post(mutation())).status).toBe(409);
    const command = { ...mutation().command, id: saved.body.competitorDirectory.records[0].id };
    expect((await post({ revision: saved.body.revision, command })).status).toBe(409);
    expect(repo.root("owner").alternatives![0].model.competitorDirectory!.records).toHaveLength(1);
  });
  it("blocks production, original-model writes, CSRF and spoofed history", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await post(mutation())).status).toBe(404);
    expect(repo.rows.size).toBe(0);
    vi.stubEnv("NODE_ENV", "development");
    expect((await post(mutation(), "/api/admin/project-model")).status).toBe(409);
    expect((await request(app).post(path).set("x-test-user", "owner").send(mutation())).status).toBe(403);
    expect((await post({ ...mutation(), owner: "second" })).status).toBe(400);
    expect((await post({ revision: 0, command: { ...mutation().command, revisions: [] } })).status).toBe(400);
  });
});
