/** Read/write Dev model documents only. No runtime workers or provider calls. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { unpackModel } from "../server/projectModel/history";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyHypothesisCommand, readHypothesis } from "../server/projectModel/hypotheses";
import { ProductCrewService } from "../server/productCrew/service";
const stage = process.argv[2];
assert(["authorized", "results"].includes(stage));
const dir = "generated-artifacts/hint-unified-rescore";
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const r = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(r.rows.length, 1);
  const owner = r.rows[0].owner_key;
  const before = readHypothesis(await unpackModel(pool, owner, r.rows[0].state), "new-country");
  const parent = before.documents.find(d => d.id === "DOC-HINT-UNIFIED-REPLAY")!;
  const linked = before.documents.find(d => d.id === "DOC-HINT-UNIFIED-RESCORE-PREFLIGHT")!;
  const jd = before.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
  const packet = JSON.parse(parent.text), detail = JSON.parse(linked.text), j = JSON.parse(jd.text);
  const at = new Date().toISOString(), marker = `unified-hint:rescore-${stage}`;
  assert(!packet.executionHistory.some((e: any) => e.marker === marker));
  if (stage === "authorized") {
    detail.ownerBudgetAuthorization = { at, source: "Прямой ответ владельца", answer: "До $10",
      maximumUSD: 10, maximumRequests: 656, generationRequests: 0, retries: 0,
      scope: "20 контрастных калибровок; только при проходе — 448 сохранённых ответов + 188 архивных",
      productChangesAllowed: false };
    detail.state = "Разрешена калибровка с условной досверкой, предел $10";
    detail.pricing.proposedCapNeedsOwnerApproval = false;
    detail.pricing.authorizedStageCapUSD = 10;
    packet.nextStage.ownerBudgetAuthorization = detail.ownerBudgetAuthorization;
    packet.nextStage.proposedCapNeedsOwnerApproval = false;
    packet.state = detail.state;
  } else {
    const result = JSON.parse(await readFile(`${dir}/RESULT.json`, "utf8"));
    detail.executionResult = result;
    detail.offlineCalibrationReview = JSON.parse(await readFile(`${dir}/CALIBRATION_REVIEW.json`, "utf8"));
    detail.state = result.calibrationPassed ? "Оценка выполнена в пределах разрешённого этапа; см. покрытие" : "Калибровка не прошла формальный допуск; массовая досверка не запускалась";
    packet.nextStage.result = { calibrationPassed: result.calibrationPassed,
      calibrationMatched: result.calibrationMatched, calibrationTotal: 20,
      attemptedRequests: result.attemptedRequests, pricedUsageUSD: result.pricedUsageUSD,
      conservativeUSD: result.conservativeUSD, rescoredRequests: result.rescoredRequests,
      documentId: linked.id, productChanged: false };
    packet.state = detail.state;
  }
  detail.version++; packet.version++; j.version++;
  const c = j.cases.find((c: any) => c.caseId === "HINT-MODEL-HISTORY-001"); assert(c);
  c.unifiedReplayVersion = packet.version;
  packet.executionHistory.push({ marker, at, role: "P.LAB", linkedDocumentId: linked.id,
    linkedVersion: detail.version, productChanged: false });
  const changes = [
    { doc: linked, title: `Hint — калибровка и досверка — v${detail.version} — ${stage === "authorized" ? "разрешено до $10" : "фактический результат"}`, text: JSON.stringify(detail) },
    { doc: parent, title: `Hint — единая линейка моделей — v${packet.version} — ${stage === "authorized" ? "допуск к калибровке" : "итог калибровки и досверки"}`, text: JSON.stringify(packet) },
    { doc: jd, title: `TalkHint — журнал улучшений — v${j.version}`, text: JSON.stringify(j) },
  ];
  assert(changes.every(x => x.text.length <= 50_000));
  await persistModelUpdate(pool, owner, root => {
    assert.equal(readHypothesis(root, "new-country").revision, before.revision);
    for (const x of changes) root = applyHypothesisCommand(root, "new-country", { type: "saveDocument",
      id: x.doc.id, title: x.title, text: x.text, url: x.doc.url, elementIds: x.doc.elementIds }, "P.LAB: " + marker);
    return root;
  }, true);
  const q = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const after = readHypothesis(await unpackModel(pool, owner, q.rows[0].state), "new-country");
  assert.deepEqual(before.operatingModel, after.operatingModel);
  for (const d of before.documents) if (!changes.some(x => x.doc.id === d.id)) assert.deepEqual(after.documents.find(x => x.id === d.id), d);
  const svc = new ProductCrewService({ read: async () => after, update: async () => { throw Error("read only"); } });
  for (const x of changes) assert.equal((await svc.call(owner, "get_document", { documentId: x.doc.id })).text, x.text);
  const receipt = { stage, revision: after.revision, parentVersion: packet.version, linkedVersion: detail.version,
    journalVersion: j.version, readerVerified: true, operatingModelUnchanged: true,
    ...(stage === "authorized" ? { ownerBudgetAuthorization: detail.ownerBudgetAuthorization,
      calibrationFileSHA256: detail.calibrationFileSHA256, jobsSHA256: detail.jobsSHA256 } : {}) };
  await writeFile(`${dir}/${stage === "authorized" ? "AUTHORIZATION" : "READBACK_RESULT"}.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally { await pool.end(); }
