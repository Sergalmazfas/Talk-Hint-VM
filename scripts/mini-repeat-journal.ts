/** Explicit Dev-only journal writes; not part of any application workflow. */
import { Pool } from "pg";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyHypothesisCommand, readHypothesis } from "../server/projectModel/hypotheses";
import { unpackModel } from "../server/projectModel/history";
import { ProductCrewService } from "../server/productCrew/service";

const stage = process.argv[2];
assert(["authorized", "results"].includes(stage));
const dir = "generated-artifacts/hint-mini-repeat";
await mkdir(dir, { recursive: true });
assert(new URL(process.env.DATABASE_URL!).hostname === "helium", "Dev database only");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const rows = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(rows.rows.length, 1);
  const owner = rows.rows[0].owner_key;
  const before = readHypothesis(await unpackModel(pool, owner, rows.rows[0].state), "new-country");
  await writeFile(`${dir}/model-before-${stage}.json`, JSON.stringify(before));
  const report = stage === "results" ? JSON.parse(await readFile(`${dir}/report.json`, "utf8")) : null;
  await persistModelUpdate(pool, owner, root => {
    const m = readHypothesis(root, "new-country");
    const doc = m.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
    const journal = JSON.parse(doc.text);
    const marker = `hint-mini-repeat:${stage}`;
    assert(!journal.history.some((h: any) => h.marker === marker), "Stage already saved; do not repeat");
    const c = journal.cases.find((c: any) => c.caseId === "HINT-OWNER-FEEDBACK-001");
    const decision = c.productDecisionRequests.find((d: any) => d.id === `${c.caseId}/NEED-DECISION/2`);
    assert(decision);
    const at = new Date().toISOString();
    if (stage === "authorized") {
      decision.ownerAnswer = "да, только стенд";
      decision.ownerAnswerSource = "Прямой ответ владельца на вопрос «Разрешить следующий текстовый стенд Mini?»";
      decision.answeredAt = at;
      decision.status = "Разрешён только текстовый Dev-стенд: 54 генерации + 9 отдельных проверок; без повторов запросов";
      for (const row of decision.rows ?? []) {
        row.ownerAnswer = "да, только стенд";
        row.status = decision.status;
        row.answeredAt = at;
      }
    } else {
      c.laboratoryMiniRepeat = { documentId: "DOC-HINT-FAST-DIALOGUE-TRIAL",
        version: 3, summary: report.summary, productionChanged: false, ownerAcceptance: null };
      decision.executionStatus = "Завершён ограниченный стенд; результаты не приёмка изменения";
    }
    const entry = { at, marker, role: stage === "authorized" ? "P.PRODUCT" : "P.LAB",
      caseId: c.caseId, productionChanged: false,
      note: stage === "authorized"
        ? "Разрешение владельца сохранено до вызовов; только существующие тексты, аудио отложено"
        : "Сохранены все результаты и сбои Mini, без изменения продукта; QA-ограничения сохранены" };
    c.history.push(entry); journal.history.push(entry); journal.version++;
    let next = applyHypothesisCommand(root, "new-country", { type: "saveDocument",
      id: doc.id, title: `TalkHint — журнал улучшений — v${journal.version} — стенд Mini`,
      text: JSON.stringify(journal), url: doc.url, elementIds: doc.elementIds }, entry.note);
    if (stage === "results") {
      const d = m.documents.find(d => d.id === "DOC-HINT-FAST-DIALOGUE-TRIAL")!;
      const previous = JSON.parse(d.text);
      assert.equal(previous.version, 2, "Reconcile newer trial before writing");
      const updated = { ...previous, version: 3, updatedAt: at, previousExperimentsPreserved: true,
        miniRepeatedExperiment: report, productionChanged: false, ownerAcceptance: null };
      const text = JSON.stringify(updated);
      assert(text.length <= 50_000, "Existing document size limit; do not truncate history");
      next = applyHypothesisCommand(next, "new-country", { type: "saveDocument",
        id: d.id, title: "P.LAB — быстрый диалог — v3 — повторный текстовый стенд Mini",
        text, url: d.url, elementIds: d.elementIds }, entry.note);
    }
    assert.deepEqual(readHypothesis(next, "new-country").operatingModel, m.operatingModel);
    return next;
  }, true);
  const afterRow = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const after = readHypothesis(await unpackModel(pool, owner, afterRow.rows[0].state), "new-country");
  const svc = new ProductCrewService({ read: async () => after, update: async () => { throw Error("Read-only verification"); } });
  const documents: any[] = [];
  for (const id of ["DOC-TALKHINT-IMPROVEMENT-JOURNAL", "DOC-HINT-FAST-DIALOGUE-TRIAL",
    "DOC-TALKHINT-PRODUCT-PASSPORT", "DOC-TALKHINT-CHAPTER-HINT", "DOC-PLAB-WORK-PACKAGE"]) {
    const d = await svc.call(owner, "get_document", { documentId: id });
    assert.equal(d.text, after.documents.find(v => v.id === id)!.text);
    documents.push({ id, title: after.documents.find(v => v.id === id)!.title,
      revision: d.revision, text: d.text, readerVerified: true });
  }
  await writeFile(`${dir}/model-${stage}.json`, JSON.stringify(after));
  await writeFile(`${dir}/readback-${stage}.json`, JSON.stringify(documents, null, 2));
  console.log(JSON.stringify({ stage, revision: after.revision,
    journalVersion: JSON.parse(documents[0].text).version,
    trialVersion: JSON.parse(documents[1].text).version, readerVerified: true,
    documentsRead: documents.map(d => ({ id: d.id, title: d.title })) }));
} finally { await pool.end(); }
