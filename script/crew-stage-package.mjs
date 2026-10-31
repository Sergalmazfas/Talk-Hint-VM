// Acceptance export, never self-acceptance. Run after all model writes finish.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { callProductionMcp } from "./product-crew-production-mcp.mjs";
const base = "generated-artifacts/crew-stage";
const out = `${base}/acceptance`;
const call = async name => (await callProductionMcp("tools/call", { name, arguments: {} })).structuredContent.result;
const team = await call("get_team");
const roadmap = await call("get_roadmap");
if (team.revision !== roadmap.revision) throw Error("Final revision changed: export stopped, no write.");
for (const sub of ["employees", "knowledge", "prompt-layers", "proposals", "evidence", "sources"])
  await fs.mkdir(`${out}/${sub}`, { recursive: true });
const save = (p, v) => fs.writeFile(`${out}/${p}`, JSON.stringify(v, null, 2));
const documents = [];
for (const file of await fs.readdir(`${base}/documents`)) {
  const d = JSON.parse(await fs.readFile(`${base}/documents/${file}`, "utf8"));
  documents.push(d);
}
const profiles = new Map();
for (const d of documents) {
  try {
    const p = JSON.parse(d.text);
    if (p.visualPassport?.roleId) profiles.set(p.visualPassport.roleId, { profile: p, source: { id: d.id, revision: d.revision, snapshotHash: d.snapshotHash } });
  } catch { /* Product book is Markdown, not an employee JSON. */ }
}
const coverage = [];
for (const role of team.roles) {
  const p = profiles.get(role.id);
  const actions = roadmap.actionRegister.filter(a => a.roleId === role.id);
  const missing = [];
  if (!p) missing.push("Отдельная именная анкета через MCP не найдена");
  if (!p?.profile.visualPassport.selectedName) missing.push("Имя");
  if (!p?.profile.visualPassport.character?.traits?.every(Boolean)) missing.push("Три черты");
  if (!p?.profile.visualPassport.character?.motto) missing.push("Девиз");
  if (!p?.profile.prompt) missing.push("Отдельный текст промпта в найденной анкете");
  const declaredManager = p?.profile.visualPassport.reportsTo?.roleId;
  if (declaredManager && declaredManager !== role.managerId)
    missing.push("Подчинение в старом visualPassport не совпадает с повторно прочитанным графом; анкета отдельно не переписана");
  if (role.id === "product-manager-specialist")
    missing.push("Название руководителя проекта Hint в основном узле ещё не заменено");
  const employee = {
    format: "talkhint.employee.acceptance-export", environment: "production", model: "new-country",
    revision: team.revision, role, profile: p?.profile ?? null, profileSource: p?.source ?? null,
    duties: actions, relations: {
      managerId: role.managerId ?? null, subordinateIds: team.roles.filter(r => r.managerId === role.id).map(r => r.id),
      "Кто проверяет меня": [...new Set(actions.map(a => a.acceptorId).filter(Boolean))],
      outputHandoffs: actions.map(a => ({ actionId: a.id, nextId: a.nextId, resultIds: a.resultIds })),
    },
    prompt: { text: p?.profile.prompt ?? null, currentRuntimeVerified: false },
    prohibitions: { declaredPermissions: role.permissions ?? null,
      note: "Пустое поле запретов не разрешает внешние действия; общие правила сохраняются." },
    status: { modelDescription: role.status ?? null, executorId: role.executorId ?? null,
      runtimeVerified: false, acceptedByOwnerInThisStage: false },
    unfilled: missing,
  };
  if (role.code === "P.ORG") {
    employee.preparedProfileV2 = JSON.parse(await fs.readFile(`${base}/prepared/nina-v2.json`, "utf8"));
    employee.profileReplacementApplied = false;
  }
  await save(`employees/${role.id}.json`, employee);
  coverage.push({ id: role.id, code: role.code, name: p?.profile.visualPassport.selectedName ?? role.name, missing });
}
const external = documents.find(d => d.id === "team-external-partners-v1");
if (external) for (const member of JSON.parse(external.text).members.filter(m => m.kind === "external")) {
  await save(`employees/${member.id}.json`, { ...member, sourceDocumentId: external.id,
    sourceRevision: external.revision, sourceKind: "saved_profile_not_autonomous_agent", acceptedInThisStage: false });
}
await save("employees/employee-katya.json", {
  id: "employee-katya", name: "Катя", kind: "runtime_projection_not_operating_role",
  source: "server/team/runtime.ts + решение владельца, не свежий runtime-снимок",
  desiredManager: "Пустой руководитель проекта Секретарь под Марией",
  actualManagerFromCurrentCode: "owner", status: "not_verified_by_product_mcp",
  duties: ["Вести разрешённый телефонный разговор", "Навигация по услышанному IVR"],
  prohibitions: ["Деньги, карты, PIN, пароли и обязательства запрещены", "Не считать отправленную цифру подтверждением перехода"],
  limits: { callMinutes: 10, digitsWithoutNewMenu: 5 },
  prompt: null, unfilled: ["Снимок текущего промпта и характера через MCP недоступен",
    "Связь с будущим руководителем проекта ещё не внесена"], duplicateCreated: false, runtimeChanged: false,
});
for (const file of await fs.readdir(`${base}/prepared`)) {
  const target = file.startsWith("knowledge-") ? "knowledge" :
    file.startsWith("prompt-layers-") || file.startsWith("active-prompt-") ? "prompt-layers" : "proposals";
  await fs.copyFile(`${base}/prepared/${file}`, `${out}/${target}/${file}`);
}
await save("ROLE_COVERAGE.json", coverage);
await save("RELATIONSHIP_MAP.json", {
  revision: team.revision, environment: "production", model: "new-country",
  roles: team.roles.map(r => ({ id: r.id, code: r.code, name: r.name, managerId: r.managerId })),
  actions: roadmap.actionRegister,
  limits: ["MCP get_roadmap не возвращает clientId действий: единственность заказчика независимо не подтверждена.",
    "Не все связи графа доступны этим инструментом. nextId/resultIds и роли прочитаны; это не полная выгрузка всех link kinds."],
  desiredButNotApplied: [
    "Паша — название Руководитель проекта Hint и ограничение только Hint в основном узле",
    "Тихон уже mode=company в существующей анкете; отображаемое название роли всё ещё Специалист выпуска и эксплуатации",
    "Пустые руководители Секретаря, Copilot, Переводчика под Марией; Катя под руководителем Секретаря",
    "Нина: основной профиль заменить на v2; дополнительный документ не равен замене",
  ],
});
const receipts = JSON.parse(await fs.readFile(`${base}/receipts.json`, "utf8").catch(() => "[]"));
const docReceipts = JSON.parse(await fs.readFile(`${base}/document-receipts.json`, "utf8").catch(() => "[]"));
await save("evidence/model-write-receipts.json", receipts);
await save("evidence/document-write-receipts.json", docReceipts);
await save("evidence/final-pin.json", { environment: "production", model: "new-country", revision: team.revision,
  readTools: ["get_team", "get_roadmap"], roles: team.roles.length,
  writes: receipts.length, documents: docReceipts.length, allHaveReread: receipts.every(r => !!r.rereadRevision) && docReceipts.every(r => r.reread),
  acceptance: "awaiting_independent_review", ownerAcceptance: false, publishPerformed: false });
