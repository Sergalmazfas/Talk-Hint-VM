/** Owner-approved documentation in the existing Dev model; no production writes. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis, applyHypothesisCommand } from "../server/projectModel/hypotheses";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { labRelease } from "../server/callLab/policy";

const dir = "generated-artifacts/owner-call-28oct";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rowCount, 1);
  const owner = q.rows[0].owner_key;
  const s = readHypothesis(await unpackModel(pool, owner, q.rows[0].state), "new-country");
  const id = "DOC-OWNER-CALLS", marker = "owner-call-coverage-2026-10-28";
  if (s.documents.some(d => d.id === id)) throw Error("ALREADY_RECORDED_NO_BLIND_REAPPLY");
  const find = (id: string) => {
    const d = s.documents.find(d => d.id === id); assert(d, id); return d;
  };
  const report = JSON.parse(await readFile(`${dir}/review/report.json`, "utf8"));
  const key = report.private_report_path.split("/").at(-1);
  const delivery = (await pool.query("SELECT status FROM call_lab_outbox WHERE key=$1", [key])).rows[0];
  const journalDoc = find("DOC-TALKHINT-IMPROVEMENT-JOURNAL");
  const journal = JSON.parse(journalDoc.text);
  const incident = journal.cases.find((c: any) => c.caseId === "HINT-OPS-DAILY-0800");
  assert(incident);
  const oldLabel = incident.label;
  incident.label = "Звонки владельца: дежурство";
  incident.detailDocumentId = id;
  const detail = {
    format: "talkhint.improvement-case-detail", version: 1, marker, labRelease,
    journalDocumentId: journalDoc.id, caseId: incident.caseId, previousLabel: oldLabel,
    roles: ["HEAD.07", "P.LAB", "P.OPS"], sourceRevision: s.revision,
    ownerDecision: {
      at: "2026-10-28", source: "Прямое решение владельца в чате",
      rules: [
        "Все личные звонки администратора; не другие пользователи и не новые аудиозаписи.",
        "Publish не выключает контур: автоматический запуск после readiness без обязательной кнопки.",
        "Hint: P.LAB → отдельная QA → короткое письмо даже при сбое AI; код считает воронку.",
        "Другие режимы: честное письмо «разбор не подключён» и журнал выполнения.",
        "P.OPS независим от выключателя лаборатории; проверяет отсутствие результата.",
        "Версия лаборатории в результате и письме. Перед «можно звонить» проверять активное production-состояние.",
      ],
    },
    history: [{
      at: new Date().toISOString(), role: "HEAD.07 / P.LAB / P.OPS",
      fact: "После Republish контроль анализа был false; для завершённого звонка не было job/outbox, watchdog тоже был на паузе.",
      diagnostic: {
        callSid: report.call_id, durationMs: report.duration_ms,
        execution: report.execution, labRelease: report.lab_release,
        qa: report.qa_status, qaIssues: report.qa_issues,
        outbox: delivery?.status ?? "unknown", privateReportPath: report.private_report_path,
        sourceEnvironment: "production", executionEnvironment: "development",
        automaticProductionRecovery: false,
        engineering: report.engineering_dossier,
      },
      devChange: "Owner-only all-mode history reconciliation; auto-resume after readiness; independent duty control; versioned analysis/notices.",
      verification: { targetedWithPostgres: "86 passed before documentation update; full suite pending", production: "not changed" },
    }],
    limitations: [
      "Production ещё не обновлён; старый процесс остаётся на паузе до Publish.",
      "Prepare без телефонного события не выдумывается. Неопределённый режим — unknown.",
      "Полнота зависит от существующего сохранения звонков; исчезнувшее до записи событие этим сервером не обнаружить.",
      "Дежурный на том же сервере и в том же Gmail не гарантирует оповещение при их отказе.",
      "QA вернула ручной разбор; инженерная сверка не заменяет независимую приёмку.",
    ],
    acceptance: { technical: "Dev verification in progress", ownerEvaluation: null, productionVerified: false },
  };
  const chapterDoc = find("DOC-TALKHINT-CHAPTER-HINT");
  const chapter = JSON.parse(chapterDoc.text);
  chapter.ownerCallCoverageDocumentId = id;
  const opsDoc = find("DOC-POPS-WORK-PACKAGE");
  const ops = JSON.parse(opsDoc.text);
  ops.decisions.push({ id: marker, at: "2026-10-28", status: "согласовано владельцем",
    documentId: id, scope: "Все личные звонки; Hint — QA, остальные режимы — уведомления",
    devPrepared: true, productionVerified: false });
  const bookDoc = find("DOC-TALKHINT-PRODUCT-PASSPORT");
  const book = bookDoc.text + `\n\nРешение владельца 28.10: все личные звонки, версия лаборатории, независимый дежурный — ${id}. Dev подготовлен; production не проверен.\n`;
  const entries = [
    { id, title: "Личные звонки: решение владельца и проверка контура", text: JSON.stringify(detail), url: "", elementIds: opsDoc.elementIds },
    { ...journalDoc, text: JSON.stringify(journal) },
    { ...chapterDoc, text: JSON.stringify(chapter) },
    { ...opsDoc, text: JSON.stringify(ops) },
    { ...bookDoc, text: book },
  ];
  for (const d of entries) assert(d.text.length <= 50_000, `${d.id}: document cap, preserve history`);
  const root = await persistModelUpdate(pool, owner, model => {
    assert.equal(readHypothesis(model, "new-country").revision, s.revision, "Concurrent update");
    for (const d of entries) model = applyHypothesisCommand(model, "new-country",
      { type: d.id === id ? "createDocument" : "saveDocument", id: d.id, title: d.title,
        text: d.text, url: d.url, elementIds: d.elementIds }, marker);
    return model;
  }, true);
  const after = readHypothesis(root, "new-country");
  await writeFile(`${dir}/model-receipt.json`, JSON.stringify({ revision: after.revision, documents: entries.map(d => ({
    id: d.id, characters: d.text.length, updatedAt: after.documents.find(x => x.id === d.id)?.updatedAt,
  })), productionChanged: false }, null, 2));
  console.log(JSON.stringify({ revision: after.revision, documents: entries.map(d => d.id) }));
} finally { await pool.end(); }
