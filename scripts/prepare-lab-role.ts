// Explicit Dev-only import/export; no runtime/provider modules.
import assert from "node:assert/strict";
import { Pool } from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis } from "../server/projectModel/hypotheses";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { prepareLabRole, labPacketId, labFormId } from "../server/projectModel/research/labRole";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.ok(["helium", "lithium"].includes(new URL(process.env.DATABASE_URL!).hostname), "Dev only");
  const query = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(query.rowCount, 1, "One existing model required");
  const row = query.rows[0], root = await unpackModel(pool, row.owner_key, row.state);
  const before = readHypothesis(root, "new-country"), now = new Date().toISOString();
  const preview = prepareLabRole(root, now);
  let result = preview;
  if (process.argv.includes("--save")) {
    result = await persistModelUpdate(pool, row.owner_key, current => {
      assert.equal(readHypothesis(current, "new-country").revision, before.revision, "Concurrent change: reread");
      return prepareLabRole(current, now);
    }, true);
  }
  const state = readHypothesis(result, "new-country");
  const packet = state.documents.find(d => d.id === labPacketId)!;
  const data = state.operatingModel!.revisions.at(-1)!.data;
  assert.ok(packet && JSON.parse(packet.text).metadata.sourceRevision === state.revision);
  const output = "generated-artifacts/plab-work-package";
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/P-LAB_work_package_v1_rev${state.revision}.json`, JSON.stringify(JSON.parse(packet.text), null, 2));
  await writeFile(`${output}/P-LAB_letter_template_v1.json`, state.documents.find(d => d.id === labFormId)!.text);
  console.log(JSON.stringify({ saved: process.argv.includes("--save"), beforeRevision: before.revision,
    revision: state.revision, packetId: packet.id, bytes: Buffer.byteLength(packet.text), characters: packet.text.length,
    output, roleCount: data.nodes.filter(n => n.kind === "role").length,
    labActions: data.nodes.filter(n => n.id.startsWith("lab-action-")).length,
    workerStarted: false, mailEnabled: false }));
} finally { await pool.end(); }