const selectedRoles = new Set(["product-manager-specialist", "laboratory-engineer-role", "lg-qa-role", "management-role-operations-specialist"]);
await save("evidence/self-acceptance-audit.json", {
  selectedRoleIds: [...selectedRoles],
  remainingInSelectedRoles: roadmap.actionRegister.filter(a => selectedRoles.has(a.roleId) && a.acceptorId === a.roleId),
  otherCompanyCases: roadmap.actionRegister.filter(a => a.roleId && a.acceptorId === a.roleId && !selectedRoles.has(a.roleId)),
  scope: "Исправляются семь случаев выбранных ролей; другие отделы не массово переписываются.",
});
for (const name of ["client-tests.log", "typecheck.log"]) {
  try { await fs.copyFile(`${base}/${name}`, `${out}/evidence/${name}`); } catch {}
}
for (const id of ["DOC-HINT-LAB-AGENT-PROMPT-PACKAGE", "DOC-HINT-LAB-AGENT-PROMPTS-BASELINE",
  "DOC-PORG-OPERATING-PASSPORT", "DOC-TALKHINT-TEAM-DIRECTORY"]) {
  const d = documents.find(d => d.id === id);
  if (d) await save(`sources/${id}.json`, d);
}
await fs.copyFile("replit.md", `${out}/sources/replit.md`);
await fs.copyFile("attached_assets/Pasted--Otter-ai-Otter--1793483363584_1793483363584.txt", `${out}/sources/otter-owner-input.txt`);
const readme = `# Команда Hint и отдел кадров — на независимую сверку\n\n` +
  `Production/new-country, r${team.revision}. Это НЕ самоприёмка и НЕ завершение всего этапа.\n\n` +
  `## Внесено через MCP и повторно прочитано\n${receipts.map(r => `- ${r.args.nodeId ?? r.args.roleId}: ${r.name}, r${r.rereadRevision}`).join("\n")}\n\n` +
  `## Сохранённые дополнительные документы, ожидают сверки\n${docReceipts.map(r => `- ${r.title}: ${r.documentId}, r${r.revision}`).join("\n")}\n\n` +
  `Дополнительные документы не заменяют исходный паспорт/каталог. Статус awaiting_review, не accepted.\n\n` +
  `## Не внесено из-за границ текущего MCP\n` +
  `- Создание пустых руководителей проектов и связь Кати с руководителем Секретаря.\n` +
  `- Название руководителя проекта Hint в основном узле Паши (mode=hint уже есть); отдельное ограничение его старых широких обязанностей не внесено.\n` +
  `- У Тихона mode=company уже есть; название основной роли ещё старое. Подчинение HEAD.07 сохранено.\n` +
  `- Замена первичной анкеты P.ORG, дополнение именно действующего паспорта компании, запись именно в competitorDirectory.\n` +
  `- Текущее MCP не отдаёт динамическую Катю и снимок её телефонного промпта. Подмена проектом или фиктивной задачей не сделана.\n` +
  `- Отдельный действующий AI-промпт Тихона не подтверждён. Процедуры дежурного не названы промптом.\n\n` +
  `## Содержимое\n` +
  `- employees: отдельный JSON каждой из ${team.roles.length} ролей; Катя и внешние партнёры отдельно, с обозначением источника.\n` +
  `- RELATIONSHIP_MAP.json: повторно прочитанная структура, выходы и ограничения полноты.\n` +
  `- ROLE_COVERAGE.json: что не заполнено у каждой роли.\n` +
  `- knowledge: четыре книжки на сверку; новые уроки proposed, принятие не выдумано.\n` +
  `- prompt-layers: Замир/Фома — существующие проекты с точной реконструкцией; активный baseline отдельно. По Кате/Тихону — явные блокеры.\n` +
  `- proposals: Нина v2, правила компании, R1–R5 proposed с прежними решениями подготовки, Otter «заявлено, не проверено».\n` +
  `- evidence: квитанции записей, финальный pin, тесты, аудит самоприёмки.\n\n` +
  `## Проверка\n32 целевых теста прошли; TypeScript прошёл. Таймаут клиента 60 секунд, без автоповтора записей.\n` +
  `Ни агенты, ни рабочие промпты, ни звонки не включались. Publish не выполнялся. Полный тестовый набор не запускался.\n` +
  `Защита /admin сохранена: неподписанный браузер показал вход. Подписанный экран команды визуально не проверен; доказательства изменений — повторное чтение production MCP.\n`;
await fs.writeFile(`${out}/00_ПРОЧИТАТЬ.md`, readme);
await fs.writeFile(`${out}/evidence/changes.diff`, execFileSync("git", ["diff", "--", "script/product-crew-production-mcp.mjs", "server/productCrew/secretClient.test.ts", "replit.md"], { encoding: "utf8" }));
const manifest = {};
async function scan(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await scan(p);
    else manifest[path.relative(out, p)] = createHash("sha256").update(await fs.readFile(p)).digest("hex");
  }
}
await scan(out);
await save("MANIFEST_SHA256.json", manifest);
execFileSync("zip", ["-qr", path.resolve("generated-artifacts/Hint_Crew_HR_acceptance.zip"), "."], { cwd: out });
console.log(JSON.stringify({ revision: team.revision, roles: team.roles.length, writes: receipts.length,
  documents: docReceipts.length, files: Object.keys(manifest).length + 1, zip: "generated-artifacts/Hint_Crew_HR_acceptance.zip" }));
