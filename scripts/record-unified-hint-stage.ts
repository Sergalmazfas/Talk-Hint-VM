/** Existing model, documentation only; no worker activation or provider settings. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyHypothesisCommand, readHypothesis } from "../server/projectModel/hypotheses";
import { unpackModel } from "../server/projectModel/history";
import { ProductCrewService } from "../server/productCrew/service";
const stage = process.argv[2];
assert(["authorized", "results"].includes(stage));
const dir = "generated-artifacts/hint-unified-preflight";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
try {
  const rows = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(rows.rows.length, 1);
  const owner = rows.rows[0].owner_key;
  const before = readHypothesis(await unpackModel(pool, owner, rows.rows[0].state), "new-country");
  const d = before.documents.find(d => d.id === "DOC-HINT-UNIFIED-REPLAY")!;
  const packet = JSON.parse(d.text);
  const marker = `unified-hint:${stage}`;
  assert(!packet.executionHistory?.some((e: any) => e.marker === marker));
  packet.executionHistory ??= [];
  if (stage === "authorized") {
    packet.ownerAuthorization = { receivedAt: new Date().toISOString(), source: "Прямой ответ владельца",
      answer: "Да, до $35", maximumUSD: 35, maximumRequests: 1088,
      scope: "Только Dev, сохранённые тексты, 5 моделей и независимый GPT-5.4; без изменений продукта/телефонии/включений/писем",
      retries: 0 };
    packet.referenceFreeze = JSON.parse(await readFile(`${dir}/REFERENCE_FREEZE.json`, "utf8"));
    packet.state = "Разрешено; эталон зафиксирован до вызовов";
    packet.referenceSourceVersions = before.documents.filter(d =>
      ["DOC-TALKHINT-PRODUCT-PASSPORT", "DOC-TALKHINT-CHAPTER-HINT", "DOC-PPRODUCT-WORK-PACKAGE"].includes(d.id)
      || /(?:P\.LAB|P\.LG\.QA)/i.test(d.title)).map(d => {
        let version: unknown = null;
        try { version = JSON.parse(d.text).version; } catch {}
        return { id: d.id, title: d.title, version };
      });
  } else {
    packet.actualReport = JSON.parse(await readFile(`${dir}/report.json`, "utf8"));
    packet.state = "Генерации завершены; оценка качества и историческая сверка неполны: квота API и дефекты судьи. Live не включён";
  }
  packet.version++;
  packet.executionHistory.push({ marker, at: new Date().toISOString(), role: "P.LAB",
    modelRevisionBefore: before.revision, productChanged: false });
  const text = JSON.stringify(packet);
  assert(text.length <= 50_000);
  const jd = before.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
  const journal = JSON.parse(jd.text);
  const historicalCase = journal.cases.find((c: any) => c.caseId === packet.caseId);
  assert(historicalCase);
  const originalHistory = JSON.stringify(historicalCase.history);
  if (stage === "results") {
    // A compact version index fits the remaining space; never compact/delete old cases.
    historicalCase.unifiedReplayVersion = packet.version;
    journal.version++;
  }
  const jt = JSON.stringify(journal);
  assert(jt.length <= 50_000, `Journal must retain all existing content: ${jt.length}`);
  assert.equal(JSON.stringify(historicalCase.history), originalHistory);
  await persistModelUpdate(pool, owner, root => {
    assert.equal(readHypothesis(root, "new-country").revision, before.revision);
    let next = applyHypothesisCommand(root, "new-country", { type: "saveDocument", id: d.id,
      title: `Hint — единая линейка моделей — v${packet.version} — ${stage === "authorized" ? "разрешено до $35" : "результат и Нужно решение"}`,
      url: d.url, text, elementIds: d.elementIds }, "P.LAB: единый текстовый перепрогон; стадия " + stage);
    if (stage === "results") next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: jd.id,
      title: `TalkHint — журнал улучшений — v${journal.version}`, url: jd.url, text: jt,
      elementIds: jd.elementIds }, "P.LAB: ссылка на версию результата в существующем случае; история сохранена");
    return next;
  }, true);
  const q = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const after = readHypothesis(await unpackModel(pool, owner, q.rows[0].state), "new-country");
  assert.deepEqual(before.operatingModel, after.operatingModel);
  for (const x of before.documents) if (x.id !== d.id && !(stage === "results" && x.id === jd.id))
    assert.deepEqual(after.documents.find(d => d.id === x.id), x);
  const svc = new ProductCrewService({ read: async () => after, update: async () => { throw Error("Read only"); } });
  assert.equal((await svc.call(owner, "get_document", { documentId: d.id })).text, text);
  if (stage === "results") assert.equal((await svc.call(owner, "get_document", { documentId: jd.id })).text, jt);
  await writeFile(`${dir}/readback-${stage}.json`, JSON.stringify({ revision: after.revision, document: packet,
    journalVersion: journal.version, journalCharacters: jt.length, previousJournalHistoryUnchanged: true,
    existingCase: packet.caseId, operatingModelUnchanged: true, readerVerified: true }, null, 2));
  console.log(JSON.stringify({ stage, revision: after.revision, documentVersion: packet.version, sourceDocuments: packet.referenceSourceVersions }));
} finally { await pool.end(); }
