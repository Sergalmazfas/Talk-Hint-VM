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
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { buildCompanyStructure } from "../../shared/companyStructure";

describe("strategy persistence and HTTP boundaries", () => {
  let rows: Map<string, ProjectModelState>, app: express.Express, pool: Pool;
  const path = "/api/admin/project-model?hypothesis=new-country";
  const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  const root = () => {
    const r = initialModel();
    r.alternatives = [{ id: "new-country", title: "Новая", model: initialModel() }]; return r;
  };
  function mount() {
    const a = express(); a.use(express.json({ limit: "10mb" })); registerProjectModel(a, new PgModelRepository(async () => pool)); return a;
  }
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BENCHMARK_ADMIN_EMAILS", "owner@example.test,second@example.test");
    rows = new Map([["owner", root()], ["second", root()]]);
    let pending: Map<string, ProjectModelState> | null = null;
    let archives = new Map<string, any>(), pendingArchives: Map<string, any> | null = null;
    const query = vi.fn(async (sql: string, args: any[] = []) => {
      if (sql.startsWith("SELECT to_regclass"))
        return { rows: [{ company_table: null }], rowCount: 1 };
      if (sql.startsWith("INSERT INTO talkhint_project_model_history")) {
        const target = pendingArchives ?? archives;
        for (const row of JSON.parse(args[1])) if (!target.has(`${args[0]}:${row.key}`)) target.set(`${args[0]}:${row.key}`, row);
        return { rows: [] };
      }
      if (sql.startsWith("WITH RECURSIVE"))
        return { rows: Array.from((pendingArchives ?? archives).entries()).filter(([key]) => key.startsWith(`${args[0]}:`)).map(([, row]) => copy(row)) };
      if (sql.startsWith("SELECT payload")) {
        const row = archives.get(`${args[0]}:${args[1]}`);
        return { rows: row ? [{ payload: copy(row.payload) }] : [] };
      }
      if (sql.startsWith("CREATE") || sql.startsWith("INSERT")) return { rows: [] };
      if (sql === "BEGIN") { pending = new Map(Array.from(rows, ([k, v]) => [k, copy(v)])); pendingArchives = new Map(archives); return { rows: [] }; }
      if (sql === "COMMIT") { rows = pending!; pending = null; archives = pendingArchives!; pendingArchives = null; return { rows: [] }; }
      if (sql === "ROLLBACK") { pending = null; pendingArchives = null; return { rows: [] }; }
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
  it("reads owner/hypothesis historical snapshots without allowing historical writes or a fabricated revision", async () => {
    expect((await post({ type: "saveOperatingModel", baseVersion: 0, data: defaultOperatingModel() })).status).toBe(200);
    const past = `${path}&revision=0`;
    const snapshot = await request(app).get(past).set("x-test-user", "owner");
    expect(snapshot.status).toBe(200);
    expect(snapshot.headers["x-model-snapshot"]).toBe("read-only");
    expect(snapshot.headers["cache-control"]).toBe("no-store");
    expect(snapshot.body.revision).toBe(0);
    expect(snapshot.body.operatingModel).toBeUndefined();
    const other = await request(app).get(past).set("x-test-user", "second");
    expect(other.status).toBe(200); // Their OWN current revision 0 is available, not owner's checkpoint.
    expect(other.body.operatingModel).toBeUndefined();
    expect(rows.get("second")!.revision).toBe(0);
    expect((await request(app).get(past)).status).toBe(401);
    for (const revision of ["-1", "1.5", "abc", "9007199254740992"])
      expect((await request(app).get(`${path}&revision=${revision}`).set("x-test-user", "owner")).status).toBe(400);
    expect((await request(app).get(`${path}&revision=99`).set("x-test-user", "owner")).status).toBe(404);
    expect((await post({ type: "saveDocument", title: "Do not write", text: "", url: "", elementIds: [] }, "owner", 1, past)).status).toBe(400);
    expect(rows.get("owner")!.revision).toBe(1);
    vi.stubEnv("NODE_ENV", "production");
    expect((await request(app).get(past).set("x-test-user", "owner")).status).toBe(404);
  });
  it("persists company hierarchy, managers and journey in the existing row across API recreation", async () => {
    const before = copy(rows.get("owner")!), other = copy(rows.get("second")!);
    const legacy = defaultOperatingModel();
    expect((await post({ type: "saveOperatingModel", baseVersion: 0, data: legacy })).status).toBe(200);
    const data = buildCompanyStructure(legacy);
    const command = { type: "saveOperatingModel" as const, baseVersion: 1, data };
    const saved = await post(command);
    expect(saved.status).toBe(200);
    expect(saved.body.operatingModel.revisions[0].data).toEqual(legacy);
    expect(saved.body.operatingModel.revisions[1].data.customerPath).toEqual(data.customerPath);
    app = mount();
    const reread = await request(app).get(path).set("x-test-user", "owner");
    expect(reread.body.operatingModel).toEqual(saved.body.operatingModel);
    expect((await post({ ...command, baseVersion: 2 })).body).toEqual(reread.body);
    expect((await post(command)).status).toBe(409);
    const invalid = copy(data); invalid.nodes.find(n => n.id === "ai-ceo")!.managerId = "foreign-owner";
    expect((await post({ ...command, baseVersion: 2, data: invalid })).status).toBe(400);
    expect(rows.get("second")).toEqual(other);
    expect((await request(app).get(path).set("x-test-user", "second")).body.operatingModel).toBeUndefined();
    expect(rows.get("owner")!.elements).toEqual(before.elements);
    expect((await post({ ...command, baseVersion: 2 }, "owner", undefined, "/api/admin/project-model?hypothesis=original")).status).toBe(409);
    const state = copy(rows.get("owner"));
    vi.stubEnv("NODE_ENV", "production");
    expect((await post({ ...command, baseVersion: 2 })).status).toBe(404);
    expect((await request(app).get(path).set("x-test-user", "owner")).status).toBe(404);
    expect(rows.get("owner")).toEqual(state);
  });
  it("round-trips organisation with history, no-op retries and owner / Dev isolation", async () => {
    const before = copy(rows.get("owner")!), second = copy(rows.get("second")!);
    const data = defaultOperatingModel();
    const cmd = { type: "saveOperatingModel" as const, baseVersion: 0, data };
    expect((await request(app).post(path).send({ revision: 0, command: cmd })).status).toBe(401);
    expect((await request(app).post(path).set("x-test-user", "owner").set("Origin", "https://other.example")
      .send({ revision: 0, command: cmd })).status).toBe(403);
    expect((await post(cmd, "owner", undefined, "/api/admin/project-model")).status).toBe(409);
    const saved = await post(cmd); expect(saved.status).toBe(200);
    expect(saved.body.operatingModel.revisions[0].actor).toBe("owner");
    app = mount();
    const reread = await request(app).get(path).set("x-test-user", "owner");
    expect(reread.body.operatingModel).toEqual(saved.body.operatingModel);
    expect((await post({ ...cmd, baseVersion: 1 })).body).toEqual(reread.body);
    const changed = copy(data); changed.nodes[0].code = "TH-NEW";
    const updated = await post({ ...cmd, baseVersion: 1, data: changed });
    expect(updated.status).toBe(200);
    expect(updated.body.operatingModel.revisions).toHaveLength(2);
    expect((await post({ ...cmd, baseVersion: 1 })).status).toBe(409);
    expect(rows.get("owner")!.elements).toEqual(before.elements);
    expect(rows.get("second")).toEqual(second);
    expect((await request(app).get(path).set("x-test-user", "second")).body.operatingModel).toBeUndefined();
    const foreign = copy(data); foreign.nodes[0].referenceIds = ["foreign-owner-only"];
    expect((await post({ ...cmd, data: foreign }, "second")).status).toBe(400);
    vi.stubEnv("NODE_ENV", "production");
    expect((await post({ ...cmd, baseVersion: 2 })).status).toBe(404);
    expect((await request(app).get(path).set("x-test-user", "owner")).status).toBe(404);
  });
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
