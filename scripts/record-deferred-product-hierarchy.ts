/** Record the owner's deferred decision only; never rebuild roles or activate workers. */
import assert from "node:assert/strict";
import { Pool } from "pg";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyHypothesisCommand, readHypothesis } from "../server/projectModel/hypotheses";
import { unpackModel } from "../server/projectModel/history";
import { ProductCrewService } from "../server/productCrew/service";

assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const caseId = "PRODUCT-TWO-TIER-AFTER-HINT";
try {
  const rows = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(rows.rows.length, 1);
  const owner = rows.rows[0].owner_key;
  const before = readHypothesis(await unpackModel(pool, owner, rows.rows[0].state), "new-country");
  const doc = before.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
  const journal = JSON.parse(doc.text);
  assert(!journal.cases.some((c: any) => c.caseId === caseId), "Decision already recorded; do not duplicate");
  const at = new Date().toISOString();
  const history = { at, role: "P.PRODUCT", source: "владелец, решение 27.10.2026",
    note: "Записано отложенное решение; текущая структура, приёмка и исполнители без изменений." };
  journal.cases.push({
    caseId, title: "Две ступени управления продуктом — после завершения Hint",
    mode: "весь продукт / Hint", source: "владелец", decisionDate: "2026-10-27",
    recordedAt: at, status: "решение владельца — отложено, не внедрять сейчас",
    decision: {
      chief: "P.PRODUCT — главный по продукту: весь паспорт; сводит отчёты продуктовых по режимам; ищет переносы между режимами.",
      modeLeads: "Продуктовые по режимам; первый — P.PRODUCT.HINT, затем продуктовый Кати. Это будущая структура, не созданные/подключённые должности.",
      reportBlock: "В отчёте каждого режима — «Находки для других режимов». Шаблоны сейчас не менять.",
      example: "Голосовой ввод на своём языке из Copilot → Hint: владелец описывает запрос фразы голосом без передачи этой речи собеседнику. Идея переноса, не решение внедрять функцию и не проверенное сравнение с конкурентами.",
    },
    returnWhen: [
      "Контур Hint работает сам: Publish и включение.",
      "2–3 звонка с письмами и оценкой.",
      "Утренний отчёт пришёл.",
      "Решение по Mini внедрено.",
    ],
    sequence: "После выполнения условий Hint — до подключения Кати.",
    conditionVerification: "В рамках этой заметки не проверялось; готовность условий не утверждается.",
    currentBoundary: "Сейчас роли не перестраивать. Текущая правка приёмки P.PRODUCT остаётся в силе.",
    relatedDocumentIds: ["DOC-PPRODUCT-WORK-PACKAGE", "DOC-TALKHINT-PRODUCT-PASSPORT", "DOC-TALKHINT-CHAPTER-HINT"],
    runtimeChanged: false, tasksCreated: false, history: [history],
  });
  journal.history.push({ ...history, caseId });
  journal.version++;
  const text = JSON.stringify(journal);
  assert(text.length <= 50_000, `Document limit: ${text.length}`);
  await persistModelUpdate(pool, owner, root => {
    assert.equal(readHypothesis(root, "new-country").revision, before.revision);
    return applyHypothesisCommand(root, "new-country", {
      type: "saveDocument", id: doc.id, title: `TalkHint — журнал улучшений — v${journal.version}`,
      url: doc.url, text, elementIds: doc.elementIds,
    }, "P.PRODUCT: записать отложенное решение владельца 27.10, без перестройки ролей");
  }, true);
  const q = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const after = readHypothesis(await unpackModel(pool, owner, q.rows[0].state), "new-country");
  assert.deepEqual(after.operatingModel, before.operatingModel);
  for (const old of before.documents) if (old.id !== doc.id)
    assert.deepEqual(after.documents.find(d => d.id === old.id), old);
  const svc = new ProductCrewService({ read: async () => after, update: async () => { throw Error("Read only"); } });
  assert.equal((await svc.call(owner, "get_document", { documentId: doc.id })).text, text);
  console.log(JSON.stringify({ revision: after.revision, journalVersion: journal.version, caseId,
    operationalModelUnchanged: true, otherDocumentsUnchanged: true, readerVerified: true, characters: text.length }));
} finally { await pool.end(); }
