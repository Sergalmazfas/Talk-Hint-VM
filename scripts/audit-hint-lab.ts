// Manual Dev-only documentation audit. No imports of provider/telephony modules.
import assert from "node:assert/strict";
import { Pool } from "pg";
import { writeFile } from "node:fs/promises";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis } from "../server/projectModel/hypotheses";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { saveRoleAssemblyStandard } from "../server/projectModel/research/roleAssemblyStandard";
import { productBookDocumentId, readProductBook } from "../shared/productBook";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.ok(["helium", "lithium"].includes(new URL(process.env.DATABASE_URL!).hostname), "Dev only");
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rowCount, 1, "Existing unambiguous model required");
  const owner = q.rows[0].owner_key;
  let root = await unpackModel(pool, owner, q.rows[0].state);
  const before = readHypothesis(root, "new-country");
  if (process.argv.includes("--save-standard")) {
    root = await persistModelUpdate(pool, owner, current => {
      assert.equal(readHypothesis(current, "new-country").revision, before.revision, "Concurrent change: re-read");
      return saveRoleAssemblyStandard(current, new Date().toISOString());
    }, true);
  }
  const state = readHypothesis(root, "new-country");
  const doc = state.documents.find(d => d.id === productBookDocumentId)!;
  const book = readProductBook(doc)!;
  await writeFile("/tmp/hint-lab-model.json", JSON.stringify({
    revision: state.revision, capturedAt: new Date().toISOString(),
    data: state.operatingModel!.revisions.at(-1)!.data,
    documents: state.documents.map(d => ({ id: d.id, title: d.title, updatedAt: d.updatedAt, text: d.text, elementIds: d.elementIds })),
  }));
  console.log(JSON.stringify({ saved: process.argv.includes("--save-standard"), revision: state.revision,
    bookVersion: book.version, documentId: doc.id, documentLength: doc.text.length,
    output: "/tmp/hint-lab-model.json", roles: state.operatingModel!.revisions.at(-1)!.data.nodes.filter(n => n.kind === "role").length }));
} finally { await pool.end(); }
