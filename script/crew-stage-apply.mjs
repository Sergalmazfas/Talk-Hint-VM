// Scoped owner-approved edits only. Every write gets a fresh read and a receipt
// read; ambiguous outcomes stop the run, never trigger a retransmission.
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { callProductionMcp } from "./product-crew-production-mcp.mjs";
const dir = "generated-artifacts/crew-stage";
const decision = "Решение владельца: Правила v3, этап Команда Hint и отдел кадров, 2026-10-31; текущий запрос, без запуска и самоприёмки.";
const call = async (name, args) => (await callProductionMcp("tools/call", { name, arguments: args })).structuredContent.result;
const changes = [
  ["update_structure", { nodeId: "head-product", managerId: "owner" }],
  ["update_structure", { nodeId: "product-manager-specialist", managerId: "head-product" }],
  ["update_structure", { nodeId: "laboratory-engineer-role", managerId: "product-manager-specialist" }],
  ["update_structure", { nodeId: "lg-qa-role", managerId: "product-manager-specialist" }],
  ["update_structure", { nodeId: "proposal-4fe46862-f07e-562b-b6d7-4ab34716a545", managerId: "owner" }],
  ["update_team_character", { roleId: "product-manager-specialist",
    traits: ["держит фокус на одном продукте", "превращает жалобы в задачи", 'доводит до "было → стало"'],
    motto: "Каждый звонок лучше прошлого" }],
  ["update_team_character", { roleId: "management-role-operations-specialist",
    traits: ["тихий, но ничего не пропускает", "пунктуальный, всё по расписанию", "будит только по делу"],
    motto: "Тишина — значит, всё работает" }],
  ...["legal-action-product-context-intake", "legal-action-product-list-intake",
    "legal-action-product-list-receive", "legal-action-product-requirements-receive",
    "company-action-criteria", "company-action-owner-competitor-test"].map(nodeId =>
    ["update_structure", { nodeId, acceptorId: "head-product" }]),
  ["update_structure", { nodeId: "legal-action-qa-intake", acceptorId: "product-manager-specialist" }],
];
const receipts = JSON.parse(await fs.readFile(`${dir}/receipts.json`, "utf8").catch(() => "[]"));
const pending = JSON.parse(await fs.readFile(`${dir}/pending-operation.json`, "utf8").catch(() => "null"));
if (pending && !receipts.some(r => r.args.requestId === pending.args.requestId))
  throw Error("An earlier operation is unconfirmed; reconcile by read before continuing.");
let current = await call("get_team", {});
let revision = current.revision;
for (const [name, fields] of changes) {
  const prior = receipts.find(r => r.name === name &&
    Object.entries(fields).every(([k, v]) => JSON.stringify(r.args[k]) === JSON.stringify(v)));
  if (prior) continue; // Resume only already verified operations, never resend.
  const requestId = randomUUID();
  const args = { ...fields, revision, requestId,
    reason: fields.acceptorId ? "Отделить принимающего от исполнителя: проверяет руководитель соответствующей роли." :
      name === "update_team_character" ? "Утверждённые владельцем три черты и девиз." : "Утверждённая владельцем линия подчинения.",
    ownerDecisionRef: decision };
  await fs.writeFile(`${dir}/pending-operation.json`, JSON.stringify({ name, args }, null, 2));
  let receipt;
  try { receipt = await call(name, args); }
  catch {
    // Do not resend: even a timeout can mean the transaction committed.
    const after = await call("get_team", {});
    await fs.writeFile(`${dir}/team-after-ambiguous.json`, JSON.stringify(after, null, 2));
    console.log(JSON.stringify({ stopped: true, requestId, name, revision: after.revision, outcome: "unconfirmed_no_retry" }));
    break;
  }
  if (fields.managerId) {
    current = await call("get_team", {});
    revision = current.revision;
    if (current.roles.find(r => r.id === fields.nodeId)?.managerId !== fields.managerId)
      throw Error("Manager reread mismatch; stopped.");
    await fs.writeFile(`${dir}/team-after.json`, JSON.stringify(current, null, 2));
  }
  if (name === "update_team_character") {
    const docId = fields.roleId === "product-manager-specialist" ? "DOC-TEAM-PPRODUCT" : "DOC-TEAM-POPS";
    const doc = await call("get_document", { documentId: docId });
    revision = doc.revision;
    const character = JSON.parse(doc.text).visualPassport.character;
    if (JSON.stringify(character.traits) !== JSON.stringify(fields.traits) || character.motto !== fields.motto)
      throw Error("Character reread mismatch; stopped.");
    await fs.writeFile(`${dir}/documents/${docId}.json`, JSON.stringify(doc, null, 2));
  }
  if (fields.acceptorId) {
    const roadmap = await call("get_roadmap", {});
    revision = roadmap.revision;
    if (roadmap.actionRegister.find(a => a.id === fields.nodeId)?.acceptorId !== fields.acceptorId)
      throw Error("Acceptor reread mismatch; stopped.");
    await fs.writeFile(`${dir}/roadmap-after.json`, JSON.stringify(roadmap, null, 2));
  }
  if (revision < receipt.revision) throw Error("Reread revision mismatch; stopped.");
  receipts.push({ name, args, receipt, rereadRevision: revision });
  await fs.writeFile(`${dir}/receipts.json`, JSON.stringify(receipts, null, 2));
  console.log(JSON.stringify({ saved: true, name, id: fields.nodeId ?? fields.roleId, revision, reread: true }));
}
