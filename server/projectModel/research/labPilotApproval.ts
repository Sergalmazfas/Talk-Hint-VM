/** Records explicit owner acceptance. Does not enable a worker or mail. */
import assert from "node:assert/strict";
import type { ProjectModelState } from "../../../shared/projectModel";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { labPacketId, labRoleId } from "./labRole";

export const pilotId = "DOC-PLAB-RUNTIME-PILOT";
export function acceptLabPilot(root: ProjectModelState, now: string, runtimeStatus: object) {
  const state = readHypothesis(root, "new-country");
  const doc = state.documents.find(d => d.id === labPacketId);
  assert.ok(doc, "Existing packet required");
  const packet = JSON.parse(doc.text);
  assert.equal(packet.version, 2);
  const last = state.operatingModel!.revisions.at(-1)!;
  const data = structuredClone(last.data);
  const qa = data.nodes.find(n => n.code === "LAB.QA")!;
  const head = data.nodes.find(n => n.code === "HEAD.07")!;
  assert.ok(qa && head && data.nodes.find(n => n.id === labRoleId));
  const oldAcceptor = qa.acceptorId;
  qa.acceptorId = head.id;
  qa.success = "HEAD.07 — выборочный последующий контроль протокола QA; письмо не ждёт этой приёмки. Outbox не принимает решения QA.";
  qa.procedure += "\nУточнение владельца после сверки v2: принимающий HEAD.07, не P.OPS. Его контроль последующий и выборочный; outbox только транспорт.";
  for (const link of data.links.filter(l => l.from === qa.id && l.kind === "acceptance")) {
    link.to = head.id;
    link.id = `lab:acceptance:${qa.id}:${head.id}`;
    link.reason = qa.success;
  }
  const savedQa = packet.actions.find((a: any) => a.id === qa.id);
  assert.ok(savedQa);
  savedQa.acceptorId = head.id;
  savedQa.success = qa.success;
  savedQa.procedure = qa.procedure;
  packet.ownerAcceptance = { at: now, verdict: "P.LAB v2 rev777 принята; все 11 замечаний закрыты",
    correction: "LAB.QA принимающий HEAD.07, выборочно после факта; не P.OPS",
    scope: "Разрешены self-hosted CrewAI, существующий ключ, agent-1/agent-2 и подготовка исходящей почты. Сейчас Hint/владелец/read-only.",
    transportUpdate: "Владелец отказался от регистрации SendGrid: проверить встроенную почту, затем Gmail OAuth, затем Twilio login. Письмо синтетического прохода — файл." };
  packet.gate = { ...packet.gate, jsonManualPass: "v2 принята владельцем с указанной поправкой",
    installationAllowed: true, workerStarted: false, mailEnabled: false };
  packet.metadata.stage = "Описание принято; установка и синтетический пилот отдельно от реального контура";
  packet.runtimeStatusDocumentId = pilotId;
  let next = applyHypothesisCommand(root, "new-country", { type: "saveOperatingModel", baseVersion: last.version, data },
    "Сергей: v2 принята; LAB.QA → HEAD.07, не outbox. Replit: только установка/синтетика");
  const existing = state.documents.find(d => d.id === pilotId);
  next = applyHypothesisCommand(next, "new-country", { type: existing ? "saveDocument" : "createDocument",
    id: pilotId, title: "P.LAB — установка CrewAI и синтетическая проверка", text: JSON.stringify({
      ...runtimeStatus, at: now, source: "Ручная Dev-работа Replit по явному разрешению владельца",
      privateDataIncluded: false, acceptorCorrection: { from: oldAcceptor, to: head.id },
      blockers: ["Gmail OAuth ещё не подключён; отправка не проверена",
        "Событийная очередь/outbox, owner binding и read-only источник ещё не включены",
        "Не проверена реальная цепочка iPhone → завершение Hint → Gmail"],
      deployReady: false, realCallRequested: false, productionPublished: false,
    }), url: "", elementIds: [] }, "Replit: фактический статус установки, не ложная готовность production");
  packet.metadata.sourceRevision = readHypothesis(next, "new-country").revision + 1;
  next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: doc.id,
    title: "P.LAB — рабочий JSON v2 — принято владельцем; runtime отдельно", text: JSON.stringify(packet),
    url: doc.url, elementIds: doc.elementIds }, "Сергей: явная приёмка v2 и допуск установки; почта ещё не подключена");
  return next;
}
