import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Pool } from "pg";
vi.mock("../db", () => ({ pool: null, dbReady: Promise.resolve() }));
vi.mock("../auth", () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    const id = req.get("x-test-user"); if (!id) return res.sendStatus(401);
    req.user = { id, email: `${id}@example.test` }; next();
  },
}));
import { registerProjectModel } from "./routes";
import { PgModelRepository } from "./repository";
import { initialModel } from "./seed";
import { emptyStrategyNode } from "../../shared/projectStrategy";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import { defaultAnalystPreparation } from "../../shared/competitiveAnalystTemplate";

describe("strategy persistence and HTTP boundaries", () => {
  let rows: Map<string, ProjectModelState>, app: express.Express, pool: Pool;
  const path = "/api/admin/project-model?hypothesis=new-country";
  const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  const root = () => {
    const r = initialModel();
    r.alternatives = [{ id: "new-country", title: "Новая", model: initialModel() }]; return r;
  };
  function mount() {
    const a = express(); a.use(express.json()); registerProjectModel(a, new PgModelRepository(async () => pool)); return a;
  }
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BENCHMARK_ADMIN_EMAILS", "owner@example.test,second@example.test");
    rows = new Map([["owner", root()], ["second", root()]]);
    let pending: Map<string, ProjectModelState> | null = null;
    const query = vi.fn(async (sql: string, args: any[] = []) => {
      if (sql.startsWith("CREATE") || sql.startsWith("INSERT")) return { rows: [] };
      if (sql === "BEGIN") { pending = new Map(Array.from(rows, ([k, v]) => [k, copy(v)])); return { rows: [] }; }
      if (sql === "COMMIT") { rows = pending!; pending = null; return { rows: [] }; }
      if (sql === "ROLLBACK") { pending = null; return { rows: [] }; }
      if (sql.startsWith("SELECT state")) {
        const state = (pending ?? rows).get(args[0]); return { rows: state ? [{ state: copy(state), revision: state.revision }] : [] };
      }
      if (sql.startsWith("UPDATE")) {
        const state = JSON.parse(args[1]); expect(state.revision).toBe(args[2]); pending!.set(args[0], state); return { rows: [] };
      }
      throw new Error("Unexpected SQL in persistence test");
    });
    pool = { query, connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool;
    app = mount();
  });
  afterEach(() => vi.unstubAllEnvs());
  async function post(command: ModelCommand, owner = "owner", revision?: number, url = path) {
    return request(app).post(url).set("x-test-user", owner).set("Host", "127.0.0.1")
      .set("Origin", "http://127.0.0.1").send({ revision: revision ?? rows.get(owner)!.revision, command });
  }
  it("round-trips nodes, dependencies, impacts and reviews through SQL JSON and a new repository/API instance", async () => {
    const original = copy(rows.get("owner")!), other = copy(rows.get("second")!);
    const created = await post({ type: "saveStrategyNode", baseVersion: 0, node: { ...emptyStrategyNode(), title: "Основание" } });
    expect(created.status).toBe(200);
    const record = created.body.strategy.nodes[0], from = "element:TH-PRODUCT", to = `node:${record.id}`;
    expect((await post({ type: "saveStrategyLink", from, to, kind: "depends_on", reason: "Явное основание" })).status).toBe(200);
    const changed = await post({ type: "saveStrategyNode", id: record.id, baseVersion: 1,
      node: { ...record.revisions[0].data, description: "Новые сведения" } });
    expect(changed.status).toBe(200);
    const impact = changed.body.strategy.impacts.find((i: any) => i.target === from);
    expect(impact.source).toBe(to);
    const retained = await post({ type: "reviewStrategyImpact", id: impact.id, outcome: "retained", reason: "Нужен дополнительный тест" });
    expect(retained.status).toBe(200);
    expect(rows.get("owner")!.elements).toEqual(original.elements);
    expect(rows.get("owner")!.alternatives![0].model.strategy!.impacts[0].reviews[0].actor).toBe("owner");
    app = mount(); // Recreate app and repository; only serialized PG rows survive.
    const reloaded = await request(app).get(path).set("x-test-user", "owner");
    expect(reloaded.body).toEqual(retained.body);
    const sameNode = reloaded.body.strategy.nodes[0];
    const unchanged = await post({ type: "saveStrategyNode", id: sameNode.id,
      baseVersion: sameNode.revisions.at(-1).version, node: sameNode.revisions.at(-1).data });
    expect(unchanged.status).toBe(200);
    expect(unchanged.body).toEqual(reloaded.body); // No root revision, audit or impact created by a no-op.
    expect(rows.get("second")).toEqual(other);
    expect((await request(app).get(path).set("x-test-user", "second")).body.strategy).toBeUndefined();
    expect((await post({ type: "saveStrategyLink", from, to, kind: "depends_on", reason: "Чужой узел" }, "second")).status).toBe(404);
    const before = copy(rows.get("owner"));
    expect((await post({ type: "saveStrategyNode", baseVersion: 0, node: { ...emptyStrategyNode(), title: "Устарело" } }, "owner", 0)).status).toBe(409);
    expect(rows.get("owner")).toEqual(before);
  });
  it("keeps auth, origin, hypothesis, production and strict-input guards, without any writes on failure", async () => {
    const cmd = { type: "saveStrategyNode", baseVersion: 0, node: { ...emptyStrategyNode(), title: "Тест" } } as const;
    const before = JSON.stringify(Array.from(rows.entries()));
    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).post(path).set("x-test-user", "owner").set("Origin", "https://evil.example")
      .send({ revision: 0, command: cmd })).status).toBe(403);
    expect((await post(cmd, "owner", 0, "/api/admin/project-model?hypothesis=original")).status).toBe(409);
    expect((await post({ ...cmd, node: { ...cmd.node, evidence: { ...cmd.node.evidence, status: "verified" } } })).status).toBe(400);
    expect((await request(app).post(path).set("x-test-user", "owner").set("Origin", "http://127.0.0.1").set("Host", "127.0.0.1")
      .send({ revision: 0, command: { ...cmd, actor: "spoof" } })).status).toBe(400);
    vi.stubEnv("NODE_ENV", "production");
    expect((await request(app).get(path).set("x-test-user", "owner")).status).toBe(404);
    expect((await post(cmd)).status).toBe(404);
    expect(JSON.stringify(Array.from(rows.entries()))).toBe(before);
  });
  it("saves analyst preparation in the SAME owner row and reads it after API/repository recreation without running anything", async () => {
    const other = copy(rows.get("second")), original = copy(rows.get("owner"));
    const data = defaultAnalystPreparation(rows.get("owner")!.alternatives![0].model);
    const command = { type: "saveAnalystPreparation" as const, baseVersion: 0, preparation: data };
    const saved = await post(command);
    expect(saved.status).toBe(200);
    expect(saved.body.analystPreparation.revisions[0]).toMatchObject({ status: "awaiting_approval", version: 1, actor: "owner" });
    app = mount();
    const loaded = await request(app).get(path).set("x-test-user", "owner");
    expect(loaded.body.analystPreparation).toEqual(saved.body.analystPreparation);
    expect((await post({ ...command, baseVersion: 1 })).body).toEqual(loaded.body);
    expect((await post(command)).status).toBe(409);
    expect((await post(command, "owner", undefined, "/api/admin/project-model?hypothesis=original")).status).toBe(409);
    expect(rows.get("second")).toEqual(other);
    expect(rows.get("owner")!.elements).toEqual(original!.elements);
    expect(rows.get("owner")!.alternatives![0].model.competitorDirectory).toEqual(original!.alternatives![0].model.competitorDirectory);
    expect((await request(app).get(path).set("x-test-user", "second")).body.analystPreparation).toBeUndefined();
    const before = JSON.stringify(Array.from(rows.entries()));
    expect((await request(app).post(path).set("x-test-user", "owner").set("Origin", "https://evil.example")
      .send({ revision: loaded.body.revision, command })).status).toBe(403);
    vi.stubEnv("NODE_ENV", "production");
    expect((await post({ ...command, baseVersion: 1 })).status).toBe(404);
    expect(JSON.stringify(Array.from(rows.entries()))).toBe(before);
  });
});
