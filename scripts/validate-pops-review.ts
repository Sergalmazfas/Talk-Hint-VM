/** Offline validation only: no database, runtime, network or model calls. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { applyCommand } from "../server/projectModel/domain";

const directory = "generated-artifacts/pops-review";
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const original = json("/tmp/pops-current.json");
const before = JSON.stringify(original);
const patch = json(`${directory}/ops.review.patch.json`);
const oldOperating = original.operatingModel.revisions.at(-1);
assert.equal(original.revision, patch.guards.revision);
assert.equal(oldOperating.version, patch.guards.operatingVersion);
const data = structuredClone(oldOperating.data);
const changes = new Map(patch.nodeUpdates.map((c: any) => [c.id, c]));
data.nodes = data.nodes.map((node: any) => {
  const change: any = changes.get(node.id);
  if (!change) return node;
  assert(isDeepStrictEqual(node, change.before));
  return change.after;
});
const removed = new Set(patch.linkUpdates.removed.map((l: any) => l.id));
data.links = data.links.filter((l: any) => !removed.has(l.id));
data.links.push(...patch.linkUpdates.added);
let staged = applyCommand(original, {
  type: "saveOperatingModel", baseVersion: oldOperating.version, data,
}, "offline P.OPS review validation");
for (const update of patch.documentUpdates) {
  const old = original.documents.find((d: any) => d.id === update.id);
  assert(old);
  const candidate = json(`${directory}/${update.candidateFile}`);
  assert.equal(candidate.version, update.toVersion);
  assert.equal(JSON.parse(old.text).version, update.fromVersion);
  assert.equal(createHash("sha256").update(old.text).digest("hex"),
    patch.guards.documents[update.id]);
  staged = applyCommand(staged, {
    type: "saveDocument", id: old.id, title: old.title,
    url: old.url, text: JSON.stringify(candidate), elementIds: old.elementIds,
  }, "offline P.OPS review validation");
}
assert.equal(JSON.stringify(original), before);
assert.equal(staged.operatingModel?.revisions.at(-1)?.version, oldOperating.version + 1);
for (const doc of original.documents) {
  if (patch.documentUpdates.some((u: any) => u.id === doc.id)) continue;
  assert(isDeepStrictEqual(doc, staged.documents.find((d: any) => d.id === doc.id)));
}
const packet = json(`${directory}/P-OPS_work_package_v3_CANDIDATE.json`);
const form = json(`${directory}/P-OPS_daily_report_v2_CANDIDATE.json`);
for (const action of packet.actions) {
  for (const input of action.inputs) {
    if (!input.inputRef) continue;
    assert.equal(input.inputRef, `DOC-POPS-DAILY-REPORT#/inputCatalog/${input.sourceId}`);
    assert(form.inputCatalog[input.sourceId]);
  }
}
const result = {
  passed: true, method: "Штатный applyCommand в памяти, без БД",
  sourceRevision: original.revision,
  stagedOperatingVersion: staged.operatingModel?.revisions.at(-1)?.version,
  applied: false, originalSnapshotUnchanged: true,
  unrelatedDocumentsUnchanged: true, crossDocumentInputsResolve: true,
  stagedDocumentVersions: [packet.version, form.version],
  independentQA: false,
};
writeFileSync(`${directory}/MODEL_VALIDATION.json`, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
