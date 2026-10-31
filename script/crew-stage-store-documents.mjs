// Save review documents using existing MCP work/result operations only.
// Does not patch existing documents, accept work, or run an agent.
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { callProductionMcp } from "./product-crew-production-mcp.mjs";
const base = "generated-artifacts/crew-stage";
const call = async (name, args) => (await callProductionMcp("tools/call", { name, arguments: args })).structuredContent.result;
const load = async name => JSON.parse(await fs.readFile(`${base}/prepared/${name}.json`, "utf8"));
const specs = [
  ["HR: Нина Кадрова — анкета v2, не подключена", ["nina-v2"], "proposal-4fe46862-f07e-562b-b6d7-4ab34716a545", "proposal-cf5cb39e-99d8-59bd-b8e5-05935670c14a"],
  ["Паспорт компании: правила AI Crew и три слоя — дополнение на сверку", ["company-rules-addendum"], "head-product", "crew-roadmap-phase-2"],
  ["Замир: книжка знаний и слои существующего проекта промпта", ["knowledge-zamir", "prompt-layers-zamir"], "laboratory-engineer-role", "crew-roadmap-phase-2"],
  ["Фома: книжка знаний и слои существующего проекта промпта", ["knowledge-foma", "prompt-layers-foma"], "lg-qa-role", "crew-roadmap-phase-2"],
  ["Катя: книжка знаний; действующий промпт через MCP недоступен", ["knowledge-katya", "prompt-layers-katya"], "head-product", "crew-roadmap-phase-2"],
  ["Тихон: книжка знаний; отдельный промпт не подтверждён", ["knowledge-tikhon", "prompt-layers-tikhon"], "management-role-operations-specialist", "management-action-operations"],
  ["Отдел кадров: первые предложения R1–R5, proposed", ["hr-first-proposals"], "proposal-4fe46862-f07e-562b-b6d7-4ab34716a545", "proposal-cf5cb39e-99d8-59bd-b8e5-05935670c14a"],
  ["P-BENCH: Otter.ai — заявлено, не проверено; кандидат в каталог", ["competitor-otter"], "benchmark-role-reference", "company-action-features"],
];
const receipts = JSON.parse(await fs.readFile(`${base}/document-receipts.json`, "utf8").catch(() => "[]"));
const pending = JSON.parse(await fs.readFile(`${base}/pending-document-operation.json`, "utf8").catch(() => "null"));
if (pending && !receipts.some(r => r.requestIds?.includes(pending.requestId)))
  throw Error("Earlier document write unconfirmed; reconcile before continuing.");
let revision = (await call("get_team", {})).revision;
for (const [title, files, roleId, processId] of specs) {
  if (receipts.some(r => r.title === title)) continue;
  const documents = {};
  for (const name of files) documents[name] = await load(name);
  const text = JSON.stringify({ format: "talkhint.stage.review-result", title,
    accepted: false, runtimeChanged: false, source: "Решение владельца, 2026-10-31; HEAD.07, ручной цикл P.ORG.",
    documents }, null, 2);
  if (text.length > 40000) throw Error("Document exceeds MCP limit; no write performed.");
  const requestIds = [];
  const createId = randomUUID(); requestIds.push(createId);
  const create = { revision, requestId: createId, title,
    description: "Подготовка описания по поручению владельца. Исполнение вручную HEAD.07, не автономная работа назначенной роли.",
    client: "Сергей, владелец", need: "Единый пакет приёмки команды и отдела кадров без запуска исполнителей.",
    roleId, processId, relatedIds: [roleId], nextStep: "Независимая сверка Claude, затем отдельная приёмка владельца.",
    expectedResult: "Сохранённый документ с источниками, ограничениями и статусами.",
    acceptance: "Один принимающий — владелец. Проверяющий — Claude. Исполнитель HEAD.07 не принимает собственную работу." };
  await fs.writeFile(`${base}/pending-document-operation.json`, JSON.stringify(create, null, 2));
  let record;
  try { record = await call("create_work", create); } catch { console.log("Document creation unconfirmed; stopped without retry."); break; }
  const rereadWork = await call("get_work", { recordId: record.record.id });
  if (rereadWork.record.id !== record.record.id) throw Error("Work reread mismatch.");
  revision = rereadWork.revision;
  const submitId = randomUUID(); requestIds.push(submitId);
  const submit = { revision, requestId: submitId, recordId: record.record.id, title, text,
    nextStep: "На независимую сверку; приёмка владельца отдельно. Ничего не включать." };
  await fs.writeFile(`${base}/pending-document-operation.json`, JSON.stringify(submit, null, 2));
  let result;
  try { result = await call("submit_result", submit); } catch { console.log("Document submission unconfirmed; stopped without retry."); break; }
  const documentId = result.record.coordination.resultDocumentId;
  const saved = await call("get_document", { documentId });
  if (saved.text !== text) throw Error("Document reread differs from submitted text.");
  revision = saved.revision;
  receipts.push({ title, files, roleId, processId, requestIds, recordId: record.record.id,
    documentId, revision, reread: true, state: "awaiting_review" });
  await fs.writeFile(`${base}/document-receipts.json`, JSON.stringify(receipts, null, 2));
  await fs.writeFile(`${base}/documents/${documentId}.json`, JSON.stringify(saved, null, 2));
  console.log(JSON.stringify({ saved: true, title, documentId, revision, reread: true, accepted: false }));
}
