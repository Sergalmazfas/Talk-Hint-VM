/** Integration tests create only uniquely tagged fixtures, then remove those exact fixtures. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { initialModel } from "../../server/projectModel/seed";
import { CompanyModelRepository } from "../../server/companyData/repository";
import { PgModelRepository } from "../../server/projectModel/repository";
import { inspectSchema, project, insertProjection, businessTables, readRootFromSql } from "../../server/companyData/relational";
import { semanticHash } from "../../server/companyData/valueTree";
import { ProductCrewService } from "../../server/productCrew/service";

assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const owner = `company-b-fixture:${randomUUID()}`, workspace = `company-b-fixture:${randomUUID()}`;
const result: Record<string, any> = {};
const repo = new CompanyModelRepository(async () => pool, "development");
const model = initialModel();
const doc = { id: "DOC-COMPANY-B-FIXTURE", title: "Тест", text: "😀 e\u0301\nzero ≠ unknown",
  url: "", updatedAt: "2026-10-28T00:00:00.000Z", elementIds: [] };
model.alternatives = [{ id: "new-country", title: "Fixture", model: {
  schema: 1, revision: 0, elements: [], relations: [], documents: [doc], decisions: [], proposals: [], taskDrafts: [],
  operatingModel: { schema: 1, revisions: [{ version: 1, at: "2026-10-28T00:00:00.000Z", actor: "fixture",
    data: { nodes: [], links: [], customerPath: [], stageReports: [] } }] } as any,
} }];
const db = await pool.connect();
try {
  await db.query("BEGIN"); await db.query("SET CONSTRAINTS ALL DEFERRED");
  await db.query("INSERT INTO talkhint_project_models(owner_key,revision,state) VALUES($1,0,$2::jsonb)", [owner, JSON.stringify(model)]);
  await db.query(`INSERT INTO company_workspaces(workspace_id,owner_key,environment,current_revision,storage_generation)
    VALUES($1,$2,'development',0,'normalized')`, [workspace, owner]);
  const schema = await inspectSchema(db), p = project(model, workspace, schema);
  await insertProjection(db, p, schema, { verifyAndRelease: true });
  await db.query("COMMIT");
  assert.deepEqual(await repo.readDocument(owner, "new-country", doc.id), doc);
  result.directDocumentDigestAndUtf16 = "passed";
  const service = new ProductCrewService(repo);
  const exported = await service.call(owner, "get_document", { documentId: doc.id });
  assert.equal(exported.text, doc.text);
  result.existingMcpGetDocument = "passed";
  await assert.rejects(repo.read(`${owner}-other`));
  await assert.rejects(new CompanyModelRepository(async () => pool, "production").read(owner));
  assert.throws(() => new CompanyModelRepository(async () => pool, "production", true));
  result.ownerAndEnvironmentIsolation = "passed";
  const command = { type: "saveDocument" as const, id: doc.id, title: doc.title,
    url: doc.url, text: "changed 😀", elementIds: [] as string[] };
  const saved = await repo.update(owner, 0, command, "new-country");
  assert.equal(saved.revision, 1);
  assert.equal((await repo.readDocument(owner, "new-country", doc.id)).text, "changed 😀");
  assert.equal((await repo.readRevision(owner, 0, "new-country")).documents[0].text, doc.text);
  const legacy = (await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner])).rows[0].state;
  assert.equal(semanticHash(legacy), semanticHash(model));
  result.normalizedWriteOldRevisionAndLegacyArchiveUnchanged = "passed";
  const settled = await Promise.allSettled([
    repo.update(owner, 1, { ...command, text: "A" }, "new-country"),
    repo.update(owner, 1, { ...command, text: "B" }, "new-country"),
  ]);
  assert.equal(settled.filter(r => r.status === "fulfilled").length, 1);
  const rejected = settled.find(r => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.status, 409);
  result.concurrentCasOneWinner = "passed";
  const current = await repo.read(owner, "new-country");
  await assert.rejects(repo.updateMany(owner, current.revision,
    [{ ...command, text: "must roll back" }, { ...command, id: "missing-document" }], "new-country"));
  assert.equal(semanticHash(await repo.read(owner, "new-country")), semanticHash(current));
  result.atomicMultiCommandFailure = "passed";
  await pool.query("UPDATE company_workspaces SET storage_generation='shadow' WHERE workspace_id=$1", [workspace]);
  await assert.rejects(repo.read(owner));
  const shadow = new CompanyModelRepository(async () => pool, "development", true);
  assert.equal((await shadow.read(owner, "new-country")).revision, current.revision);
  await assert.rejects(shadow.update(owner, current.revision, command, "new-country"));
  result.shadowReadOnlyAndNotAutoActivated = "passed";
  await db.query("BEGIN"); await db.query("SAVEPOINT interrupted");
  await db.query("UPDATE company_workspaces SET current_revision=999 WHERE workspace_id=$1", [workspace]);
  await db.query("ROLLBACK TO SAVEPOINT interrupted");
  assert.equal((await db.query("SELECT current_revision FROM company_workspaces WHERE workspace_id=$1", [workspace])).rows[0].current_revision,
    current.revision);
  await db.query("ROLLBACK");
  result.interruptedWriteRollback = "passed";
  await db.query("BEGIN");
  await db.query("SELECT owner_key FROM talkhint_project_models WHERE owner_key=$1 FOR UPDATE", [owner]);
  let signal!: () => void;
  const waiting = new Promise<void>(resolve => { signal = resolve; });
  const facade = { query: pool.query.bind(pool), connect: async () => {
    const c = await pool.connect();
    return { query: (sql: string, args?: any[]) => {
      if (sql.includes("SELECT state,revision") && sql.includes("FOR UPDATE")) signal();
      return c.query(sql, args);
    }, release: () => c.release() };
  } } as unknown as Pool;
  const oldWriter = new PgModelRepository(async () => facade);
  const blocked = oldWriter.update(owner, 0, { ...command, text: "stale legacy write" }, "new-country");
  await waiting;
  await db.query("UPDATE company_workspaces SET storage_generation='normalized' WHERE workspace_id=$1", [workspace]);
  await db.query("COMMIT");
  await assert.rejects(blocked, (e: any) => e.status === 409);
  assert.equal(semanticHash((await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner])).rows[0].state),
    semanticHash(model));
  result.inFlightLegacyWriteRejectedAfterCutover = "passed";
} finally {
  await db.query("ROLLBACK");
  await db.query("BEGIN"); await db.query("SET CONSTRAINTS ALL DEFERRED");
  for (const t of ["company_import_checks", "company_import_runs", "company_source_archives", ...[...businessTables].reverse()])
    await db.query(`DELETE FROM ${t} WHERE workspace_id=$1`, [workspace]);
  await db.query("DELETE FROM company_workspaces WHERE workspace_id=$1 AND owner_key=$2", [workspace, owner]);
  await db.query("DELETE FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  await db.query("COMMIT"); db.release(); await pool.end();
}
result.fixtureCleanup = "passed";
await mkdir("generated-artifacts/data-platform-B", { recursive: true });
await writeFile("generated-artifacts/data-platform-B/INTEGRATION_TESTS.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
