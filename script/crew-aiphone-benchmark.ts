/** One owner-authorized new proposed document; no retries, acceptance or runtime execution. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { callProductionMcp, productionMcpDiagnostic } from "./product-crew-production-mcp.mjs";
import { inputs } from "../server/productCrew/service";

const dir = "generated-artifacts/aiphone-benchmark";
const sourcePath = "attached_assets/Pasted--5-AI-Phone-propo-1793828983853_1793828983853.txt";
const title = "Бенчмарк конкурентов — AI Phone";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const save = (name: string, value: unknown) =>
  writeFile(`${dir}/${name}.json`, JSON.stringify(value, null, 2));
const rpc = async (name: string, args = {}) =>
  (await callProductionMcp("tools/call", { name, arguments: args })).structuredContent.result;
const log: any = { status: "preflight", operations: [] };
let revision: number;
async function main() {
  await mkdir(dir, { recursive: true });
  const resuming = process.argv[2] === "--resume-verified-work";
  if (!resuming && process.argv[2] !== "--owner-authorized") throw Error("CONFIRMATION_REQUIRED");
  const pending = await readFile(`${dir}/write-log.json`, "utf8").catch(() => null);
  if (pending && !resuming) throw Error("PRIOR_ATTEMPT_EXISTS_NO_RETRY");
  if (resuming) {
    const previous = pending && JSON.parse(pending);
    if (!previous || previous.operations.length !== 1 || previous.operations[0].tool !== "create_work" ||
      previous.operations[0].status !== "verified") throw Error("RESUME_NOT_PROVEN_STOP");
    Object.assign(log, previous);
  }
  const source = await readFile(sourcePath, "utf8"), offset = source.indexOf("# Бенчмарк:");
  if (offset < 0 || !source.trim()) throw Error("MISSING_SOURCE");
  const body = source.slice(offset);
  const sourceHash = digest(source), bodyHash = digest(body);
  const tools = await callProductionMcp("tools/list");
  await save("tools", tools);
  for (const name of ["get_team", "search_materials", "create_work", "submit_result", "get_work", "get_document"])
    if (!tools.tools.some((t: any) => t.name === name)) throw Error("TOOL_MISSING");
  const team = await rpc("get_team");
  revision = team.revision;
  if (resuming && revision !== log.operations[0].revisionAfter) throw Error("RESUME_REVISION_CHANGED_STOP");
  await save("team", team);
  const maria = team.roles.find((r: any) => r.id === "head-product");
  if (!maria?.passport?.coordination?.processId) throw Error("MARIA_PROCESS_NOT_FOUND");
  for (const query of resuming ? [] : ["AI Phone", "AIPhone"]) {
    const search = await rpc("search_materials", { query });
    await save(`search-${query.replace(/\s/g, "-")}`, search);
    if (search.revision !== revision) throw Error("REVISION_CHANGED_STOP");
    if (search.documents.some((d: any) => d.title === title) ||
      search.elements.some((e: any) => e.title === title)) throw Error("EXISTING_BENCHMARK_STOP");
  }
  const text = `# ${title}\n\nСтатус: proposed — на рассмотрение Марии Соболь (HEAD.06); не принят.\n` +
    `Подготовлено вручную Replit по решению владельца; сотрудники и модели не запускались.\n` +
    `Источник: текст владельца, 04.11.2026. Сохранён ниже без изменений.\n` +
    `SHA-256 исходного файла: ${sourceHash}\nSHA-256 блока источника: ${bodyHash}\n\n` +
    `## Границы достоверности\n\n` +
    `Это материал владельца, не независимая проверка открытых источников. Числа пользователей, функции, ` +
    `тарифы, цена Кати и утверждения об отсутствии возможностей у конкурента требуют проверки. ` +
    `Причина сбросов — гипотеза; опыт владельца — пользовательский отчёт. Идеи для TalkHint — только ` +
    `proposed, не разрешение на внедрение. Подписку/баллы не покупали, звонков не делали.\n\n` +
    `## Исходный материал (дословно)\n\n${body}`;
  await writeFile(`${dir}/benchmark.md`, text);
  const create = inputs.create_work.parse({
    revision, requestId: randomUUID(), title,
    description: "Только сохранить исходный бенчмарк владельца отдельным proposed-документом для Марии. Не исследование и не запуск сотрудника.",
    client: "Сергей, владелец", need: "Сохранить входящий материал AI Phone для рассмотрения Марией, не смешивая заявления и проверенные факты.",
    roleId: "head-product", processId: maria.passport.coordination.processId, relatedIds: ["head-product"],
    nextStep: "Сохранить proposed-документ; Мария рассматривает материалы, приёмка владельца отдельно.",
    expectedResult: "1 новый proposed-документ, 100% исходного текста сохранено; 0 изменений продукта и 0 запущенных сотрудников.",
    acceptance: "Владелец принимает отдельно. Сохранение и передача Марии не означают приёмку или независимую проверку фактов.",
  });
  inputs.submit_result.parse({ revision, requestId: randomUUID(), recordId: "draft", title, text, nextStep: create.nextStep });
  async function command(name: "create_work" | "submit_result", args: any, count: number, hashBefore: string) {
    const op: any = { tool: name, uuid: args.requestId, revisionBefore: revision, hashBefore, status: "pending" };
    log.operations.push(op); await save("write-log", log);
    const result = await rpc(name, args);
    await save(`receipt-${log.operations.length}`, result);
    if (result.saved !== true || result.launched !== false || result.replayed || result.revision !== revision + count)
      throw Error("WRITE_RESPONSE_MISMATCH_STOP");
    revision = result.revision;
    const reread = await rpc("get_work", { recordId: result.record.id });
    await save(`work-${log.operations.length}`, reread);
    if (reread.revision !== revision || !isDeepStrictEqual(reread.record, result.record))
      throw Error("WORK_READBACK_MISMATCH_STOP");
    op.revisionAfter = revision; op.hashAfter = digest(JSON.stringify(reread.record));
    return { op, reread };
  }
  const fresh = await rpc("get_team");
  if (!isDeepStrictEqual(fresh, team)) throw Error("FRESH_TEAM_CHANGED_STOP");
  let created: any;
  if (resuming) {
    const confirmed = JSON.parse(await readFile(`${dir}/work-1.json`, "utf8"));
    const reread = await rpc("get_work", { recordId: confirmed.record.id });
    if (!isDeepStrictEqual(reread, confirmed) || reread.revision !== revision ||
      digest(JSON.stringify(reread.record)) !== log.operations[0].hashAfter)
      throw Error("RESUME_WORK_CHANGED_STOP");
    created = { op: log.operations[0], reread };
  } else created = await command("create_work", create, 1, digest(JSON.stringify(fresh)));
  if (created.reread.result !== null || created.reread.record.coordination.state !== "assigned" ||
    created.reread.record.coordination.roleId !== "head-product") throw Error("CREATED_WORK_MISMATCH_STOP");
  created.op.status = "verified"; await save("write-log", log);
  const beforeSubmit = await rpc("get_work", { recordId: created.reread.record.id });
  if (!isDeepStrictEqual(beforeSubmit, created.reread)) throw Error("FRESH_WORK_CHANGED_STOP");
  const submitted = await command("submit_result", inputs.submit_result.parse({
    revision, requestId: randomUUID(), recordId: beforeSubmit.record.id, title, text,
    nextStep: "proposed: Марии на рассмотрение; утверждения проверить отдельно, принимает владелец. Ничего не внедрять и не включать.",
  }), 2, digest(JSON.stringify(beforeSubmit.record)));
  const documentId = submitted.reread.record.coordination.resultDocumentId;
  const d = await rpc("get_document", { documentId });
  await save("document", d);
  if (d.revision !== revision || d.snapshotHash !== digest(text) || d.text !== text || d.title !== title ||
    d.text.slice(d.text.indexOf("# Бенчмарк:")) !== body ||
    submitted.reread.record.coordination.state !== "awaiting_review" ||
    submitted.reread.result?.text !== text) throw Error("DOCUMENT_READBACK_MISMATCH_STOP");
  submitted.op.status = "verified"; submitted.op.documentHash = d.snapshotHash;
  log.status = "verified"; log.revision = revision; log.documentId = documentId;
  log.sourceHash = sourceHash; log.bodyHash = bodyHash;
  await save("write-log", log);
  console.log(JSON.stringify({ status: log.status, revision, documentId, documentHash: d.snapshotHash,
    accepted: false, launched: false, sourcePreserved: true }));
}
main().catch(async error => {
  log.status = "STOP_NO_RETRY";
  await save("STOP", { ...log, diagnostic: productionMcpDiagnostic(error),
    reason: /^[A-Z_]+$/.test(error.message) ? error.message : "UNCONFIRMED" }).catch(() => {});
  console.log(JSON.stringify({ status: log.status, diagnostic: productionMcpDiagnostic(error),
    reason: /^[A-Z_]+$/.test(error.message) ? error.message : "UNCONFIRMED" }));
  process.exitCode = 1;
});
