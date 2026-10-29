/** READ ONLY: frozen B, no import, DDL, model writes, calls, mail or activation. */
import assert from "node:assert/strict";
import { Pool } from "pg";
import { readFile, writeFile } from "node:fs/promises";
import { inspectSchema, readRootFromSql } from "../../server/companyData/relational";
import { semanticHash } from "../../server/companyData/valueTree";
import { reviewedImportApproval, reviewedAccountBinding } from "../../server/companyData/v3/importApproval";
import { reviewedPackage } from "../../server/companyData/v3/reviewedPackage";
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
assert.equal(reviewedImportApproval, null, "No import approval allowed");
const pin = reviewedPackage!;
const pool = new Pool({connectionString: process.env.DATABASE_URL, max: 1});
const db = await pool.connect();
try {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const w = (await db.query(`SELECT workspace_id,current_revision,storage_generation
    FROM company_workspaces WHERE workspace_id=$1`, [reviewedAccountBinding.sourceBWorkspace])).rows[0];
  assert.equal(Number(w.current_revision), 912);
  assert.equal(w.storage_generation, "shadow");
  const root = await readRootFromSql(db, w.workspace_id, w.current_revision, await inspectSchema(db));
  const digest = semanticHash(root);
  assert.equal(digest, pin.manifest.semanticHash);
  await db.query("COMMIT");
  const report = {
    status: "PASS_READ_ONLY_NOT_IMPORT", checkedAt: new Date().toISOString(),
    workspace: w.workspace_id, revision: Number(w.current_revision), semanticHash: digest,
    matchesSealedPackage: true, reviewedImportApproval: null, writes: 0,
    process: {nodeHeapLimitMiB: 2048, kernelDataHardLimitMiB: 3072,
      peakRssKiB: Number(/VmHWM:\s+(\d+)/.exec(await readFile("/proc/self/status", "utf8"))?.[1]),
      note: "Dev readonly SQL reconstruction, not production import or active-Hint load test"},
  };
  await writeFile("generated-artifacts/publish2-capacity/FROZEN_SOURCE.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally { db.release(); await pool.end(); }
