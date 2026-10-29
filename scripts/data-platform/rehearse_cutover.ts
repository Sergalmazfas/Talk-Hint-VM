/** Explicit Dev-only rehearsal on a NEW retained copy. No production connection or external transports. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { IncrementalCompanyRepository } from "../../server/companyData/v3/repository";
import { CommandCompanyRepository } from "../../server/companyData/v3/commands";
import { payloadTables, physicalTable } from "../../server/companyData/v3/schema";
import { semanticHash } from "../../server/companyData/valueTree";
import { archiveModel, unpackModel } from "../../server/projectModel/history";
import { PgModelRepository } from "../../server/projectModel/repository";
import { activeCompanyDocument, hasNormalizedCompanySource } from "../../server/companyData/active";
import { ProductCrewService } from "../../server/productCrew/service";

assert.equal(process.env.NODE_ENV, "development", "Explicit Dev process required");
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev database only");
const directory = "generated-artifacts/company-cutover";
await mkdir(directory, { recursive: true });
const accepted = JSON.parse(await readFile("generated-artifacts/data-platform-publish2/MANIFEST.json", "utf8"));
const retained = JSON.parse(await readFile("generated-artifacts/data-platform-publish2/PERF_RETAINED_COPY.json", "utf8"));
const id = randomUUID(), owner = `cutover-rehearsal:${id}`, workspace = `company-cutover-rehearsal-${id}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const tables = ["company_v3_text_snapshots", ...payloadTables.map(physicalTable),
  "company_v3_payload_text_refs", "company_v3_frames", "company_v3_revision_heads",
  "company_v3_document_heads", "company_v3_archive_refs", "company_v3_size_budgets"];
const report: any = { owner, workspace, label: "CUTOVER REHEARSAL ONLY — retain for owner review — NOT source",
  productionTouched: false, runtimeHintTested: false, autoCleanup: false, approved: false,
  sourceWorkspace: retained.workspace,
  sourceOrigin: "Retained fixed v3 r912 copy; full semantic hash checked against accepted fresh-B manifest before any trial",
  importSourceWorkspace: accepted.sourceWorkspace, steps: [], documentMeasurements: [], roleMeasurements: [] };
const stamp = async (name: string, fn: () => Promise<unknown>) => {
  const start = performance.now(); const result = await fn();
  report.steps.push({ name, ms: performance.now() - start, result });
  await writeFile(`${directory}/REHEARSAL.json`, JSON.stringify(report, null, 2));
  console.log(name, Math.round(performance.now() - start), "ms");
  return result;
};
try {
  const source = (await pool.query("SELECT * FROM company_v3_workspaces WHERE workspace_id=$1",
    [retained.workspace])).rows[0];
  assert(source && source.environment === "development" && source.generation === "test");
  assert.equal(Number(source.current_revision), 912);
  const originalRoot = source.root_hash;
  await stamp("clone_retained_verified_912_to_separate_workspace", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(`INSERT INTO company_v3_workspaces
        (workspace_id,owner_key,environment,label,generation,current_revision,root_hash)
        VALUES($1,$2,'development',$3,'test',912,$4)`,
      [workspace, owner, report.label, originalRoot]);
      let rows = 0;
      for (const table of tables) {
        const cols = (await db.query(`SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]))
          .rows.map(r => String(r.column_name));
        assert(cols.length && cols.every(c => /^[a-z0-9_]+$/.test(c)));
        const list = cols.map(c => `"${c}"`).join(",");
        const selection = cols.map(c => c === "workspace_id" ? "$1::text" : `"${c}"`).join(",");
        // This fixed source also retains B2's future trial heads. A new branch at
        // 912 must not copy 913..932 head/index reservations (payloads stay intact).
        const boundary = table === "company_v3_revision_heads" ? " AND revision<=912" :
          table === "company_v3_document_heads" ? " AND valid_from<=912" : "";
        rows += (await db.query(`INSERT INTO ${table} (${list})
          SELECT ${selection} FROM ${table} WHERE workspace_id=$2${boundary}`, [workspace, source.workspace_id])).rowCount ?? 0;
      }
      await db.query("COMMIT"); return { rowsCopied: rows };
    } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  });
  const raw = new IncrementalCompanyRepository(pool, "development", true);
  const command = new CommandCompanyRepository(raw);
  const root = await raw.readRoot(owner);
  assert.equal(semanticHash(root), accepted.semanticHash);
  const hypothesis = root.alternatives!.find(h => h.id === "new-country")!.model;
  const journalId = "DOC-TALKHINT-IMPROVEMENT-JOURNAL";
  const originalDocument = hypothesis.documents.find(d => d.id === journalId)!;
  assert(originalDocument);
  await stamp("baseline_912_hash_documents_archives", async () => {
    const docs = await pool.query(`SELECT hypothesis_id,document_id FROM company_v3_document_heads
      WHERE workspace_id=$1 AND valid_from<=912`, [workspace]);
    const archives = await pool.query("SELECT count(*)::int AS n FROM company_v3_archive_refs WHERE workspace_id=$1", [workspace]);
    assert.equal(docs.rowCount, 84); assert.equal(archives.rows[0].n, 242);
    for (const d of docs.rows) await raw.readDocumentSnapshot(owner, d.hypothesis_id, d.document_id, 912);
    return { revision: root.revision, semanticHash: semanticHash(root), documents: docs.rowCount, archives: 242 };
  });
  await stamp("legacy_snapshot_before_switch", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      // The history table FK requires the isolated owner row BEFORE archiveModel.
      await db.query("INSERT INTO talkhint_project_models(owner_key,revision,state) VALUES($1,912,$2::jsonb)",
        [owner, JSON.stringify(root)]);
      const packed = await archiveModel(db, owner, root);
      await db.query("UPDATE talkhint_project_models SET state=$2::jsonb WHERE owner_key=$1",
        [owner, JSON.stringify(packed)]);
      await db.query("UPDATE company_v3_workspaces SET generation='shadow' WHERE workspace_id=$1", [workspace]);
      await db.query("COMMIT");
    } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
    assert.equal(await hasNormalizedCompanySource(pool, owner), false);
    return { legacyPresent: true, normalizedSelected: false };
  });
  const repository = new PgModelRepository(async () => pool);
  await stamp("activate_copy_and_shared_reader", async () => {
    const changed = await pool.query(`UPDATE company_v3_workspaces SET generation='normalized'
      WHERE workspace_id=$1 AND owner_key=$2 AND generation='shadow' AND current_revision=912
      AND root_hash=$3`, [workspace, owner, originalRoot]);
    assert.equal(changed.rowCount, 1);
    assert.equal(await hasNormalizedCompanySource(pool, owner), true);
    const read = await repository.read(owner, "new-country");
    assert.equal(read.documents.length, hypothesis.documents.length);
    assert.equal(read.documents.length, 50);
    const tool = await new ProductCrewService(repository).call(owner, "get_document", { documentId: journalId });
    assert.equal(tool.text, originalDocument.text);
    const doc = await activeCompanyDocument(pool, owner, "development", journalId);
    assert.equal(doc!.text, originalDocument.text);
    assert.equal(semanticHash(await raw.readRoot(owner)), accepted.semanticHash);
    return { allReadersShareRepository: true, directJournalExact: true, baselineHashExact: true };
  });
  await stamp("test_write_then_compensating_new_revision", async () => {
    let state = await repository.read(owner, "new-country");
    const modified = JSON.stringify({ ...JSON.parse(originalDocument.text), cutoverRehearsal: id });
    const saved = await repository.update(owner, state.revision, { type: "saveDocument",
      id: originalDocument.id, title: originalDocument.title, url: originalDocument.url,
      text: modified, elementIds: originalDocument.elementIds }, "new-country");
    assert.equal((await activeCompanyDocument(pool, owner, "development", journalId))!.text, modified);
    const compensated = await repository.update(owner, saved.revision, { type: "saveDocument",
      id: originalDocument.id, title: originalDocument.title, url: originalDocument.url,
      text: originalDocument.text, elementIds: originalDocument.elementIds }, "new-country");
    assert(compensated.revision > saved.revision);
    assert.equal((await activeCompanyDocument(pool, owner, "development", journalId))!.text, originalDocument.text);
    return { writeRevision: saved.revision, undoRevision: compensated.revision,
      documentRestored: true, originalSemanticHashNoLongerExpected: true };
  });
  for (const kind of ["document", "role"] as const) {
    for (let trial = 1; trial <= 2; trial++) {
      const state = await repository.read(owner, "new-country");
      let request: any;
      if (kind === "document") request = { type: "saveDocument", id: originalDocument.id,
        title: originalDocument.title, url: originalDocument.url,
        text: JSON.stringify({ ...JSON.parse(originalDocument.text), cutoverRehearsalTrial: trial }),
        elementIds: originalDocument.elementIds };
      else {
      const latest = state.operatingModel!.revisions.at(-1)!, data = structuredClone(latest.data);
        data.nodes.find(n => n.kind === "role")!.description += `\nDev cutover trial ${trial}`;
        request = { type: "saveOperatingModel", baseVersion: latest.version, data };
      }
      const start = performance.now();
      await command.updateMany(owner, state.revision, [request], "new-country");
      const elapsed = performance.now() - start;
      report[kind === "document" ? "documentMeasurements" : "roleMeasurements"].push({
        trial, totalMs: elapsed, writerMs: command.lastReceipt!.writerMs,
        verificationMs: command.lastReceipt!.verificationMs });
      await writeFile(`${directory}/REHEARSAL.json`, JSON.stringify(report, null, 2));
    }
  }
  await stamp("rollback_to_json_preserving_all_post_cutover_changes", async () => {
    // Serialize with normalized writer. All work stays on this isolated test owner.
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const locked = (await db.query("SELECT * FROM company_v3_workspaces WHERE workspace_id=$1 FOR UPDATE",
        [workspace])).rows[0];
      const latest = await raw.readRoot(owner);
      assert.equal(latest.revision, Number(locked.current_revision));
      const old = (await db.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1 FOR UPDATE", [owner])).rows[0];
      // Archive prior JSON separately; no DELETE and no overwrite of immutable archive entries.
      await archiveModel(db, owner, await unpackModel(db, owner, old.state));
      const packed = await archiveModel(db, owner, latest);
      await db.query("UPDATE talkhint_project_models SET revision=$2,state=$3::jsonb,updated_at=now() WHERE owner_key=$1",
        [owner, latest.revision, JSON.stringify(packed)]);
      await db.query("UPDATE company_v3_workspaces SET generation='shadow' WHERE workspace_id=$1", [workspace]);
      await db.query("COMMIT");
      const restored = await repository.read(owner, "original");
      const { hypothesisContext: _context, ...restoredRoot } = restored;
      assert.equal(semanticHash(restoredRoot), semanticHash(latest));
      assert.equal(await hasNormalizedCompanySource(pool, owner), false);
      return { latestRevision: latest.revision, latestSemanticHash: semanticHash(latest),
        noPostCutoverEditsLost: true, normalizedHistoryRetained: true,
        productionOwnerLegacyBarrierExercised: false,
        limitation: "Test owner is not the protected production owner. Production needs a reviewed owner-bound legacy checkpoint read gate." };
    } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  });
  const unchanged = (await pool.query("SELECT current_revision,root_hash,generation FROM company_v3_workspaces WHERE workspace_id=$1",
    [source.workspace_id])).rows[0];
  assert.equal(unchanged.root_hash, originalRoot); assert.equal(Number(unchanged.current_revision), 912);
  assert.equal(unchanged.generation, "test");
  report.sourceUnchanged = true;
  report.finished = true;
  report.retainedCopy = { workspace, owner, generation: "shadow" };
} catch (error) {
  report.finished = false;
  report.error = String(error);
  throw error;
} finally {
  report.maxRssKiB = process.resourceUsage().maxRSS;
  await writeFile(`${directory}/REHEARSAL.json`, JSON.stringify(report, null, 2));
  await pool.end();
}
