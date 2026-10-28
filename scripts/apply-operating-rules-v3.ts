/** Owner-approved content-only application. Default is a pure dry run. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Pool } from "pg";
import { unpackModel } from "../server/projectModel/history";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyHypothesisCommand, readHypothesis } from "../server/projectModel/hypotheses";
import type { ProjectModelState, ModelCommand } from "../shared/projectModel";
import { rulesBookText } from "./lib/rules-book";
import { readProductBook } from "../shared/productBook";

const baseDir = "generated-artifacts/operating-rules-review/package";
const targetDir = "generated-artifacts/operating-rules-applied";
const journalId = "DOC-TALKHINT-IMPROVEMENT-JOURNAL";
const opsDocs = ["DOC-POPS-WORK-PACKAGE", "DOC-POPS-DAILY-REPORT"];
const bookId = "DOC-TALKHINT-PRODUCT-PASSPORT";
const roadmapId = "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d";
const actor = "HEAD.07 · поручение Сергея от 27.10.2026";
const stamp = new Date().toISOString();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const manifest = JSON.parse(await readFile(`${baseDir}/manifest.json`, "utf8"));
const journalProposal = JSON.parse(await readFile(`${baseDir}/journal.proposed.json`, "utf8"));
const linkProposal = JSON.parse(await readFile(`${baseDir}/model.proposed.links.json`, "utf8"));
const candidate = await readFile("docs/reviews/operating-rules-v3/replit.candidate.md", "utf8");

export function transformRules(root: ProjectModelState): ProjectModelState {
  const before = readHypothesis(root, "new-country");
  const existing = before.documents.find(d => d.id === journalId);
  if (existing) {
    const journal = JSON.parse(existing.text);
    assert.equal(journal.applicationMarker, "rules-v3-owner-approved-2026-10-27");
    return root; // Same approval is applied once, no duplicate document/revision.
  }
  assert.equal(before.revision, 822, "Concurrent revision: review before application");
  assert(!before.documents.some(d => /журнал улучшений/i.test(d.title)), "Equivalent journal exists");
  for (const ref of manifest.baselineDocuments) {
    const doc = before.documents.find(d => d.id === ref.id);
    assert(doc);
    assert.equal(sha(doc.text), ref.sha256, `Document conflict: ${ref.id}`);
  }
  const docBefore = (id: string) => before.documents.find(d => d.id === id)!;
  const currentOperating = before.operatingModel!.revisions.at(-1)!;
  assert.equal(currentOperating.version, 36);
  let next = root;
  const command = (c: ModelCommand) => { next = applyHypothesisCommand(next, "new-country", c, actor); };
  const journal = {
    ...journalProposal, format: "talkhint.improvement-journal", version: 1,
    status: "Формат согласован; случаи открыты, их результаты не приняты",
    applicationMarker: "rules-v3-owner-approved-2026-10-27",
    documentId: journalId, appliedAt: stamp, proposedDocumentId: undefined,
    ownerDecisions: [
      { date: "2026-10-27", by: "Сергей", status: "согласовано",
        subject: "Правила v3 с правками; роли выполняют всё делегируемое, Claude — независимый проверяющий",
        source: "Прямое сообщение владельца: «Пакет правил v3 — да, с правками»",
        implementationBoundary: "Регламент и документы; не подключение Claude/crew" },
      { date: "2026-10-27", by: "Сергей", status: "согласовано",
        subject: "До 3 диагностических повторов на звонок: только звонки владельца, сохранённый снимок, журнал",
        runtimeChanged: false },
      { date: "2026-10-27", by: "Сергей", status: "согласовано",
        subject: "Дневной отчёт P.OPS — 08:00 America/Denver; сутки по Денверу",
        scheduleStarted: false },
      { date: "2026-10-27", by: "Сергей", status: "отложено до отдельного пакета",
        subject: "Не применять ops.proposed.patch.json; переработать P.OPS по проходу rev800",
        originalPassAvailable: false,
        pendingInput: "P-OPS_pass_rev800_v1.zip не прикреплён в доступном хранилище" },
    ],
    decisionsOrAcceptancesCreated: true,
    decisionBoundary: "Приняты правила, не QA/исправление/закрытие случаев",
    history: [{ at: stamp, actor, event: "Создан единый журнал по согласованному пакету",
                sourceRevision: before.revision, casesAccepted: false }],
    commonReports: {
      ...journalProposal.commonReports,
      activePacketVersion: 2, activeFormVersion: 1,
      note: "Документы P.OPS не изменены; доработка по проходу rev800 отдельным пакетом",
    },
  };
  assert(JSON.stringify(journal).length <= 50_000);
  command({ type: "createDocument", id: journalId,
    title: "TalkHint — журнал улучшений — v1 — действующий, случаи на рассмотрении",
    url: "/admin/project-model?hypothesis=new-country&view=book",
    text: JSON.stringify(journal), elementIds: ["TH-PRODUCT"] });

  const appendix = `\n\n## Правила v3 и единый журнал улучшений\n` +
    `Применено по решению Сергея от 27.10.2026, ${stamp}. Регламент: replit.md v3.\n` +
    `Журнал: ${journalId} v1. Первые записи связаны с прежними Mint, кофейней и Hint; ` +
    `изменения не объявлены принятыми. Отчётность — прежние ${opsDocs.join(" и ")}; ` +
    `доработка P.OPS исключена и ждёт отдельного пакета по проходу rev800.\n` +
    `Дневной отчёт согласован на 08:00 America/Denver; расписание не запущено. ` +
    `Критерий следующего этапа: проверяемые входы, реальные ответы/приёмка; ` +
    `новых технических сроков и запусков нет.\n`;
  for (const [id, version] of [[bookId, 13], [roadmapId, 25]] as const) {
    const old = docBefore(id);
    let text = old.text;
    if (id === bookId) {
      text = rulesBookText(old, version, stamp);
    } else {
      text = text.replace(/^# TalkHint — единый roadmap, v\d+/, `# TalkHint — единый roadmap, v${version}`);
      text += appendix;
    }
    assert(text.length <= 50_000, `Document size: ${id}`);
    command({ type: "saveDocument", id,
      title: old.title.replace(/\bv\d+\b/, `v${version}`), text, url: old.url, elementIds: old.elementIds });
  }
  const data = structuredClone(currentOperating.data);
  for (const ref of linkProposal.roleReferences) {
    if (ref.roleId === "management-role-operations-specialist") continue; // Explicit P.OPS exclusion.
    const node = data.nodes.find(n => n.id === ref.roleId)!;
    assert(node);
    node.referenceIds = [...new Set([...node.referenceIds, journalId])];
  }
  command({ type: "saveOperatingModel", baseVersion: currentOperating.version, data });
  const after = readHypothesis(next, "new-country");
  for (const id of opsDocs) assert(isDeepStrictEqual(docBefore(id), after.documents.find(d => d.id === id)));
  for (const old of currentOperating.data.nodes) {
    if (old.id.startsWith("oncall-") || old.id === "management-role-operations-specialist" ||
        old.roleId === "management-role-operations-specialist")
      assert(isDeepStrictEqual(old, after.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.id === old.id)));
  }
  assert(isDeepStrictEqual(currentOperating.data.links, after.operatingModel!.revisions.at(-1)!.data.links));
  assert.equal(after.documents.length, before.documents.length + 1);
  return next;
}

function repairBook(root: ProjectModelState) {
  const before = readHypothesis(root, "new-country");
  assert.equal(before.revision, 826);
  const doc = before.documents.find(d => d.id === bookId)!;
  assert.equal(readProductBook(doc), null, "No repair needed; do not create an extra version");
  let next = applyHypothesisCommand(root, "new-country", {
    type: "saveDocument", id: doc.id, title: doc.title.replace(/\bv13\b/, "v14"),
    text: rulesBookText(doc, 14, stamp, true), url: doc.url, elementIds: doc.elementIds,
  }, actor);
  const jdoc = before.documents.find(d => d.id === journalId)!;
  const journal = JSON.parse(jdoc.text);
  assert.equal(journal.version, 1);
  journal.version = 2;
  journal.history.push({
    at: stamp, actor, event: "Чтение книги проверено; исправлена сериализация через productBookText",
    bookVersionBefore: 13, bookVersionAfter: 14, casesAccepted: false,
    runtimeChanged: false,
  });
  next = applyHypothesisCommand(next, "new-country", {
    type: "saveDocument", id: jdoc.id, title: jdoc.title.replace(/\bv1\b/, "v2"),
    text: JSON.stringify(journal), url: jdoc.url, elementIds: jdoc.elementIds,
  }, actor);
  const after = readHypothesis(next, "new-country");
  for (const id of opsDocs)
    assert(isDeepStrictEqual(before.documents.find(d => d.id === id), after.documents.find(d => d.id === id)));
  assert(isDeepStrictEqual(before.operatingModel, after.operatingModel));
  assert(readProductBook(after.documents.find(d => d.id === bookId)));
  return next;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rowCount, 1);
  const root = await unpackModel(pool, q.rows[0].owner_key, q.rows[0].state);
  const save = process.argv.includes("--save");
  const transform = process.argv.includes("--repair-book") ? repairBook : transformRules;
  const staged = transform(root);
  const stageState = readHypothesis(staged, "new-country");
  assert.equal(transformRules(staged), staged, "Repeated application must be a no-op");
  // File application is a separate explicit phase, never silently skipped.
  if (save) assert.equal(await readFile("replit.md", "utf8"), candidate, "Approved file not installed");
  const persisted = save ? await persistModelUpdate(pool, q.rows[0].owner_key, current => {
    assert.equal(readHypothesis(current, "new-country").revision,
      readHypothesis(root, "new-country").revision, "Concurrent change");
    return transform(current);
  }, true) : staged;
  const after = readHypothesis(persisted, "new-country");
  const result = {
    applied: save, fromRevision: readHypothesis(root, "new-country").revision,
    revision: after.revision, operatingVersion: after.operatingModel!.revisions.at(-1)!.version,
    journalId, journalVersion: JSON.parse(after.documents.find(d => d.id === journalId)!.text).version,
    bookVersion: readProductBook(after.documents.find(d => d.id === bookId))!.version, roadmapVersion: 25,
    opsPacketApplied: false, opsFormApplied: false, runtimeStarted: false,
    diagnosticRuns: 0, mailSent: false, idempotencyDryRunPassed: true,
    stagedRevision: stageState.revision,
  };
  await mkdir(targetDir, { recursive: true });
  await writeFile(`${targetDir}/${save ? "application" : "preflight"}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await pool.end(); }
