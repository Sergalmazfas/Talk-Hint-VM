/** Journal/approved laboratory results only, existing Dev model and identities. */
import { Pool } from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyHypothesisCommand, readHypothesis } from "../server/projectModel/hypotheses";
import { unpackModel } from "../server/projectModel/history";
const stage = process.argv[2];
assert(["authorized", "results"].includes(stage));
const dir = "generated-artifacts/coffee-product-decisions";
await mkdir(dir, { recursive: true });
const url = process.env.DATABASE_URL;
assert(url && new URL(url).hostname === "helium");
const pool = new Pool({ connectionString: url });
try {
  const r = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(r.rows.length, 1);
  const owner = r.rows[0].owner_key;
  const result = stage === "results" ? JSON.parse(await readFile(`${dir}/review-results.json`, "utf8")) : null;
  await persistModelUpdate(pool, owner, root => {
    const m = readHypothesis(root, "new-country");
    const d = m.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
    const journal = JSON.parse(d.text);
    const marker = `coffee-product-approved-1-4:${stage}`;
    if (journal.history.some((h: any) => h.marker === marker)) return root;
    const c = journal.cases.find((c: any) => c.caseId === "HINT-OWNER-FEEDBACK-001");
    assert(c);
    const request = c.productDecisionRequests.find((d: any) => d.id === "HINT-OWNER-FEEDBACK-001/NEED-DECISION/1");
    assert(request);
    const at = new Date().toISOString();
    if (stage === "authorized") {
      for (const row of request.rows) {
        row.ownerAnswer = "да";
        row.ownerAnswerSource = "Прямой ответ владельца: строки 1–4 — Dev-модели на трёх сохранённых звонках; 5 — отложить аудио";
        row.answeredAt = at;
        row.acceptedBy = "owner";
        row.status = row.rowId.endsWith("-5") ? "согласовано отложить; не запускать аудио" : "согласована лабораторная проверка; продукт не менять";
      }
      request.deliveryStatus = "Получено владельцем в чате; ответы по всем пяти строкам получены";
      request.implementationStarted = false;
      journal.ownerDecisions ??= [];
      journal.ownerDecisions.push(
        { id: "PRODUCT.OWNER.INBOX", answer: "да", at, scope: "Подготовка ограниченного чтения ответов владельца в цепочках лаборатории; исполнителя не включать", enabled: false },
        { id: "PRODUCT.OWNER.WEEKLY", answer: "да", at, scope: "Понедельник 08:00 America/Denver, блок в письме P.OPS", enabled: false },
      );
    } else {
      c.laboratoryTextExperiment = { documentId: "DOC-HINT-FAST-DIALOGUE-TRIAL",
        version: 2, actualResult: result.summary, productionChanged: false, ownerAcceptedImprovement: false };
      assert(!c.productDecisionRequests.some((d: any) => d.id === result.nextDecisionRequest.id));
      c.productDecisionRequests.push(result.nextDecisionRequest);
      c.approvedResourcePreparations = {
        gmailReplies: { decisionId: "PRODUCT.OWNER.INBOX",
          status: "Разрешена подготовка; контракт подготовлен, reader не реализован/не включён",
          scope: "Только ответы владельца в разрешённых цепочках P.LAB, без общего чтения Gmail" },
        weeklyProductBlock: { decisionId: "PRODUCT.OWNER.WEEKLY",
          status: "Формат согласован; контракт подготовлен, отправка/расписание не менялись",
          schedule: "Понедельник 08:00 America/Denver, блок в письме P.OPS, не второе письмо" },
      };
    }
    const entry = { at, marker, role: stage === "authorized" ? "P.PRODUCT" : "P.LAB",
      caseId: c.caseId, scope: "Dev / сохранённые тексты / строки 1–4",
      note: stage === "authorized" ? "Прямое разрешение владельца сохранено до запуска. Аудио отложено, P.PRODUCT не включён."
        : "Лабораторные результаты сохранены; независимая модельная проверка не приёмка владельца. Продукт не менялся.",
      productionChanged: false };
    c.history.push(entry); journal.history.push(entry); journal.version++;
    let next = applyHypothesisCommand(root, "new-country", { type: "saveDocument",
      id: d.id, title: `TalkHint — журнал улучшений — v${journal.version} — контур кофейни`,
      url: d.url, text: JSON.stringify(journal), elementIds: d.elementIds },
      "P.PRODUCT / P.LAB: прямые решения владельца и лабораторные результаты");
    if (stage === "results") {
      const old = m.documents.find(d => d.id === "DOC-HINT-FAST-DIALOGUE-TRIAL")!;
      const previous = JSON.parse(old.text);
      assert.equal(previous.version, 1, "Reconcile existing newer trial first");
      const updated = { ...previous, version: 2, updatedAt: at,
        previousExperimentPreserved: true, authorizedProductIteration: result,
        productionChanged: false, ownerAcceptance: null };
      next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: old.id,
        title: "P.LAB — быстрый диалог — v2 — согласованные текстовые варианты",
        url: old.url, text: JSON.stringify(updated), elementIds: old.elementIds },
        "P.LAB: результаты стенда без смены рабочего Hint");
    }
    assert.deepEqual(readHypothesis(next, "new-country").operatingModel, m.operatingModel);
    return next;
  }, true);
  const rows = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const after = readHypothesis(await unpackModel(pool, owner, rows.rows[0].state), "new-country");
  await writeFile(`${dir}/model-${stage}.json`, JSON.stringify(after));
  console.log(JSON.stringify({ stage, revision: after.revision,
    journalVersion: JSON.parse(after.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!.text).version,
    productionChanged: false }));
} finally { await pool.end(); }
