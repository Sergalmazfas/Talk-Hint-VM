// Dev-only manual-review import. No worker, models, mail or call imports.
import assert from "node:assert/strict";
import { Pool } from "pg";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis } from "../server/projectModel/hypotheses";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { reviseLabRole, rubricId, methodId, diffId, reviewId, protocolId } from "../server/projectModel/research/labRoleReview";
import { labPacketId, labFormId } from "../server/projectModel/research/labRole";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.ok(["helium", "lithium"].includes(new URL(process.env.DATABASE_URL!).hostname), "Dev only");
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rowCount, 1);
  const row = q.rows[0], root = await unpackModel(pool, row.owner_key, row.state);
  const pass = JSON.parse(await readFile("/tmp/plab-input-2.json", "utf8"));
  const fixes = await readFile("/tmp/plab-input-0.md", "utf8");
  const findings = await readFile("/tmp/plab-input-1.md", "utf8");
  const before = readHypothesis(root, "new-country");
  let result = reviseLabRole(root, pass, fixes, findings, new Date().toISOString());
  if (process.argv.includes("--save")) result = await persistModelUpdate(pool, row.owner_key, current => {
    assert.equal(readHypothesis(current, "new-country").revision, before.revision, "Concurrent update");
    return reviseLabRole(current, pass, fixes, findings, new Date().toISOString());
  }, true);
  const state = readHypothesis(result, "new-country");
  const out = "generated-artifacts/plab-v2";
  await mkdir(out, { recursive: true });
  const oldData = before.operatingModel!.revisions.at(-1)!.data;
  const newData = state.operatingModel!.revisions.at(-1)!.data;
  await writeFile(`${out}/diff_exact.json`, JSON.stringify({
    fromRevision: before.revision, toRevision: state.revision,
    nodes: newData.nodes.filter(n => JSON.stringify(n) !== JSON.stringify(oldData.nodes.find(b => b.id === n.id)))
      .map(n => ({ id: n.id, before: oldData.nodes.find(b => b.id === n.id), after: n })),
    linksRemoved: oldData.links.filter(l => !newData.links.some(n => JSON.stringify(n) === JSON.stringify(l))),
    linksAddedOrChanged: newData.links.filter(l => !oldData.links.some(n => JSON.stringify(n) === JSON.stringify(l))),
  }, null, 2));
  for (const [id, filename] of [
    [labPacketId, `P-LAB_work_package_v2_rev${state.revision}.json`],
    [labFormId, "letter_v2.json"], [rubricId, "rubric_v1.json"], [methodId, "LAB_METHOD_response_v1.json"],
    [diffId, "changes_v1_to_v2.json"],
  ]) {
    const d = state.documents.find(d => d.id === id)!;
    await writeFile(`${out}/${filename}`, JSON.stringify(JSON.parse(d.text), null, 2));
  }
  const body = JSON.parse(state.documents.find(d => d.id === reviewId)!.text);
  const { trialProtocol, manualPass } = JSON.parse(state.documents.find(d => d.id === protocolId)!.text);
  assert.deepEqual({ ...body, trialProtocol, manualPass }, pass, "Lossless review reconstruction");
  await writeFile(`${out}/P-LAB_work_package_v1_rev768_PASS.json`, await readFile("/tmp/plab-input-2.json"));
  console.log(JSON.stringify({ saved: process.argv.includes("--save"), before: before.revision,
    revision: state.revision, packetCharacters: state.documents.find(d => d.id === labPacketId)!.text.length,
    out, workerStarted: false }));
} finally { await pool.end(); }
