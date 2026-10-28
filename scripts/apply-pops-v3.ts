/** Explicit owner-approved Dev content import; no runtime activation. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Pool } from "pg";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { unpackModel } from "../server/projectModel/history";
import { applyHypothesisCommand, readHypothesis } from "../server/projectModel/hypotheses";
import type { ModelCommand, ProjectModelState } from "../shared/projectModel";

const dir = "generated-artifacts/pops-review";
const read = async (p: string) => JSON.parse(await readFile(p, "utf8"));
const patch = await read(`${dir}/ops.review.patch.json`);
const pass = await read(`${dir}/history/P-OPS_work_package_v2_rev800_PASS.json`);
const url = process.env.DATABASE_URL;
assert(url && new URL(url).hostname === "helium", "Only existing Dev database");
const pool = new Pool({ connectionString: url });
const rows = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
 (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
assert.equal(rows.rows.length, 1);
const { owner_key: owner } = rows.rows[0];
const at = new Date().toISOString();
const candidates = new Map<string, any>();
for (const update of patch.documentUpdates) candidates.set(update.id, await read(`${dir}/${update.candidateFile}`));
const packet = candidates.get("DOC-POPS-WORK-PACKAGE");
const form = candidates.get("DOC-POPS-DAILY-REPORT");
packet.metadata.status = "Описание v3 принято владельцем; исполнение не проверено";
packet.metadata.ownerAcceptance = { at, decision: "Применить P.OPS v3 по README; только подготовка Hint",
  source: "Прямое поручение владельца; Copilot не трогать" };
packet.authorization.appliedToModel = true;
packet.authorization.automaticExecution = false;
form.status = "Описание v2 принято владельцем; наблюдение/рассылка не активированы";
form.reviewHistory = [{ source: "P-OPS_pass_rev800_v1.zip", manualPass: pass.manualPass,
  trialProtocol: pass.trialProtocol, archiveSha256: packet.manualPassHistory[0].sourceArchiveSha256 }];
for (const value of candidates.values()) assert(JSON.stringify(value).length <= 50000);

function transform(root: ProjectModelState) {
  const old = readHypothesis(root, "new-country");
  const stored = JSON.parse(old.documents.find(d => d.id === "DOC-POPS-WORK-PACKAGE")!.text);
  if (stored.version === 3 && stored.metadata.ownerAcceptance?.decision === packet.metadata.ownerAcceptance.decision)
    return root;
  assert.equal(old.revision, patch.guards.revision, "Rebase required");
  const rev = old.operatingModel!.revisions.at(-1)!;
  assert.equal(rev.version, patch.guards.operatingVersion);
  const data = structuredClone(rev.data);
  for (const update of patch.nodeUpdates) {
    const i = data.nodes.findIndex(n => n.id === update.id);
    assert(i >= 0 && isDeepStrictEqual(data.nodes[i], update.before), update.id);
    data.nodes[i] = update.after;
  }
  const removed = new Set(patch.linkUpdates.removed.map((l: any) => l.id));
  data.links = data.links.filter(l => !removed.has(l.id));
  data.links.push(...patch.linkUpdates.added);
  let next = applyHypothesisCommand(root, "new-country",
    { type: "saveOperatingModel", baseVersion: rev.version, data }, "HEAD.07: owner-approved P.OPS v3");
  for (const update of patch.documentUpdates) {
    const doc = old.documents.find(d => d.id === update.id)!;
    assert.equal(createHash("sha256").update(doc.text).digest("hex"), patch.guards.documents[doc.id]);
    const command: ModelCommand = { type: "saveDocument", id: doc.id, url: doc.url,
      title: doc.title.replace(/\bv[12]\b/, `v${update.toVersion}`),
      text: JSON.stringify(candidates.get(doc.id)), elementIds: doc.elementIds };
    next = applyHypothesisCommand(next, "new-country", command, "HEAD.07: owner-approved P.OPS v3");
  }
  const after = readHypothesis(next, "new-country");
  for (const doc of old.documents)
    if (!candidates.has(doc.id)) assert(isDeepStrictEqual(doc, after.documents.find(d => d.id === doc.id)));
  return next;
}
try {
  const current = await unpackModel(pool, owner, rows.rows[0].state);
  const dry = transform(current);
  if (process.argv.includes("--save"))
    await persistModelUpdate(pool, owner, transform, true);
  const actual = process.argv.includes("--save")
    ? await unpackModel(pool, owner, (await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner])).rows[0].state)
    : dry;
  const state = readHypothesis(actual, "new-country");
  const result = { applied: process.argv.includes("--save"), revision: state.revision,
    operatingVersion: state.operatingModel!.revisions.at(-1)!.version,
    packetVersion: 3, formVersion: 2, runtimeActivated: false, copilotUnchanged: true };
  await writeFile(`${dir}/APPLICATION_RESULT.json`, JSON.stringify(result, null, 2));
  console.log(result);
} finally { await pool.end(); }
