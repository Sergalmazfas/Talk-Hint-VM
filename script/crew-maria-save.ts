import fs from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { callProductionMcp } from "./product-crew-production-mcp.mjs";
import { mariaResponsibilities } from "../server/productCrew/mariaPassport";
const dir = "generated-artifacts/maria-passport";
const call = async (name: string, args = {}) =>
  (await callProductionMcp("tools/call", { name, arguments: args })).structuredContent.result;
const save = async (name: string, value: unknown) =>
  fs.writeFile(`${dir}/${name}.json`, JSON.stringify(value, null, 2));
async function main() {
  await fs.mkdir(dir, { recursive: true });
  try { await fs.access(`${dir}/pending-passport-write.json`);
    throw Error("Existing write must be reconciled before any new write.");
  } catch (e: any) { if (e.code !== "ENOENT") throw e; }
  const team = await call("get_team");
  const spec = mariaResponsibilities(team.roles);
  const actions = JSON.stringify(spec);
  if (actions.length > 6000) throw Error("Description exceeds existing bounded passport tool.");
  const args = { revision: team.revision, requestId: randomUUID(),
    roleId: "head-product", processId: "product-hypotheses",
    client: JSON.stringify(spec.clients), need: "Целостный продукт, приоритеты проектов и решения владельцу.",
    actions, inputs: JSON.stringify(spec.inputs),
    output: "Актуальный паспорт продукта; разобранный бенчмарк; приоритеты руководителям проектов; проверенные итоги; короткая сводка владельцу.",
    acceptance: spec.acceptanceNote, resources: "Паспорт продукта, материалы P-BENCH, итоги руководителей проектов, сообщения дежурного, цели и решения владельца. Новые ресурсы не подключены.",
    permissions: spec.prohibitions.join("\n"),
    handoff: JSON.stringify({ urgent: spec.urgentRule, clients: spec.clients,
      benchmarkAcceptorId: "head-product", directAssignmentsToExecutors: false }),
    unknown: "План не задан владельцем; факт не измерено. Три будущих руководителя — без выдуманных ID. Главная visual-анкета и 24 нативные линии приёмки P-BENCH требуют отдельной сверки diff.",
    nextStep: "Независимая сверка Claude; новая возможность MCP — после Publish владельцем. Приёмка и включение отдельно." };
  await save("pending-passport-write", args);
  let response: unknown;
  try { response = await call("update_role_passport", args); }
  catch { response = { status: "write_response_unconfirmed", retried: false }; }
  const after = await call("get_team", { roleId: "head-product" });
  const maria = after.roles.find((r: any) => r.id === "head-product");
  const passport = maria?.passport;
  if (passport?.details?.procedure !== actions ||
      !passport.coordination.operations.some((o: any) => o.id === args.requestId))
    throw Error("Write not verified by reread; stop, do not retry.");
  await save("get_team-after", after);
  await save("write-receipt", { revision: after.revision, requestId: args.requestId,
    roleId: maria.id, recordId: passport.id, recordVersion: passport.version,
    rereadVerified: true, launched: false, ownerAccepted: false, response });
  const original = JSON.parse(await fs.readFile(`${dir}/DOC-TEAM-HEAD06-before.json`, "utf8"));
  const originalProfile = JSON.parse(original.text);
  const exported = { format: "talkhint.employee.acceptance-export", roleId: "head-product",
    code: "HEAD.06", name: originalProfile.visualPassport.selectedName,
    environment: "production", model: "new-country", revision: after.revision,
    managerId: maria.managerId, visualPassport: originalProfile.visualPassport,
    sourceVisualProfile: originalProfile,
    promptFromReadDocument: originalProfile.prompt ?? null,
    responsibilities: JSON.parse(passport.details.procedure), savedNativeRolePassport: passport,
    mainVisualDocumentUpdated: false, runtimeChanged: false, independentReview: "pending" };
  await save("Maria_Sobol_HEAD06", exported);
  const roadmap = JSON.parse(await fs.readFile(`${dir}/get_roadmap-before.json`, "utf8"));
  const changes = roadmap.actionRegister.filter((a: any) => a.roleId === "benchmark-role-reference")
    .map((a: any) => ({ actionId: a.id, code: a.code, title: a.name,
      currentAcceptorId: a.acceptorId, requestedAcceptorId: "head-product",
      applied: false, controllerIdsUnchanged: a.controllerIds,
      requiresExplicitReview: ["head-finance", "acquisition-role-ca-director"].includes(a.acceptorId) }));
  const nodes = [{ key: "maria", roleId: "head-product", name: "Мария Соболь", planned: false },
    ...[...spec.clients, ...spec.inputs].filter((p, i, all) => all.findIndex(t => t.key === p.key) === i)];
  const edges = [...spec.inputs.map(p => ({ from: p.key, to: "maria", result: p.result,
      source: "production_role_passport", kind: "input" })),
    ...spec.clients.map(p => ({ from: "maria", to: p.key, result: p.result,
      source: "production_role_passport", kind: "output" })),
    ...spec.clients.filter(p => p.key.startsWith("project_")).map(p => ({
      from: "benchmark", to: p.key, kind: "urgent_copy_not_acceptance",
      condition: "Только срочное по соответствующему продукту; не рассылка всем проектам.",
      source: "production_role_passport" }))];
  await save("P_BENCH_Maria_Project_leads", { format: "talkhint.product-result-relations", revision: after.revision,
    nodes, edges, urgentRule: spec.urgentRule,
    note: "Стрелки — описание передачи результатов в сохранённом паспорте, не доказательство запуска. roleId=null — будущая должность ещё не создана. Нативные acceptorId действий пока не изменены.",
    benchmarkActionChangesPendingReview: changes,
    hierarchy: team.roles.filter((r: any) => ["head-product", "benchmark-role-reference", "product-manager-specialist"].includes(r.id))
      .map((r: any) => ({ roleId: r.id, managerId: r.managerId })) });
  await save("pending-main-profile-command", { revision: after.revision, requestId: "GENERATE_NEW_UUID_AFTER_PUBLISH",
    roleId: "head-product", sourceVersion: passport.version,
    profileHash: createHash("sha256").update(original.text).digest("hex"),
    reason: "Полная анкета Марии по решению владельца; сохранить характер и портрет.",
    ownerDecisionRef: "Решение владельца: Мария Соболь HEAD.06 — полная анкета; независимая сверка отдельно." });
  console.log(JSON.stringify({ saved: true, revision: after.revision, recordId: passport.id,
    reread: true, duties: spec.duties.length, pendingBenchmarkChanges: changes.length,
    mainVisualProfileApplied: false, agentsStarted: false }));
}
main().catch(() => { console.error("Maria passport write or reread unconfirmed. Stop without retry; inspect receipts, no credentials logged."); process.exitCode = 1; });
