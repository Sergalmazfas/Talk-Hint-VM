/** Dev-only, retained B2 load workspace. Accepted B and legacy are read-only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { unpackModel } from "../../server/projectModel/history";
import { activeModelSize } from "../../server/projectModel/sizeBudget";
import { inspectSchema, businessTables } from "../../server/companyData/relational";
import { child, semanticHash } from "../../server/companyData/valueTree";
import { at, encode, type Frame } from "../../server/companyData/v3/codec";
import { ddlV3, payloadTables } from "../../server/companyData/v3/schema";
import { SqlFrameStore } from "../../server/companyData/v3/store";
import { prepareBusinessContract } from "../../server/companyData/v3/businessContract";

assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev database only");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const db = await pool.connect();
const out = "generated-artifacts/data-platform-B2";
await mkdir(out, { recursive: true });
const suffix = randomUUID(), workspace = `company-b2-load-${suffix}`, owner = `b2-retained-load:${suffix}`;
const label = "B2 — final mixed-command fix; retained full-size load test; NOT shadow B";
try {
  const source = await db.query(`SELECT w.workspace_id,w.owner_key,w.current_revision,m.state,m.revision
    FROM company_workspaces w JOIN talkhint_project_models m ON m.owner_key=w.owner_key
    WHERE w.storage_generation='shadow' AND w.environment='development'`);
  assert.equal(source.rows.length, 1, "One accepted B shadow source required");
  const b = source.rows[0];
  assert.equal(Number(b.current_revision), Number(b.revision), "Legacy changed since accepted B; do not substitute");
  const root = await unpackModel(db, b.owner_key, b.state);
  const digest = semanticHash(root);
  assert.equal(digest, "f1c11386e2dd5808baf88d7e0bfb679817992a76812bdcf43b0bba703b9069c8");
  console.log("B2 source pinned", { revision: root.revision, digest, workspace });
  const schema = await inspectSchema(db);
  await writeFile(`${out}/schema-v3.sql`, ddlV3());
  await db.query("BEGIN");
  await db.query(ddlV3());
  await prepareBusinessContract(db);
  await db.query(`INSERT INTO company_v3_workspaces(workspace_id,owner_key,environment,label,generation,current_revision,root_hash)
    VALUES($1,$2,'development',$4,'test',$3,'pending')`,
    [workspace, owner, root.revision, label]);
  const store = new SqlFrameStore(db, workspace, schema), columns = new Map<string, Frame>();
  const importStats: Record<string, unknown> = {};
  for (const table of payloadTables) {
    const keys = new Map<string, string>();
    await db.query(`DECLARE b2_payload_source NO SCROLL CURSOR FOR SELECT * FROM ${table} WHERE workspace_id=$1`, [b.workspace_id]);
    let count = 0;
    while (true) {
      const result = await db.query("FETCH 4096 FROM b2_payload_source");
      if (!result.rows.length) break;
      for (const row of result.rows) {
        const hash = await store.payload(table, row);
        keys.set(JSON.stringify(schema[table].keys.map(k => String(row[k]))), hash);
        count++;
      }
    }
    await db.query("CLOSE b2_payload_source");
    await db.query(`DECLARE b2_locations_source NO SCROLL CURSOR FOR SELECT source_pointer,key_values,source_fields,target_columns
      FROM company_record_locations WHERE workspace_id=$1 AND revision=$2 AND target_table=$3`,
    [b.workspace_id, root.revision, table]);
    while (true) {
      const result = await db.query("FETCH 4096 FROM b2_locations_source");
      if (!result.rows.length) break;
      for (const row of result.rows) {
        const record = keys.get(JSON.stringify(row.key_values));
        assert(record, `Missing B source record ${table}`);
        row.source_fields.forEach((field: string, i: number) => {
          const path = field === "$value" ? row.source_pointer : child(row.source_pointer, field);
          columns.set(path, { kind: "column", table, record, column: row.target_columns[i] });
        });
      }
    }
    await db.query("CLOSE b2_locations_source");
    await store.flush();
    importStats[table] = { sourceRows: count, uniqueRows: Object.values(store.stats).reduce((n, s) => n + s.inserted, 0) };
    store.records.clear();
    console.log("B2 typed source", table, count);
  }
  console.log("B2 building structural contracts", { mappedFields: columns.size });
  const rootHash = await encode(root, store, columns);
  columns.clear();
  await store.flush();
  await db.query(`INSERT INTO company_v3_revision_heads(workspace_id,revision,root_hash,actor,source_semantic_hash)
    VALUES($1,$2,$3,'B2 retained test import',$4)`, [workspace, root.revision, rootHash, digest]);
  const hypotheses = [{ id: "original", model: root, prefix: [] as string[] },
    ...(root.alternatives ?? []).map((a, i) => ({ ...a, prefix: ["alternatives", String(i), "model"] }))];
  for (const h of hypotheses) for (let i = 0; i < h.model.documents.length; i++) {
    const hash = await at(rootHash, [...h.prefix, "documents", String(i)], store);
    await db.query(`INSERT INTO company_v3_document_heads(workspace_id,hypothesis_id,document_id,valid_from,frame_hash)
      VALUES($1,$2,$3,$4,$5)`, [workspace, h.id, h.model.documents[i].id, root.revision, hash]);
  }
  await db.query("UPDATE company_v3_workspaces SET root_hash=$2 WHERE workspace_id=$1", [workspace, rootHash]);
  await db.query("COMMIT");
  const manifest = { workspace, testOwner: owner, label,
    retainedUntilOwnerReview: true, autoCleanup: false, sourceRevision: root.revision, sourceHash: digest,
    rootHash, activeSize: activeModelSize(root), sourceBUnchanged: true,
    importStats, writes: store.stats, productionTouched: false, activeSourceChanged: false };
  await writeFile(`${out}/RETAINED_WORKSPACE.json`, JSON.stringify(manifest, null, 2));
  console.log("B2 retained import committed", { workspace, rootHash, revision: root.revision });
} catch (e) {
  await db.query("ROLLBACK"); console.error(e); process.exitCode = 1;
} finally { db.release(); await pool.end(); }
