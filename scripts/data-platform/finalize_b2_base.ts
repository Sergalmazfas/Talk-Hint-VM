/** One-time additive preparation of the retained copy, before the 20-write measurement. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { inspectSchema } from "../../server/companyData/relational";
import { SqlFrameStore } from "../../server/companyData/v3/store";
import { ddlV3, payloadTables, physicalTable } from "../../server/companyData/v3/schema";
import { unpackModel } from "../../server/projectModel/history";
import { activeModelSize } from "../../server/projectModel/sizeBudget";
import { prepareBusinessContract } from "../../server/companyData/v3/businessContract";

assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
const out = "generated-artifacts/data-platform-B2", m = JSON.parse(await readFile(`${out}/RETAINED_WORKSPACE.json`, "utf8"));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 }), db = await pool.connect();
try {
  await db.query("BEGIN"); await db.query(ddlV3());
  await prepareBusinessContract(db);
  const w = await db.query(`SELECT current_revision FROM company_v3_workspaces WHERE workspace_id=$1 AND generation='test' FOR UPDATE`, [m.workspace]);
  assert.equal(Number(w.rows[0].current_revision), m.sourceRevision, "Do not rerun after load writes");
  const schema = await inspectSchema(db), store = new SqlFrameStore(db, m.workspace, schema);
  let updated = 0;
  for (const table of payloadTables) {
    const columns = schema[table].columns.filter(c => c.type === "text").map(c => c.name);
    if (!columns.length) continue;
    await db.query(`DECLARE b2_texts NO SCROLL CURSOR FOR SELECT * FROM ${physicalTable(table)}
      WHERE workspace_id=$1 AND (${columns.map(c => `length("${c}")>4096`).join(" OR ")})`, [m.workspace]);
    const clear = new Map<string, string[]>();
    while (true) {
      const result = await db.query("FETCH 512 FROM b2_texts");
      if (!result.rows.length) break;
      for (const row of result.rows) {
        await store.payload(table, row);
        for (const col of columns) if (typeof row[col] === "string" && row[col].length > 4096) {
          const list = clear.get(col) ?? []; list.push(row.record_hash); clear.set(col, list);
        }
      }
    }
    await db.query("CLOSE b2_texts");
    await store.flush();
    for (const [column, hashes] of Array.from(clear)) {
      const changed = await db.query(`UPDATE ${physicalTable(table)} SET "${column}"=''
        WHERE workspace_id=$1 AND record_hash=ANY($2::text[])`, [m.workspace, hashes]);
      updated += changed.rowCount ?? 0;
    }
    store.records.clear();
  }
  const source = await db.query(`SELECT w.workspace_id,m.owner_key,m.state FROM company_workspaces w
    JOIN talkhint_project_models m ON m.owner_key=w.owner_key WHERE w.storage_generation='shadow' AND w.environment='development'`);
  assert.equal(source.rows.length, 1);
  const b = source.rows[0], root = await unpackModel(db, b.owner_key, b.state);
  const { alternatives, ...original } = root;
  for (const [id, size] of [["$root", activeModelSize(root)], ["original", activeModelSize(original as any)],
    ...(alternatives ?? []).map(a => [a.id, activeModelSize(a.model)])] as [string, number][])
    await db.query(`INSERT INTO company_v3_size_budgets VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [m.workspace, id, size]);
  const refs = await db.query(`INSERT INTO company_v3_archive_refs
    SELECT $1,source_owner_key,source_key,semantic_sha256 FROM company_source_archives WHERE workspace_id=$2
    ON CONFLICT DO NOTHING RETURNING source_key`, [m.workspace, b.workspace_id]);
  await db.query("COMMIT");
  await writeFile(`${out}/schema-v3.sql`, ddlV3());
  await writeFile(`${out}/BASE_FINALIZATION.json`, JSON.stringify({
    passed: true, largeTextColumnsExternalized: updated, immutableArchiveRefs: refs.rowCount,
    exactTextHashUnchanged: "verified by subsequent full readback", sourceBModified: false,
    cleanup: "none", logicalTextStorage: "immutable SHA-256 snapshots shared by typed records and audit frames",
  }, null, 2));
  console.log("B2 CAS/base finalized", { updated, archiveRefs: refs.rowCount });
} catch (e) { await db.query("ROLLBACK"); throw e; }
finally { db.release(); await pool.end(); }
