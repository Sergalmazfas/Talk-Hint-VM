/** Dev-only fixed retained snapshot, no production/import service/DDL/DELETE.
 * Fixed copy persists for owner inspection; trial writes are SAVEPOINT ROLLBACK.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { IncrementalCompanyRepository } from "../../server/companyData/v3/repository";
import { CommandCompanyRepository } from "../../server/companyData/v3/commands";
import { payloadTables, physicalTable } from "../../server/companyData/v3/schema";
import { semanticHash } from "../../server/companyData/valueTree";
import type { ModelCommand } from "../../shared/projectModel";

assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
const out = "generated-artifacts/data-platform-publish2";
const realPool = new Pool({connectionString: process.env.DATABASE_URL, max: 1}), db = await realPool.connect();
const original = JSON.parse(await readFile("generated-artifacts/data-platform-B2/RETAINED_WORKSPACE.json", "utf8"));
const reuse = process.argv.find(a => a.startsWith("--reuse="))?.slice(8);
if (reuse) assert(/^company-publish2-fixed-[a-f0-9-]{36}$/.test(reuse));
const suffix = reuse?.slice("company-publish2-fixed-".length) ?? randomUUID();
const workspace = `company-publish2-fixed-${suffix}`, owner = `perf-fixed:${suffix}`;
const tables = ["company_v3_text_snapshots", ...payloadTables.map(physicalTable),
  "company_v3_payload_text_refs", "company_v3_frames", "company_v3_revision_heads",
  "company_v3_document_heads", "company_v3_archive_refs", "company_v3_size_budgets"];
let depth = 0, measured = false;
let sqlStats: Record<string, {calls: number; ms: number; rows: number}> = {};
const query = async (sql: string, params?: any[]) => {
  const start = performance.now();
  let r;
  if (/^BEGIN\b/.test(sql)) r = await db.query(`SAVEPOINT perf_nested_${++depth}`);
  else if (sql === "COMMIT") r = await db.query(`RELEASE SAVEPOINT perf_nested_${depth--}`);
  else if (sql === "ROLLBACK") {
    await db.query(`ROLLBACK TO SAVEPOINT perf_nested_${depth}`);
    r = await db.query(`RELEASE SAVEPOINT perf_nested_${depth--}`);
  } else r = await db.query(sql, params);
  if (measured) {
    const key = sql.startsWith("SELECT") ? `SELECT:${/FROM\s+([a-z0-9_]+)/i.exec(sql)?.[1] ?? "other"}` :
      `${sql.split(/\s/)[0]}:${/(?:INTO|UPDATE)\s+([a-z0-9_]+)/i.exec(sql)?.[1] ?? "transaction"}`;
    const s = sqlStats[key] ??= {calls: 0, ms: 0, rows: 0};
    s.calls++; s.ms += performance.now() - start; s.rows += r.rowCount ?? 0;
  }
  return r;
};
const pool = {query, connect: async () => ({query, release() {}})} as unknown as Pool;
try {
  const source = await db.query("SELECT current_revision,root_hash FROM company_v3_workspaces WHERE workspace_id=$1", [original.workspace]);
  const base = await db.query("SELECT root_hash FROM company_v3_revision_heads WHERE workspace_id=$1 AND revision=912", [original.workspace]);
  assert.equal(base.rowCount, 1);
  await db.query("BEGIN");
  let rowsCopied = 0;
  try {
    if (!reuse) await db.query(`INSERT INTO company_v3_workspaces
      (workspace_id,owner_key,environment,label,generation,current_revision,root_hash)
      VALUES($1,$2,'development','FIXED Publish2 performance snapshot; retain until owner review; NOT import source','test',912,$3)`,
    [workspace, owner, base.rows[0].root_hash]);
    for (const table of reuse ? [] : tables) {
      const c = await db.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
      const names = c.rows.map(r => String(r.column_name));
      assert(names.every(n => /^[a-z0-9_]+$/.test(n)));
      const cols = names.map(n => `"${n}"`).join(",");
      const select = names.map(n => n === "workspace_id" ? "$1::text" : `"${n}"`).join(",");
      const r = await db.query(`INSERT INTO ${table} (${cols}) SELECT ${select} FROM ${table} WHERE workspace_id=$2`,
        [workspace, original.workspace]);
      rowsCopied += r.rowCount ?? 0;
    }
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  // Repository's read-only transactions are nested SAVEPOINTs on this facade.
  // The fixed copy is already committed; all remaining trial writes roll back.
  await db.query("BEGIN");
  const data = new IncrementalCompanyRepository(pool, "development", true), commands = new CommandCompanyRepository(data);
  // API view adds hypothesisContext; it is not part of stored semantic root.
  const {hypothesisContext: _viewContext, ...fullBase} = await data.read(owner);
  assert.equal(semanticHash(fullBase), original.sourceHash, "Fixed logical base equals genuine B");
  let fixedRows = 0;
  for (const table of tables) fixedRows += Number((await db.query(
    `SELECT count(*) AS n FROM ${table} WHERE workspace_id=$1`, [workspace])).rows[0].n);
  await writeFile(`${out}/PERF_RETAINED_COPY.json`, JSON.stringify({
    workspace, owner, label: "FIXED Publish2 performance snapshot; NOT import source",
    revision: 912, rootHash: base.rows[0].root_hash, semanticHash: semanticHash(fullBase),
    rowsCopiedThisInvocation: rowsCopied, fixedRows, persisted: true, autoCleanup: false, retainedUntilOwnerReview: true,
    sourceBModified: false, bothB2CopiesUnchanged: true, productionTouched: false,
  }, null, 2));
  const results: any[] = [];
  // Use the copy's frozen final B2 head for repeated trials. Its historical
  // 913..932 heads are deliberately retained, so writing from 912 would collide
  // with an already-existing history PK. Never delete those heads to benchmark.
  for (const revision of [Number(source.rows[0].current_revision)]) {
    const head = await db.query("SELECT root_hash FROM company_v3_revision_heads WHERE workspace_id=$1 AND revision=$2",
      [workspace, revision]);
    assert.equal(head.rowCount, 1);
    for (const kind of ["valid-json-document", "malformed-document-like-previous-probe", "role"]) for (let trial = 1; trial <= 2; trial++) {
      await db.query("SAVEPOINT identical_trial");
      await db.query("UPDATE company_v3_workspaces SET current_revision=$2,root_hash=$3 WHERE workspace_id=$1",
        [workspace, revision, head.rows[0].root_hash]);
      const state = await commands.read(owner, "new-country");
      let command: ModelCommand;
      if (kind !== "role") {
        const d = state.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
        const body = JSON.parse(d.text);
        body.b2RetainedTest = {step: 1, note: "Fixed comparison; no product change"};
        command = {type: "saveDocument", id: d.id, title: d.title,
          text: kind === "valid-json-document" ? JSON.stringify(body, null, 2) :
            d.text + "\n[UNCOMMITTED response benchmark]",
          url: d.url, elementIds: d.elementIds};
      } else {
        const latest = state.operatingModel!.revisions.at(-1)!;
        const graph = structuredClone(latest.data), role = graph.nodes.find(n => n.kind === "role")!;
        role.description += "\n[Fixed comparison; no product change]";
        command = {type: "saveOperatingModel", baseVersion: latest.version, data: graph};
      }
      sqlStats = {}; measured = true;
      const cpu = process.cpuUsage(), start = performance.now();
      const response = await commands.updateMany(owner, state.revision, [command], "new-country");
      const totalMs = performance.now() - start, usage = process.cpuUsage(cpu);
      measured = false;
      const receipt = commands.lastReceipt!;
      const actual = await data.read(owner, "new-country");
      assert.equal(semanticHash(response), semanticHash(actual), "Complete committed response");
      const row = {revision, kind, trial, totalMs, writerMs: receipt.writerMs,
        responseMs: totalMs - receipt.writerMs, sqlReads: receipt.sqlReads,
        cpuMs: (usage.system + usage.user) / 1000, sqlStats, fullResponseMatches: true,
        verificationMs: receipt.verificationMs};
      results.push(row); console.log("fixed measurement", JSON.stringify(row));
      await db.query("ROLLBACK TO SAVEPOINT identical_trial");
      await db.query("RELEASE SAVEPOINT identical_trial");
    }
  }
  await db.query("ROLLBACK");
  const fixed = await db.query("SELECT current_revision,root_hash FROM company_v3_workspaces WHERE workspace_id=$1", [workspace]);
  assert.equal(Number(fixed.rows[0].current_revision), 912);
  assert.equal(fixed.rows[0].root_hash, base.rows[0].root_hash);
  const end = await db.query("SELECT current_revision,root_hash FROM company_v3_workspaces WHERE workspace_id=$1", [original.workspace]);
  assert.deepEqual(end.rows, source.rows);
  await writeFile(`${out}/WRITER_FIXED_PROBE.json`, JSON.stringify({
    passed: true, fixedWorkspace: workspace, initialRevision: 912, initialLogicalHashEqualsB: true,
    results, fixedCopyUnchangedAfterTrials: true, trialWritesRolledBack: true,
    copiesNotDeleted: true, originalB2Unchanged: true, productionTouched: false,
    note: "Same fixed physical copy and frozen logical head 932 for every trial. Compare valid JSON with malformed appended text from previous probe. Fixed retained copy stays at base 912 after rollback. Warm response cache; independent full readback outside timing. No CPU/SQL cause inferred without timing evidence.",
  }, null, 2));
} catch (error) {
  measured = false; await db.query("ROLLBACK"); throw error;
} finally {db.release(); await realPool.end();}
