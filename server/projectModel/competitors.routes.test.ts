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
import { emptyCompetitorResearch } from "../../shared/competitorResearch";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import type { ModelRepository } from "./repository";
import { randomUUID } from "node:crypto";
import { newReview } from "../../shared/competitorAssessments";
import { persistPublicSupport, publicSupportResearch } from "./research/publicSupport";
import type { Pool } from "pg";

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
  it("imports all five support profiles into the SAME owner repository, reloads them through the API and makes repeat imports a no-op", async () => {
    // SQL boundary round-trips JSON just like jsonb. It shares the exact repository
    // used by the authenticated HTTP route, not a parallel content collection.
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      const owner = String(values![0]);
      if (sql.startsWith("SELECT state")) return { rows: [{ state: JSON.parse(JSON.stringify(repo.root(owner))) }] };
      if (sql.startsWith("UPDATE talkhint_project_models")) {
        const next = JSON.parse(String(values![1])); expect(next.revision).toBe(values![2]);
        repo.rows.set(owner, next); return { rows: [] };
      }
      throw new Error(`Unexpected test query: ${sql}`);
    });
    const pool = { query, connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool;
    for (const appId of Object.keys(publicSupportResearch)) {
      const current = await request(app).get(path).set("x-test-user", "owner");
      const body = mutation();
      body.revision = current.body.revision;
      body.command.snapshot.name = `Existing competitor ${appId}`;
      body.command.snapshot.appStore = `https://apps.apple.com/us/app/id${appId}`;
      const saved = await post(body); expect(saved.status).toBe(200);
    }
    const before = await request(app).get(path).set("x-test-user", "owner");
    const oldIds = before.body.competitorDirectory.records.map((r: any) => r.id);
    expect(before.body.competitorDirectory.records.every((r: any) => !r.revisions.at(-1).snapshot.supportResearch)).toBe(true);
    const imported = await persistPublicSupport(pool, "owner");
    expect(imported).toMatchObject({ changed: 5, completeReadback: true, otherMaterialsPreserved: true });
    const reloaded = await request(app).get(path).set("x-test-user", "owner");
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.competitorDirectory.records.map((r: any) => r.id)).toEqual(oldIds);
    for (const record of reloaded.body.competitorDirectory.records) {
      const snapshot = record.revisions.at(-1).snapshot, appId = snapshot.appStore.match(/\/id(\d+)/)[1];
      expect(snapshot.supportResearch).toEqual(publicSupportResearch[appId]);
      expect(snapshot.assessments).toBeUndefined();
      expect(record.revisions[0]).toEqual(before.body.competitorDirectory.records.find((r: any) => r.id === record.id).revisions[0]);
    }
    const second = await persistPublicSupport(pool, "owner");
    expect(second).toMatchObject({ changed: 0, revision: imported.revision, completeReadback: true });
    expect(query.mock.calls.filter(([sql]) => sql.startsWith("UPDATE "))).toHaveLength(1);
    const unchanged = await request(app).get(path).set("x-test-user", "owner");
    expect(unchanged.body).toEqual(reloaded.body);
    // A new repository/app instance reads the persisted JSON after a restart.
    const rows = JSON.parse(JSON.stringify(Array.from(repo.rows.entries())));
    repo = new Repository(); rows.forEach(([owner, state]: [string, ProjectModelState]) => repo.rows.set(owner, state));
    app = express(); app.use(express.json()); registerProjectModel(app, repo);
    const reopened = await request(app).get(path).set("x-test-user", "owner");
    expect(reopened.body).toEqual(reloaded.body);
    const other = await request(app).get(path).set("x-test-user", "second");
    expect(other.body.competitorDirectory).toBeUndefined();
    const row = repo.root("owner").alternatives!.find(a => a.id === "new-country")!.model.competitorDirectory!.records[0];
    row.revisions.at(-1)!.snapshot.supportResearch!.channels!.note = "Последующее ручное уточнение";
    const manualState = JSON.parse(JSON.stringify(repo.root("owner")));
    await expect(persistPublicSupport(pool, "owner")).rejects.toThrow("manual merge required");
    expect(repo.root("owner")).toEqual(manualState);
  });
  it("saves personal checks through the existing authenticated store, rejects cross-owner/stale/replayed and production writes", async () => {
    const initial = await post(mutation()), id = initial.body.competitorDirectory.records[0].id;
    const review = { ...newReview("design"), author: "Личный тест", platform: "iPhone", testedAt: "2026-10-24", score: 7, rationale: "Реальная проверка" };
    const command = { type: "addCompetitorReview", id, baseVersion: 1, requestId: randomUUID(), review };
    expect((await request(app).post(path).send({ revision: initial.body.revision, command })).status).toBe(401);
    expect((await request(app).post(path).set("x-test-user", "owner").set("Host", "127.0.0.1").set("Origin", "http://attacker.example").send({ revision: initial.body.revision, command })).status).toBe(403);
    const saved = await post({ revision: initial.body.revision, command });
    expect(saved.status).toBe(200);
    const reload = await request(app).get(path).set("x-test-user", "owner");
    const snapshot = reload.body.competitorDirectory.records[0].revisions.at(-1).snapshot;
    expect(snapshot.assessments.design[0].score).toBe(7);
    expect(snapshot.assessments.design[0].recordedBy).toBe("owner");
    expect(snapshot.assessments.usability).toBeUndefined();
    expect((await post({ revision: initial.body.revision, command })).status).toBe(409);
    expect((await post({ revision: saved.body.revision, command: { ...command, baseVersion: 2 } })).status).toBe(409);
    const other = await request(app).post(path).set("x-test-user", "second").set("Host", "127.0.0.1").set("Origin", "http://127.0.0.1").send({ revision: 0, command });
    expect(other.status).toBe(404);
    const bad = await post({ revision: saved.body.revision, command: { ...command, baseVersion: 2, requestId: randomUUID(), review: { ...newReview("support"), author: "Личный тест", platform: "iOS", score: 9, rationale: "Не обращался" } } });
    expect(bad.status).toBe(400);
    const afterBad = await request(app).get(path).set("x-test-user", "owner");
    expect(afterBad.body).toEqual(reload.body);
    vi.stubEnv("NODE_ENV", "production");
    expect((await post({ revision: saved.body.revision, command })).status).toBe(404);
  });
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
  it("saves and rereads manual quarterly snapshots and TalkHint-only research with the same owner/revision protections", async () => {
    const saved = await post(mutation());
    expect(saved.status).toBe(200);
    const now = new Date(), quarter = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
    const capture = { type: "captureCompetitorQuarter", quarter, reason: "Ручная сверка", direction: "Без утверждения о готовности функций" };
    const captured = await post({ revision: saved.body.revision, command: capture });
    expect(captured.status).toBe(200);
    expect(captured.body.competitorDirectory.quarters).toHaveLength(1);
    expect((await post({ revision: captured.body.revision, command: { ...capture, competitorVersions: [] } })).status).toBe(400);
    const command = { type: "saveTalkHintResearch", current: emptyCompetitorResearch(), target: emptyCompetitorResearch(), checkedAt: "2026-10-24", reason: "Только исследовательская карточка" };
    expect((await post({ revision: saved.body.revision, command })).status).toBe(409);
    const updated = await post({ revision: captured.body.revision, command });
    expect(updated.status).toBe(200);
    expect(updated.body.competitorDirectory.talkhint.researchHistory).toHaveLength(1);
    const reread = await request(app).get(path).set("x-test-user", "owner");
    expect(reread.body.competitorDirectory.quarters).toEqual(captured.body.competitorDirectory.quarters);
    expect(reread.body.competitorDirectory.records[0].revisions[0].snapshot).toEqual(initialAIPhoneSnapshot);
    const second = await request(app).get(path).set("x-test-user", "second");
    expect(second.body.competitorDirectory).toBeUndefined();
    vi.stubEnv("NODE_ENV", "production");
    expect((await post({ revision: updated.body.revision, command: capture })).status).toBe(404);
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
