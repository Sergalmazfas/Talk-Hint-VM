/** Append facts to the existing Dev journal. Never activates any runtime. */
import { Pool } from "pg";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyHypothesisCommand, readHypothesis } from "../server/projectModel/hypotheses";
const stage = process.argv[2];
assert(["started", "verified", "blocked"].includes(stage));
const url = process.env.DATABASE_URL;
assert(url && new URL(url).hostname === "helium");
const pool = new Pool({ connectionString: url });
try {
  const rows = await pool.query(`SELECT owner_key FROM talkhint_project_models WHERE EXISTS
   (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(rows.rows.length, 1);
  const at = new Date().toISOString();
  const diagnostic = stage === "verified"
    ? JSON.parse(await readFile("generated-artifacts/hint-owner-feedback-1/coffee-pass-2-report.json", "utf8"))
    : null;
  const items = [
    ["PROPOSED-HINT-OPENING-MANUAL-HIDE", "Первая фраза: одна строка после первой реплики; касание разворачивает",
      "HEAD.07", "ios/TalkHint/UI/InCallViewController.swift"],
    ["HINT-ISEE-PREFIX", "Потеря I see: фильтр удалял начало фразы", "HEAD.07", "server/hintText.ts"],
    ["HINT-GUEST-TRANSLATION", "Перевод собеседника: лимит ответа и обработка неполного JSON",
      "HEAD.07", "server/websocket.ts"],
    ["HINT-OWNER-FEEDBACK-001", "Кофейня: диагностика worker и исправление письма",
      "P.LAB", "scripts/diagnose-coffee-pass.ts"],
    ["HINT-OPS-DAILY-0800", "Только Hint: дежурство и отчёт 08:00 America/Denver",
      "P.OPS", "DOC-POPS-WORK-PACKAGE"],
  ];
  await persistModelUpdate(pool, rows.rows[0].owner_key, root => {
    const state = readHypothesis(root, "new-country");
    const doc = state.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
    const journal = JSON.parse(doc.text);
    const marker = `hint-today:${stage}`;
    if (journal.history.some((h: any) => h.marker === marker)) return root;
    for (const [caseId, label, role, evidence] of items) {
      let item = journal.cases.find((c: any) => c.caseId === caseId);
      if (!item) {
        item = { caseId, label, registeredAt: at, history: [],
          ownerEvaluationOfImplementedChange: null, accepted: false };
        journal.cases.push(item);
      }
      item.history ??= [];
      item.history.push({ at, role, stage, evidence, productionChanged: false,
        note: stage === "started" ? "Прямое поручение владельца; работа Dev, не проверка на iPhone. "
          + (caseId === "HINT-OWNER-FEEDBACK-001" ? "Резерв диагностического повтора №2, максимум 3; только сохранённый снимок, без письма." : "")
          : "Результаты см. docs/hint-release-today.md; это не оценка владельца." });
      if (stage === "verified") {
        item.history.at(-1).verification = {
          typescript: "passed", vitest: { passed: 2413, skipped: 28, failed: 0 },
          build: "passed", pythonOffline: { passed: 23 }, signedInUI: "not_verified",
          iPhone: "not_verified", production: "not_changed",
        };
        if (caseId === "HINT-OWNER-FEEDBACK-001")
          item.history.at(-1).diagnostic = { pass: 2, maximum: 3, workerCompleted: true,
            qaStatus: diagnostic.qa_status, qaIssues: diagnostic.qa_issues,
            mailSent: false, sourcePreserved: true };
      }
    }
    journal.version++;
    journal.history.push({ at, marker, role: "HEAD.07", stage });
    return applyHypothesisCommand(root, "new-country", { type: "saveDocument", id: doc.id,
      title: doc.title, url: doc.url, text: JSON.stringify(journal), elementIds: doc.elementIds },
    "HEAD.07 / P.LAB / P.OPS: поручение владельца");
  }, true);
  console.log(JSON.stringify({ journalUpdated: true, stage, productionChanged: false }));
} finally { await pool.end(); }
