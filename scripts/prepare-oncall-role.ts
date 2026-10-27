// Explicit Dev-only documentation update. Never imports application runtime/providers.
import assert from "node:assert/strict";
import { Pool } from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis } from "../server/projectModel/hypotheses";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { prepareOncallRole, opsPacketId, opsFormId } from "../server/projectModel/research/oncallRole";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rowCount, 1);
  const root = await unpackModel(pool, q.rows[0].owner_key, q.rows[0].state);
  const before = readHypothesis(root, "new-country"), at = new Date().toISOString();
  const save = process.argv.includes("--save");
  const next = save ? await persistModelUpdate(pool, q.rows[0].owner_key, current => {
    assert.equal(readHypothesis(current, "new-country").revision, before.revision, "Concurrent change: reread");
    return prepareOncallRole(current, at);
  }, true) : prepareOncallRole(root, at);
  const state = readHypothesis(next, "new-country");
  const packet = JSON.parse(state.documents.find(d => d.id === opsPacketId)!.text);
  const dir = "generated-artifacts/pops-work-package";
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/P-OPS_work_package_v${packet.version}_rev${packet.metadata.sourceRevision}.json`, JSON.stringify(packet, null, 2));
  await writeFile(`${dir}/P-OPS_daily_report_form_v1.json`, JSON.stringify(JSON.parse(state.documents.find(d => d.id === opsFormId)!.text), null, 2));
  console.log(JSON.stringify({ saved: save, beforeRevision: before.revision, revision: state.revision,
    documentId: opsPacketId, version: packet.version, actions: packet.actions.length,
    packageCharacters: JSON.stringify(packet).length, roleId: packet.role.id,
    rolesAdded: 0, runtimeStarted: false, dailyMailSent: false, outputDirectory: dir }));
} finally { await pool.end(); }
