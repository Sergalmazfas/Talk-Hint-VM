/** Documentation-only attachment to the existing historical case. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyHypothesisCommand, readHypothesis } from "../server/projectModel/hypotheses";
import { unpackModel } from "../server/projectModel/history";
import { ProductCrewService } from "../server/productCrew/service";
const dir = "generated-artifacts/hint-unified-preflight";
const plan = JSON.parse(await readFile(`${dir}/preflight.json`, "utf8"));
assert.equal(plan.newInferenceCalls, 0);
assert.equal(plan.requests.totalMaximum, 1088);
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const rows = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(rows.rows.length, 1);
  const owner = rows.rows[0].owner_key;
  const before = readHypothesis(await unpackModel(pool, owner, rows.rows[0].state), "new-country");
  assert(!before.documents.some(d => d.id === plan.documentId), "Preflight already exists; do not duplicate");
  const d = before.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
  const journal = JSON.parse(d.text);
  const oldCases = JSON.parse(JSON.stringify(journal.cases));
  const c = journal.cases.find((c: any) => c.caseId === plan.caseId);
  assert(c, "Attach to the existing model-history case only");
  c.history.push({ at: new Date().toISOString(), role: "P.LAB",
    documentId: plan.documentId, note: "Расчёт; запуск не разрешён" });
  journal.version++;
  const text = JSON.stringify(journal), pt = JSON.stringify(plan);
  assert(text.length <= 50_000 && pt.length <= 50_000, `Document sizes: ${text.length}/${pt.length}`);
  const actor = "P.LAB: расчёт единого текстового перепрогона; до разрешения не запускать";
  await persistModelUpdate(pool, owner, root => {
    assert.equal(readHypothesis(root, "new-country").revision, before.revision);
    let next = applyHypothesisCommand(root, "new-country", { type: "createDocument", id: plan.documentId,
      title: "Hint — единая линейка моделей — v1 — расчёт до запуска", url: "", text: pt,
      elementIds: ["TH-PRODUCT"] }, actor);
    next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: d.id,
      title: `TalkHint — журнал улучшений — v${journal.version}`, url: d.url, text, elementIds: d.elementIds }, actor);
    return next;
  }, true);
  const q = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const after = readHypothesis(await unpackModel(pool, owner, q.rows[0].state), "new-country");
  assert.deepEqual(before.operatingModel, after.operatingModel);
  for (const doc of before.documents) if (doc.id !== d.id)
    assert.deepEqual(after.documents.find(x => x.id === doc.id), doc);
  const svc = new ProductCrewService({ read: async () => after, update: async () => { throw Error("Read only"); } });
  assert.equal((await svc.call(owner, "get_document", { documentId: plan.documentId })).text, pt);
  assert.equal((await svc.call(owner, "get_document", { documentId: d.id })).text, text);
  assert.equal(journal.cases.length, oldCases.length);
  await writeFile(`${dir}/APPLICATION_RESULT.json`, JSON.stringify({
    sourceRevision: before.revision, revision: after.revision, journalVersion: journal.version,
    caseId: plan.caseId, documentId: plan.documentId, readerVerified: true,
    operationalModelUnchanged: true, unrelatedDocumentsUnchanged: true,
    newModelCalls: 0, journalCharacters: text.length,
  }, null, 2));
  console.log(await readFile(`${dir}/APPLICATION_RESULT.json`, "utf8"));
} finally { await pool.end(); }
