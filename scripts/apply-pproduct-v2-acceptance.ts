/** Owner-approved documentation/model update only. Never activates a worker. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { readHypothesis, applyHypothesisCommand } from "../server/projectModel/hypotheses";
import { unpackModel } from "../server/projectModel/history";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { ProductCrewService } from "../server/productCrew/service";
import type { OperatingData } from "../shared/operatingModel";

const dir = "generated-artifacts/pproduct-v2-accepted";
const packageId = "DOC-PPRODUCT-WORK-PACKAGE";
const roleId = "product-manager-specialist";
const marker = "PPRODUCT-V2-OWNER-ACCEPTED-RECIPIENTS";
const internalLabel = "внутренний шаг, приёмка не требуется";
const authorization = "Владелец: внутренние шаги без приёмки; передачу принимает получатель; PRD.1.14 → HEAD.07/ENG.CHIEF.1; ответ лаборатории → P.LAB; PRD.1.3 → адресный поставщик. После правки применять. Запуск исполнителя не разрешён.";
const digest = (x: unknown) => createHash("sha256").update(JSON.stringify(x) ?? "undefined").digest("hex");
const append = (old: string, text: string) => `${old.trim()}\n\n${text}`.trim();
await mkdir(dir, { recursive: true });
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev DB only");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rows.length, 1);
  const owner = q.rows[0].owner_key;
  const before = readHypothesis(await unpackModel(pool, owner, q.rows[0].state), "new-country");
  assert(!before.documents.some(d => d.id === packageId), "Existing package found: reconcile instead of duplicating");
  const op = before.operatingModel!.revisions.at(-1)!;
  const data: OperatingData = structuredClone(op.data);
  const index = new Map(data.nodes.map(n => [n.id, n]));
  const source = JSON.parse(await readFile("generated-artifacts/P-PRODUCT_Hint_v2_review/P-PRODUCT_Hint_work_package_v2.json", "utf8"));
  const pkg = structuredClone(source);
  const at = new Date().toISOString();
  const node = (id: string) => { const n = index.get(id); assert(n, id); return n; };
  const internalCodes = new Set(["PRD.1.1", "PRD.1.2", "PRD.1.4", "PRD.1.5", "PRD.1.15", "PRD.1.10"]);
  const lab = "laboratory-engineer-role";
  const labReceive = "lab-action-product"; // Existing LAB.PRODUCT, extended below for reverse reply.
  const graphRoles = [
    ["laboratory-engineer-role", "lab-action-intake"],
    ["lg-technical-role", "company-action-technical-assessment"],
    ["benchmark-role-reference", "company-action-verify"],
    ["product-design-role", "management-action-ux"],
  ].map(([role, action]) => ({ roleId: node(action).roleId!, actionId: action,
    criterion: "Получатель подтверждает достаточность адресного запроса либо возвращает точный пробел",
    status: "Маршрут описан; реальной передачи/приёмки этим применением не создаётся" }));
  // Infer actual role IDs from existing receiving actions, never create a role by nickname.
  for (const route of graphRoles) node(route.roleId);
  const changes: any[] = [];
  for (const a of pkg.actions) {
    const n = node(a.id);
    assert.equal(n.kind, "action");
    assert.equal(n.roleId, a.executorRoleId, `Existing role mismatch: ${a.code}`);
    const old = { acceptingRoleId: a.acceptingRoleId, acceptingActionId: a.acceptingActionId,
      recipientActionId: a.recipientActionId, acceptanceKind: a.acceptanceKind };
    a.definitionStatus = "Описание принято владельцем после правки приёмки; исполнитель не включён";
    a.proposedClarifications = false;
    a.acceptanceEventCreated = false;
    a.continuationActionId = a.recipientActionId;
    if (internalCodes.has(a.code)) {
      a.acceptingRoleId = null; a.acceptingActionId = null;
      a.acceptanceKind = internalLabel;
      a.acceptanceRequired = false;
      a.internalCompletionCriteria = a.acceptance;
      a.acceptance = internalLabel;
      a.returnPolicy = "Обнаруженный пробел фиксируется и направляется через PRD.1.3; внутренний переход не создаёт акт самоприёмки.";
      if (a.code === "PRD.1.5") a.externalHandoffs = graphRoles;
    } else if (a.code === "PRD.1.3") {
      a.acceptingRoleId = null; a.acceptingActionId = null; a.recipientActionId = null;
      a.acceptanceKind = "Принимает конкретный адресный поставщик, не P.PRODUCT";
      a.acceptanceRequired = true;
      a.acceptanceRouting = { mode: "addressed_supplier", requiredFields: ["supplierRoleId", "receivingActionId", "caseId", "questionVersion"],
        missing: "Если поставщик/его принимающее действие не определены, адресный запрос не считать переданным или принятым",
        answerBackToActionId: "company-action-product-sufficiency" };
    } else if (a.code === "PRD.1.14") {
      a.acceptingRoleId = "head-engineering"; a.acceptingActionId = "engineering-chief-intake";
      a.recipientActionId = a.acceptingActionId; a.acceptanceRequired = true;
      a.acceptanceKind = "Получатель HEAD.07 принимает задание через ENG.CHIEF.1 либо возвращает пробел";
    } else if (a.code === "LAB.PRODUCT.RECEIVE") {
      a.acceptingRoleId = lab; a.acceptingActionId = labReceive; a.recipientActionId = labReceive;
      a.acceptanceRequired = true;
      a.acceptanceKind = "Ответ продукта принимает P.LAB; внутренняя регистрация случая отдельной приёмки не требует";
    } else if (a.code === "PRD.1.6") {
      a.acceptingRoleId = "owner"; a.acceptingActionId = null;
      a.acceptanceRequired = true; a.acceptanceKind = "Явное решение владельца по рекомендации, не самоприёмка";
    } else {
      const receiving = node(a.recipientActionId);
      a.acceptingRoleId = receiving.roleId; a.acceptingActionId = receiving.id;
      a.acceptanceRequired = true; a.acceptanceKind = "Результат принимает получатель";
    }
    if (a.code === "PRD.1.7") {
      a.externalHandoffs = [
        { resultType: "ответ лаборатории", roleId: lab, actionId: labReceive },
        { resultType: "адресный ответ другому источнику", mode: "actual_source_supplier", receivingActionRequired: true },
        { resultType: "недельный вклад", roleId: "head-product", actionId: "management-action-report-product-week" },
      ];
      a.procedure = a.procedure.replace("Час и границы недели пока не согласованы; 08:00 относится только к дневному P.OPS.",
        "Владелец согласовал недельный продуктовый блок в письме P.OPS: понедельник 08:00 America/Denver, без второго письма. Границы периода — техническое предложение, не отдельное согласование владельца; расписание не включено.");
    }
    if (a.acceptingActionId) assert.equal(node(a.acceptingActionId).roleId, a.acceptingRoleId);
    assert.notEqual(a.acceptingRoleId, roleId, `No self acceptance ${a.code}`);
    const procedure = `${a.procedure}\n\nПриёмка: ${a.acceptanceKind}. ${a.acceptanceRequired ? "Ответ получателя фиксируется только по факту; молчание не приёмка." : "Фиксируются выполнение и доказательства, не подпись самому себе."}`;
    n.procedure = append(n.procedure, `${marker}\nКонтур Hint / пакет v2.1:\n${procedure}`);
    n.purpose = a.hintPurpose;
    n.rules = append(n.rules, `Для контура Hint прежняя схема приёмки заменена этим правилом: ${a.acceptanceKind}. HEAD.06 — выборочный последующий контроль, не предварительный шлюз. ${authorization}`);
    n.success = append(n.success, a.internalCompletionCriteria ?? a.acceptance);
    n.exceptions = append(n.exceptions, a.returnPolicy);
    n.schedule.trigger = a.trigger;
    n.schedule.timezone = a.timezone;
    n.schedule.deadline = a.deadlinePolicy;
    n.storage = append(n.storage, "Тот же случай в DOC-TALKHINT-IMPROVEMENT-JOURNAL; версия и доказательства.");
    n.referenceIds = [...new Set([...n.referenceIds, packageId, "DOC-TALKHINT-IMPROVEMENT-JOURNAL"])];
    for (const input of a.inputs) {
      const supplier = index.has(input.source) && input.source !== a.id ? input.source
        : index.has(input.supplier) ? input.supplier : null;
      const name = `Hint v2.1: ${input.name}`;
      if (!n.inputs.some(i => i.name === name)) n.inputs.push({ name, sourceId: supplier,
        freshness: `Источник ${input.source}; версия/дата обязательны. ${input.missingPolicy}` });
      if (before.documents.some(d => d.id === input.source))
        n.referenceIds = [...new Set([...n.referenceIds, input.source])];
    }
    n.acceptorId = a.acceptingRoleId;
    n.recipientId = a.acceptingActionId ?? (a.acceptingRoleId === "owner" ? "owner" : a.recipientActionId);
    if (a.code === "PRD.1.3") n.clientId = null; // Supplier is selected on each actual request, never hardcode the analyst.
    else if (a.acceptingRoleId) n.clientId = a.acceptingRoleId;
    n.nextId = a.continuationActionId;
    if (a.code === "PRD.1.14") n.nextId = "engineering-chief-intake";
    n.detailState = "described";
    n.status = "agreed"; // Agreement to description only, no execution or resource grant.
    if (n.register) n.register = { ...n.register, approval: "approved",
      source: append(n.register.source, authorization), proposalReason: "Принято описание, не факт исполнения/оснащения." };
    const outputs = data.links.filter(l => l.from === n.id && l.kind === "produces").map(l => l.to);
    const origins = new Set([n.id, ...outputs]);
    // Contradicting old acceptance edges remain in the previous operating revision.
    data.links = data.links.filter(l => !(origins.has(l.from) && l.kind === "acceptance"));
    for (const id of outputs) {
      const output = node(id);
      output.acceptorId = n.acceptorId; output.recipientId = n.recipientId;
      output.clientId = n.clientId; output.nextId = n.nextId;
      output.rules = append(output.rules, `${marker}: ${a.acceptanceKind}`);
    }
    changes.push({ id: a.id, code: a.code, before: old, after: {
      acceptingRoleId: a.acceptingRoleId, acceptingActionId: a.acceptingActionId,
      recipientActionId: a.recipientActionId, acceptanceKind: a.acceptanceKind } });
  }
  const link = (from: string, to: string, kind: "handoff" | "acceptance" | "return", reason: string) => {
    node(from); node(to);
    const old = data.links.find(l => l.from === from && l.to === to && l.kind === kind);
    if (old) old.reason = append(old.reason, `${marker}: ${reason}`);
    else data.links.push({ id: `LINK-${randomUUID()}`, from, to, kind, reason: `${marker}: ${reason}` });
  };
  for (const a of pkg.actions) {
    if (a.acceptingRoleId) {
      const to = a.acceptingActionId ?? a.acceptingRoleId;
      link(a.id, to, "acceptance", a.acceptanceKind);
      if (a.acceptingActionId) link(a.id, to, "handoff", "Описание маршрута, не факт передачи/приёмки");
    }
    for (const r of a.externalHandoffs ?? []) if (r.actionId) {
      link(a.id, r.actionId, "handoff", "Условная передача конкретного результата, не общий обязательный шлюз");
      link(a.id, r.actionId, "acceptance", "Принимает реальный получатель этого результата, не P.PRODUCT");
    }
  }
  const receivingLab = node(labReceive);
  receivingLab.procedure = append(receivingLab.procedure,
    `${marker}: По обратной передаче LAB.PRODUCT.RECEIVE/PRD.1.7 принять версию продуктового ответа на свой вопрос по достаточности либо вернуть конкретное уточнение; это не приёмка внедрения и не решение QA.`);
  const role = node(roleId);
  role.purpose = pkg.role.purpose;
  role.rules = append(role.rules, `${marker}\n${authorization}\n${internalLabel}.`);
  role.referenceIds = [...new Set([...role.referenceIds, packageId])];
  role.status = "agreed";
  pkg.metadata = { ...pkg.metadata, packageRevision: 1, sourceRevision: before.revision,
    sourceJournalVersion: JSON.parse(before.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!.text).version,
    sourceOperatingModelVersion: op.version, operatingModelVersion: op.version + 1,
    snapshotAt: at, packageStatus: "v2.1 — описание принято владельцем после исправления приёмки; не включено",
    packageDocumentId: packageId, canonicalModelChanged: "Применено описание в существующую операционную модель; runtime не менялся",
    identityNote: "Тот же P.PRODUCT и существующие ID действий. Единственный канонический пакет роли; экспорт — снимок, не второй каталог." };
  pkg.authorization = { ...pkg.authorization, current: authorization,
    manualAcceptance: { at, source: "Прямое поручение владельца в чате", accepted: "v2 с правкой принимающих" },
    activationAllowed: false, activationDecision: null };
  pkg.role.assignedExecutor = role.executorId;
  pkg.role.deployed = false;
  pkg.role.authorities = pkg.role.authorities.replace("Это описание будущего исполнителя, сейчас ничего не выдано.",
    "Описание согласовано. Автономному исполнителю ресурсы и разрешение запуска не выданы.");
  for (const metric of pkg.metrics) if (["PRODUCT.PLANFACT", "PRODUCT.FIRST_ACCEPT"].includes(metric.id))
    metric.scope = "Только реальные передачи результатов другим получателям. Внутренние переходы без приёмки не входят ни в числитель, ни в знаменатель.";
  pkg.ownerQuestions = (pkg.ownerQuestions ?? []).map((q: any) => ({ ...q,
    status: "Ответ владельца ранее сохранён в журнале; разрешена подготовка, не включение" }));
  const inbox = pkg.resourceRequirements.find((r: any) => r.id === "R-INBOX");
  inbox.futureProtocol = "Подготовка ограниченного reader согласована ранее; только цепочки лаборатории. Контракт подготовлен, реализация и выдача роли отсутствуют; не читать весь Gmail.";
  inbox.preparationApproved = true;
  pkg.reviewCorrections = [...(Array.isArray(pkg.reviewCorrections) ? pkg.reviewCorrections : []),
    { at, source: "Владелец, правка пункта 1", changes }];
  const common: any = {};
  for (const key of Object.keys(pkg.actions[0])) {
    if (!["id", "code", "name"].includes(key) && pkg.actions.every((a: any) => digest(a[key]) === digest(pkg.actions[0][key])))
      common[key] = pkg.actions[0][key];
  }
  // Lossless defaults avoid duplicating the same boilerplate twelve times.
  const canonical: any = {};
  for (const key of ["format", "version", "metadata", "authorization", "role", "procedureGraph",
    "resourceRequirements", "forms", "metrics", "trialAssignment", "trialProtocol", "manualPass", "internalRequests"])
    canonical[key] = pkg[key];
  canonical.actionDefaults = common;
  canonical.actions = pkg.actions.map((a: any) => Object.fromEntries(Object.entries(a).filter(([key]) => !(key in common))));
  canonical.sourceReferences = {
    modelId: "new-country", revision: before.revision, operatingModelVersion: op.version,
    roleId, actionIds: source.sourceActions.map((a: any) => a.id),
    originalPackageSha256: digest(source), originalExport: "P-PRODUCT_Hint_v2_rev834.zip",
    documents: before.documents.filter(d => ["DOC-TALKHINT-IMPROVEMENT-JOURNAL", "DOC-TALKHINT-PRODUCT-PASSPORT",
      "DOC-TALKHINT-CHAPTER-HINT", "DOC-PLAB-WORK-PACKAGE"].includes(d.id)).map(d => ({ id: d.id, title: d.title, sha256: digest(d.text) })),
  };
  canonical.acceptanceChange = { at, source: authorization, changedActionIds: changes.map(c => c.id),
    fullDiffFile: "acceptance-diff.json", actualReceiverResponsesCreated: false };
  canonical.limitations = [...pkg.limitations, "В текущем общем сканере null acceptor может показываться как пробел. Для внутренних шагов исключение явно задано текстом; динамический поставщик PRD.1.3 обязателен в реальной передаче. UI/сканер не менялись."];
  const text = JSON.stringify(canonical);
  assert(text.length <= 50_000, `Package too large: ${text.length}`);
  await writeFile(`${dir}/package-v2.1.json`, JSON.stringify(pkg, null, 2));
  await writeFile(`${dir}/canonical-package.json`, JSON.stringify(canonical, null, 2));
  await writeFile(`${dir}/acceptance-diff.json`, JSON.stringify(changes, null, 2));
  await writeFile(`${dir}/before-model.json`, JSON.stringify(before));
  if (!process.argv.includes("--apply-owner-approved")) {
    console.log(JSON.stringify({ dryRun: true, sourceRevision: before.revision, packageChars: text.length, changes }));
  } else {
    await persistModelUpdate(pool, owner, root => {
      const m = readHypothesis(root, "new-country");
      assert.equal(m.revision, before.revision, "Model changed; reconcile before application");
      const actor = "P.PRODUCT / HEAD.07: применение v2.1 по прямому поручению владельца, без включения";
      assert(m.elements.some(e => e.id === "TH-PRODUCT"));
      let next = applyHypothesisCommand(root, "new-country", { type: "createDocument", id: packageId,
        title: "P.PRODUCT — Hint — рабочий JSON v2.1 — описание принято, исполнитель выключен",
        url: "", text, elementIds: ["TH-PRODUCT"] }, actor);
      next = applyHypothesisCommand(next, "new-country", { type: "saveOperatingModel", baseVersion: op.version, data }, actor);
      const d = m.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
      const j = JSON.parse(d.text);
      const event = { at, marker, role: "P.PRODUCT", source: authorization, packageId,
        previousOperatingVersion: op.version, operatingVersion: op.version + 1,
        actionIds: pkg.actions.map((a: any) => a.id), actualReceiverResponsesCreated: false,
        activationAllowed: false, runtimeChanged: false };
      j.history.push(event); j.version++;
      j.ownerDecisions ??= [];
      j.ownerDecisions.push({ id: "PRODUCT.PACKAGE.V2.ACCEPTANCE", ...event, status: "Принято описание с правкой; применено, не включено" });
      next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: d.id,
        title: `TalkHint — журнал улучшений — v${j.version} — принят пакет P.PRODUCT`,
        url: d.url, text: JSON.stringify(j), elementIds: d.elementIds }, actor);
      const updated = readHypothesis(next, "new-country");
      assert.deepEqual(updated.operatingModel!.revisions.slice(0, -1), m.operatingModel!.revisions);
      for (const key of ["competitorDirectory", "elements", "proposals", "relations", "taskDrafts"] as const)
        assert.deepEqual(updated[key], m[key]);
      assert.equal(updated.operatingModel!.revisions.at(-1)!.data.nodes.length, op.data.nodes.length);
      return next;
    }, true);
    const q2 = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
    const after = readHypothesis(await unpackModel(pool, owner, q2.rows[0].state), "new-country");
    const svc = new ProductCrewService({ read: async () => after, update: async () => { throw Error("Read only"); } });
    const readback = await svc.call(owner, "get_document", { documentId: packageId });
    assert.equal(readback.text, text);
    const current = after.operatingModel!.revisions.at(-1)!;
    const changedIds = new Set([...pkg.actions.map((a: any) => a.id), roleId, labReceive,
      ...op.data.links.filter(l => l.kind === "produces" && pkg.actions.some((a: any) => a.id === l.from)).map(l => l.to)]);
    for (const old of op.data.nodes) {
      const now = current.data.nodes.find(n => n.id === old.id)!;
      if (!changedIds.has(old.id)) assert.deepEqual(now, old, `Unrelated node ${old.id}`);
      assert.equal(now.executorId, old.executorId, `Executor changed ${old.id}`);
      assert.deepEqual(now.resourceIds, old.resourceIds, `Resource grant changed ${old.id}`);
    }
    for (const old of before.documents) if (old.id !== "DOC-TALKHINT-IMPROVEMENT-JOURNAL")
      assert.deepEqual(after.documents.find(d => d.id === old.id), old, `Unrelated document ${old.id}`);
    assert.equal(current.data.nodes.filter(n => n.kind === "action" && n.roleId === roleId).length, source.sourceActions.length);
    await writeFile(`${dir}/after-model.json`, JSON.stringify(after));
    pkg.metadata.appliedRevision = after.revision;
    pkg.sourceRole = current.data.nodes.find(n => n.id === roleId);
    pkg.sourceActions = current.data.nodes.filter(n => n.kind === "action" && n.roleId === roleId);
    const scope = new Set([roleId, ...pkg.sourceActions.map((a: any) => a.id)]);
    pkg.sourceRelations = current.data.links.filter(l => scope.has(l.from) || scope.has(l.to));
    pkg.receivingActions = (pkg.receivingActions ?? []).map((n: any) => current.data.nodes.find(x => x.id === n.id) ?? n);
    pkg.sourceDocuments = (pkg.sourceDocuments ?? []).map((old: any) => {
      const d = after.documents.find(d => d.id === old.id);
      return d ? { id: d.id, title: d.title, url: d.url, sha256: digest(d.text), content: { text: d.text } } : old;
    });
    await writeFile(`${dir}/package-v2.1.json`, JSON.stringify(pkg, null, 2));
    await writeFile(`${dir}/APPLICATION_RESULT.json`, JSON.stringify({
      sourceRevision: before.revision, finalRevision: after.revision,
      operatingModelVersion: current.version, journalVersion: JSON.parse(after.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!.text).version,
      packageId, packageVersion: "2.1", proceduresApplied: pkg.actions.length,
      roleActionIdsPreserved: true, operatingHistoryPreserved: true, unrelatedNodesPreserved: true,
      unrelatedDocumentsPreserved: true, resourceGrantsUnchanged: true, executorAssignmentsUnchanged: true,
      readerVerified: true, activationAllowed: false, runtimeChanged: false,
      realHandoffAcceptancesCreated: false,
    }, null, 2));
    console.log(await readFile(`${dir}/APPLICATION_RESULT.json`, "utf8"));
  }
} finally { await pool.end(); }
