/** Existing canonical case/doc only. No inference or production mutations. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyHypothesisCommand, readHypothesis } from "../server/projectModel/hypotheses";
import { unpackModel } from "../server/projectModel/history";
import { ProductCrewService } from "../server/productCrew/service";
const dir = "generated-artifacts/hint-unified-rescore";
const plan = JSON.parse(await readFile(`${dir}/preflight.json`, "utf8"));
const calibration = JSON.parse(await readFile(`${dir}/calibration.json`, "utf8"));
const production = JSON.parse(await readFile(`${dir}/production-check.json`, "utf8"));
assert.equal(plan.paidCallsMade, 0);
assert.equal(plan.maximumRequests, 656);
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const r = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(r.rows.length, 1);
  const owner = r.rows[0].owner_key;
  const before = readHypothesis(await unpackModel(pool, owner, r.rows[0].state), "new-country");
  const d = before.documents.find(d => d.id === plan.documentId)!;
  const packet = JSON.parse(d.text);
  assert(!packet.nextStage?.version, "Already saved; do not duplicate preflight");
  const at = new Date().toISOString();
  for (const row of packet.actualReport.decisionRequest.rows) {
    row.ownerAnswer = row.id === "UNIFIED.1" ? "нет" : "да";
    row.ownerAnswerAt = at;
    row.source = "Прямой ответ владельца: UNIFIED.1 — нет; UNIFIED.2 — да, сначала калибровка, перед запуском число и цена";
  }
  packet.actualReport.decisionRequest.status = "Решения UNIFIED.1/2 получены; новый расчёт до платного запуска";
  packet.version++;
  const supportingId = "DOC-HINT-UNIFIED-RESCORE-PREFLIGHT";
  assert(!before.documents.some(d => d.id === supportingId));
  const detail = { ...plan, documentId: supportingId, parentDocumentId: d.id,
    calibrationCases: calibration.map((x: any) => ({
    id: x.id, fixtureId: x.fixtureId, kind: x.kind, candidate: x.candidate, expected: x.expected })),
    calibrationFileSHA256: createHash("sha256").update(await readFile(`${dir}/calibration.json`)).digest("hex"),
    jobsSHA256: createHash("sha256").update(await readFile(`${dir}/judge-jobs.json`)).digest("hex"),
    productionReadOnlyCheck: production };
  const detailText = JSON.stringify(detail);
  assert(detailText.length <= 50_000);
  packet.nextStage = { version: 1, documentId: supportingId, state: plan.state,
    maximumRequests: plan.maximumRequests, generationRequests: 0, calibrationRequests: 20,
    currentJudgeRequests: 448, historicalJudgeRequests: 188, pricing: plan.pricing,
    gate: plan.gate, proposedCapNeedsOwnerApproval: true };
  packet.productionReadOnlyCheck = { status: "Quota-caused production failures not confirmed; APNs notification failures confirmed",
    documentId: supportingId, productionChanged: false, inferenceProbes: 0 };
  packet.state = "UNIFIED.1 нет / UNIFIED.2 да; калибровка и досверка подготовлены, цена перед запуском; новых вызовов нет";
  packet.executionHistory.push({ marker: "unified-hint:rescore-preflight-v1", at, role: "P.LAB/P.OPS",
    ownerDecisionsRecorded: true, newPaidCalls: 0, productChanged: false });
  const text = JSON.stringify(packet);
  assert(text.length <= 50_000, `Document too large: ${text.length}`);
  const jd = before.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
  const j = JSON.parse(jd.text);
  const c = j.cases.find((c: any) => c.caseId === plan.caseId);
  assert(c);
  const history = JSON.stringify(c.history);
  c.unifiedReplayVersion = packet.version;
  j.version++;
  const jt = JSON.stringify(j);
  assert(jt.length <= 50_000); assert.equal(JSON.stringify(c.history), history);
  await persistModelUpdate(pool, owner, root => {
    assert.equal(readHypothesis(root, "new-country").revision, before.revision);
    let next = applyHypothesisCommand(root, "new-country", { type: "createDocument", id: supportingId,
      title: "Hint — калибровка судьи и досверка — v1 — расчёт до запуска", url: "", text: detailText,
      elementIds: d.elementIds }, "P.LAB/P.OPS: связанное приложение существующего случая, не новый каталог");
    next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: d.id,
      title: `Hint — единая линейка моделей — v${packet.version} — калибровка и досверка: расчёт до запуска`,
      url: d.url, text, elementIds: d.elementIds }, "P.LAB/P.OPS: решения владельца, расчёт, read-only проверка production");
    return applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: jd.id,
      title: `TalkHint — журнал улучшений — v${j.version}`, url: jd.url, text: jt,
      elementIds: jd.elementIds }, "P.LAB: индекс новой версии существующего случая, история сохранена");
  }, true);
  const q = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const after = readHypothesis(await unpackModel(pool, owner, q.rows[0].state), "new-country");
  assert.deepEqual(after.operatingModel, before.operatingModel);
  for (const doc of before.documents) if (![d.id, jd.id].includes(doc.id))
    assert.deepEqual(after.documents.find(d => d.id === doc.id), doc);
  const svc = new ProductCrewService({ read: async () => after, update: async () => { throw Error("read only"); } });
  assert.equal((await svc.call(owner, "get_document", { documentId: d.id })).text, text);
  assert.equal((await svc.call(owner, "get_document", { documentId: jd.id })).text, jt);
  assert.equal((await svc.call(owner, "get_document", { documentId: supportingId })).text, detailText);
  const receipt = { documentId: d.id, documentVersion: packet.version, revision: after.revision,
    supportingDocumentId: supportingId, supportingDocumentVersion: 1,
    journalVersion: j.version, journalChars: jt.length, documentChars: text.length, newPaidCalls: 0,
    operatingModelUnchanged: true, unrelatedDocumentsUnchanged: true, historyUnchanged: true, readerVerified: true };
  await writeFile(`${dir}/APPLICATION_RESULT.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally { await pool.end(); }
