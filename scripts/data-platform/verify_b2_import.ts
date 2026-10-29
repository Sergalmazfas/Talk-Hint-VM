import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { IncrementalCompanyRepository } from "../../server/companyData/v3/repository";
import { semanticHash, textHash } from "../../server/companyData/valueTree";
import { unpackModel } from "../../server/projectModel/history";

assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
const out = "generated-artifacts/data-platform-B2";
const manifest = JSON.parse(await readFile(`${out}/RETAINED_WORKSPACE.json`, "utf8"));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  const repo = new IncrementalCompanyRepository(pool, "development", true);
  const start = performance.now(), root = await repo.readRoot(manifest.testOwner);
  const hash = semanticHash(root);
  assert.equal(hash, manifest.sourceHash);
  const source = await pool.query(`SELECT m.owner_key,m.state FROM company_workspaces w
    JOIN talkhint_project_models m ON m.owner_key=w.owner_key
    WHERE w.storage_generation='shadow' AND w.environment='development'`);
  const client = await pool.connect();
  let old: any;
  try { old = await unpackModel(client, source.rows[0].owner_key, source.rows[0].state); }
  finally { client.release(); }
  const docs = [];
  for (const h of [{ id: "original", model: old }, ...old.alternatives]) {
    for (const d of h.model.documents) {
      const s = performance.now(), result = await repo.readDocumentSnapshot(manifest.testOwner, h.id, d.id);
      assert.deepEqual(result.document, d);
      docs.push({ hypothesis: h.id, id: d.id, sha256: textHash(d.text), utf16: d.text.length,
        directReadMs: performance.now() - s });
    }
  }
  const result = { passed: true, sourceHash: hash, fullReadAndHashMs: performance.now() - start,
    documentCount: docs.length, documents: docs, sourceBUnchanged: true };
  await writeFile(`${out}/INITIAL_READBACK.json`, JSON.stringify(result, null, 2));
  console.log("B2 initial roundtrip and documents PASSED", { hash, docs: docs.length });
} finally { await pool.end(); }
