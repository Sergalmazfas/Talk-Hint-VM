/** Dev-only full-size retained copy; no production, provider calls, DDL or deletion. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { CompanyCutover } from "../../server/companyData/cutover/service";
import { cutoverCandidate } from "../../server/companyData/cutover/policy";
import { payloadTables, physicalTable } from "../../server/companyData/v3/schema";

assert.equal(process.env.NODE_ENV, "development");
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
const out = "generated-artifacts/cutover-recovery";
await mkdir(out, { recursive: true });
const source = JSON.parse(await readFile("generated-artifacts/data-platform-publish2/PERF_RETAINED_COPY.json", "utf8"));
const id = randomUUID(), owner = `cutover-recovery:${id}`, workspace = `cutover-recovery-${id}`;
const policy = { ...cutoverCandidate, owner, workspace, environment: "development" as const };
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const service = new CompanyCutover(pool, "development", policy, policy);
const report: any = { productionTouched: false, sourceChanged: false, activated: false,
  retained: true, owner, workspace, sourceWorkspace: source.workspace, steps: [] };
const step = async (name: string, fn: () => Promise<any>) => {
  const start = performance.now(), result = await fn();
  report.steps.push({ name, ms: performance.now() - start, result });
  await writeFile(`${out}/REHEARSAL.json`, JSON.stringify(report, null, 2));
  console.log(name, Math.round(performance.now() - start)); return result;
};
try {
  await step("clone_separate_full_size_copy", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const src = (await db.query("SELECT * FROM company_v3_workspaces WHERE workspace_id=$1", [source.workspace])).rows[0];
      assert.equal(Number(src.current_revision), 912); assert.equal(src.root_hash, policy.rootHash);
      await db.query(`INSERT INTO company_v3_workspaces
        (workspace_id,owner_key,environment,label,generation,current_revision,root_hash)
        VALUES($1,$2,'development','CUTOVER RECOVERY REHEARSAL — RETAIN FOR OWNER','shadow',912,$3)`,
      [workspace, owner, policy.rootHash]);
      const tables = ["company_v3_text_snapshots", ...payloadTables.map(physicalTable),
        "company_v3_payload_text_refs", "company_v3_frames", "company_v3_revision_heads",
        "company_v3_document_heads", "company_v3_archive_refs", "company_v3_size_budgets"];
      let count = 0;
      for (const table of tables) {
        const columns = (await db.query(`SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table])).rows.map(r => r.column_name);
        assert(columns.every((c: string) => /^[a-z0-9_]+$/.test(c)));
        const boundary = table === "company_v3_revision_heads" ? " AND revision<=912" :
          table === "company_v3_document_heads" ? " AND valid_from<=912" : "";
        count += (await db.query(`INSERT INTO ${table} (${columns.map((c: string) => `"${c}"`).join(",")})
          SELECT ${columns.map((c: string) => c === "workspace_id" ? "$1::text" : `"${c}"`).join(",")}
          FROM ${table} WHERE workspace_id=$2${boundary}`, [workspace, source.workspace])).rowCount ?? 0;
      }
      await db.query("COMMIT"); return { rows: count };
    } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  });
  const pin = (await service.status(owner)).source;
  let oldGrant = "", oldOperation = "", oldRow: any;
  await step("durable_injected_failure_and_no_blind_retry", async () => {
    oldGrant = await service.grant(owner, "activate", pin);
    oldOperation = await service.enqueue(owner, "activate", pin, oldGrant);
    await service.fail(oldOperation, new Error("CUTOVER_TEST_INJECTED_FAILURE"));
    oldRow = (await pool.query("SELECT * FROM company_cutover_operations WHERE operation_id=$1", [oldOperation])).rows[0];
    assert.equal(oldRow.state, "failed"); assert(oldRow.result.diagnostics.length);
    await assert.rejects(() => service.grant(owner, "activate", pin));
    await assert.rejects(() => service.enqueue(owner, "activate", pin, oldGrant));
    return { state: oldRow.state, primaryCode: oldRow.result.diagnostics[0].exceptionCode };
  });
  await step("worker_lease_blocks_reconciliation", async () => {
    const grant = await service.grant(owner, "reconcile", pin);
    const operation = await service.enqueue(owner, "reconcile", pin, grant);
    const db = await pool.connect();
    const key = `company-cutover-worker:development:${owner}`;
    try {
      await db.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [key]);
      await assert.rejects(() => service.perform(owner, operation), /WORKER_LEASE_BUSY/);
    } finally { await db.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [key]); db.release(); }
    await service.fail(operation, new Error("CUTOVER_WORKER_LEASE_BUSY"));
    return { refusedLiveLease: true };
  });
  await step("reconcile_full_sha_documents_without_activation", async () => {
    const grant = await service.grant(owner, "reconcile", pin);
    const operation = await service.enqueue(owner, "reconcile", pin, grant);
    const result = await service.perform(owner, operation);
    assert.equal(result.documents, 84); assert.equal(result.sourceUnchanged, true);
    const state = await service.status(owner);
    assert.equal(state.phase, "shadow"); assert.equal(state.writesOpen, false); assert.deepEqual(state.source, pin);
    const unchanged = (await pool.query("SELECT * FROM company_cutover_operations WHERE operation_id=$1", [oldOperation])).rows[0];
    assert.deepEqual(unchanged, oldRow);
    return { ...result, originalFailedRowUnchanged: true };
  });
  await step("fresh_activation_grant_only_on_new_explicit_call", async () => {
    const grant = await service.grant(owner, "activate", pin);
    assert.notEqual(grant, oldGrant);
    await assert.rejects(() => service.enqueue(owner, "activate", pin, oldGrant));
    const state = await service.status(owner);
    assert.equal(state.phase, "shadow"); assert.equal(state.writesOpen, false);
    assert.equal((await pool.query(`SELECT 1 FROM company_cutover_operations
      WHERE owner_key=$1 AND state IN ('queued','running')`, [owner])).rowCount, 0);
    return { newGrantCreatedOnExplicitCall: true, activationNotExecuted: true, oldGrantRefused: true };
  });
  report.passed = true;
  await writeFile(`${out}/REHEARSAL.json`, JSON.stringify(report, null, 2));
} finally { await pool.end(); }
