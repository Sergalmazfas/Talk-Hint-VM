import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { PgModelRepository } from "./repository";
import { archiveModel, unpackModel, activeModelSize } from "./history";
import { initialModel } from "./seed";
import { applyCommand } from "./domain";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { ProductCrewService } from "../productCrew/service";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";

// Explicit opt-in, hard allowlist, isolated schema. Never imports app startup,
// never contacts providers, never touches the owner's model or production.
const suite = process.env.RUN_MODEL_HISTORY_DB_TESTS === "1" ? describe : describe.skip;
suite("model history in isolated Dev PostgreSQL", () => {
  let admin: Pool, pool: Pool, repo: PgModelRepository;
  const schema = `model_history_test_${randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !["helium", "lithium"].includes(new URL(connectionString).hostname) || process.env.NODE_ENV === "production")
      throw new Error("Internal Dev database required; production is forbidden");
    admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    repo = new PgModelRepository(async () => pool);
    await repo.read("owner");
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
  });
  async function seed(owner: string) {
    await repo.read(owner);
    const root = initialModel();
    const model = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
      data: buildCompanyStructure(defaultOperatingModel()) }, owner);
    model.decisions.push(...Array.from({ length: 110 }, (_, i) => ({
      id: `LEGACY-${i}`, actor: owner, at: "2026-10-25", action: "Existing history",
      reason: "Сохранить".repeat(6500), elementIds: [],
    })));
    root.alternatives = [{ id: "new-country", title: "New", model }, { id: "untouched", title: "Independent", model: initialModel() }];
    await pool.query("UPDATE talkhint_project_models SET state=$2::jsonb WHERE owner_key=$1", [owner, JSON.stringify(root)]);
    return root;
  }
  const doc: ModelCommand = { type: "saveDocument", title: "Concurrent input", text: "Do not duplicate", url: "", elementIds: [] };
  it("archives >5M legacy history, rereads after restart, enforces CAS across hypotheses and owner isolation", async () => {
    const before = await seed("owner");
    expect(JSON.stringify(before).length).toBeGreaterThan(5_000_000);
    expect(activeModelSize(before)).toBeLessThan(5_000_000);
    const results = await Promise.allSettled([
      repo.update("owner", 0, doc, "new-country"),
      repo.update("owner", 0, doc, "original"),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.status).toBe(409);
    const restarted = new PgModelRepository(async () => pool);
    const current = await restarted.read("owner", "new-country");
    expect(current.decisions.filter(d => d.id.startsWith("LEGACY"))).toEqual(before.alternatives![0].model.decisions.filter(d => d.id.startsWith("LEGACY")));
    expect((await restarted.read("owner", "untouched")).elements).toEqual(before.alternatives![1].model.elements);
    const raw = (await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", ["owner"])).rows[0].state;
    expect(JSON.stringify(raw).length).toBeLessThan(300_000);
    const old = await restarted.readRevision("owner", 0, "new-country");
    expect(old.documents).toEqual(before.alternatives![0].model.documents);
    expect(old.revision).toBe(0);
    await expect(restarted.update("owner", old.revision, doc, "new-country")).rejects.toMatchObject({ status: 409 });
    await expect(restarted.readRevision("other", 0, "new-country")).rejects.toMatchObject({ status: 404 });
    await expect(restarted.readRevision("owner", 9999)).rejects.toMatchObject({ status: 404 });
    expect((await restarted.read("other")).revision).toBe(0);
  }, 30000);
  it("rolls back chunks, checkpoint and current row when failure happens AFTER archival", async () => {
    const before = await seed("rollback");
    const realConnect = pool.connect.bind(pool);
    const wrapped = { query: pool.query.bind(pool), connect: async () => {
      const client = await realConnect();
      return { query: async (sql: string, args?: any[]) => {
        if (sql.startsWith("UPDATE talkhint_project_models")) throw new Error("Injected write failure after archive");
        return client.query(sql, args);
      }, release: () => client.release() } as unknown as PoolClient;
    } } as unknown as Pool;
    const failing = new PgModelRepository(async () => wrapped);
    await expect(failing.update("rollback", 0, doc, "new-country")).rejects.toThrow("Injected");
    expect((await pool.query("SELECT count(*)::int n FROM talkhint_project_model_history WHERE owner_key=$1", ["rollback"])).rows[0].n).toBe(0);
    expect(await repo.read("rollback")).toEqual({ ...before, hypothesisContext: (await repo.read("rollback")).hypothesisContext });
    await expect(repo.updateMany("rollback", 0, [doc, { type: "reviewElement", id: "MISSING", reason: "Invalid second command" }], "new-country")).rejects.toMatchObject({ status: 404 });
    expect((await repo.read("rollback")).revision).toBe(0);
  }, 30000);
  it("preserves receipts after 100 passports and an information → result → acceptance cycle", async () => {
    const root = initialModel(), owner = "crew";
    root.alternatives = [{ id: "new-country", title: "Crew", model: applyCommand(initialModel(), {
      type: "saveOperatingModel", baseVersion: 0, data: buildCompanyStructure(defaultOperatingModel()),
    }, owner) }];
    await repo.read(owner);
    await pool.query("UPDATE talkhint_project_models SET state=$2::jsonb WHERE owner_key=$1", [owner, JSON.stringify(root)]);
    const service = new ProductCrewService(repo);
    const team = await service.call(owner, "get_team", {});
    const roleId = team.roles[0].id;
    const processId = root.alternatives[0].model.operatingModel!.revisions[0].data.nodes.find(n => n.kind === "process")!.id;
    const first = { requestId: randomUUID(), revision: 0, roleId, processId, client: "Owner", need: "Evidence",
      actions: "Check source", inputs: "Public page", output: "Report", acceptance: "Source dated",
      resources: "No API connected", permissions: "Read only", handoff: "Owner", unknown: "Demand unproven", nextStep: "Clarify" };
    let revision = 0;
    for (let i = 0; i < 105; i++) {
      const result = await service.call(owner, "update_role_passport", { ...first,
        requestId: i ? randomUUID() : first.requestId, revision, actions: `Check source ${i}` });
      revision = result.revision;
    }
    // Reuse the ORIGINAL identity and content after archival and a fresh repository.
    const fresh = new ProductCrewService(new PgModelRepository(async () => pool));
    const replay = await fresh.call(owner, "update_role_passport", { ...first, actions: "Check source 0" });
    expect(replay.replayed).toBe(true);
    expect(replay.revision).toBe(revision);
    await expect(fresh.call(owner, "update_role_passport", first)).rejects.toMatchObject({ status: 409 });
    const common = { title: "Customer need", description: "Unverified statement", client: "Owner", need: "Understand",
      roleId, processId, relatedIds: [], nextStep: "Review" };
    const info = await fresh.call(owner, "record_information", { ...common, revision, requestId: randomUUID(),
      source: "Owner", sourceDate: "2026-10-25", evidence: "Personal report", classification: "user_report" });
    const work = await fresh.call(owner, "create_work", { ...common, revision: info.revision, requestId: randomUUID(),
      expectedResult: "Source report", acceptance: "Distinguish gaps" });
    const result = await fresh.call(owner, "submit_result", { revision: work.revision, requestId: randomUUID(),
      recordId: work.record.id, title: "Report", text: "Evidence gap, not validated demand", nextStep: "Owner review" });
    const accepted = await fresh.call(owner, "review_result", { revision: result.revision, requestId: randomUUID(),
      recordId: work.record.id, verdict: "accepted", reason: "Gap stated", nextStep: "Plan research" });
    const reread = await fresh.call(owner, "get_work", { recordId: work.record.id });
    expect(reread.record.coordination.state).toBe("accepted");
    expect(reread.result.text).toContain("not validated");
    expect(accepted.launched).toBe(false);
    expect((await repo.read(owner, "new-country")).elements.find(e => e.id === replay.record.id)!.coordination!.operations).toHaveLength(105);
  }, 120000);
  it("can materialize inline state for a code rollback without losing archives or changing CAS", async () => {
    await seed("downgrade");
    const saved = await repo.update("downgrade", 0, doc, "new-country");
    const count = async () => (await pool.query("SELECT count(*)::int n FROM talkhint_project_model_history WHERE owner_key=$1", ["downgrade"])).rows[0].n;
    const priorCount = await count();
    const client = await pool.connect();
    let full: ProjectModelState;
    try {
      await client.query("BEGIN");
      const row = (await client.query("SELECT state,revision FROM talkhint_project_models WHERE owner_key=$1 FOR UPDATE", ["downgrade"])).rows[0];
      full = await unpackModel(client, "downgrade", row.state);
      expect(full.revision).toBe(saved.revision);
      await client.query("UPDATE talkhint_project_models SET state=$2::jsonb WHERE owner_key=$1 AND revision=$3", ["downgrade", JSON.stringify(full), saved.revision]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
    const inline = (await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", ["downgrade"])).rows[0].state;
    expect(inline).toEqual(full!);
    expect(JSON.stringify(inline)).not.toContain("__modelHistoryV1");
    expect(await count()).toBe(priorCount);
    expect((await repo.readRevision("downgrade", 0, "new-country")).revision).toBe(0);
    // Re-enabling the new repository must be lossless too.
    await repo.update("downgrade", saved.revision, doc, "new-country");
    expect((await repo.read("downgrade", "new-country")).decisions.filter(d => d.id.startsWith("LEGACY"))).toHaveLength(110);
  }, 30000);
  it("refuses an incomplete archive rather than reading or overwriting partial history", async () => {
    await seed("damaged");
    await repo.update("damaged", 0, doc, "new-country");
    const raw = (await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", ["damaged"])).rows[0].state;
    // Corrupt only this synthetic test owner's chunk.
    await pool.query("UPDATE talkhint_project_model_history SET payload=$2::jsonb WHERE owner_key=$1 AND key LIKE 'h:%'", ["damaged", '{"previous":null,"items":[]}']);
    await expect(repo.read("damaged", "new-country")).rejects.toMatchObject({ status: 503 });
    await expect(repo.update("damaged", 1, doc, "new-country")).rejects.toMatchObject({ status: 503 });
    expect((await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", ["damaged"])).rows[0].state).toEqual(raw);
  }, 30000);
});
