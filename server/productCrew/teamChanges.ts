import { createHash } from "node:crypto";
import { z } from "zod";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import type { WorkNode } from "../../shared/operatingModel";
import { ModelError } from "../projectModel/modelError";
import { competitorSnapshotSchema } from "../projectModel/competitorSchema";
import { mariaProfileCommands } from "./mariaPassport";
import { createSecretaryDepartment } from "./secretaryDepartment";

const text = (n: number) => z.string().trim().min(1).max(n);
const key = text(120);
const mode = z.enum(["company", "hint", "secretary", "copilot", "translator"]);
const base = { revision: z.number().int().min(0), requestId: z.string().uuid(),
  reason: text(3000), ownerDecisionRef: text(1000) };
export const teamChangeInputs = {
  create_secretary_department_structure: z.object({ ...base }).strict(),
  update_maria_profile: z.object({ ...base, roleId: z.enum(["head-product"]),
    sourceVersion: z.number().int().min(1),
    profileHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  create_planned_role: z.object({ ...base, id: key, title: text(240),
    mode: z.enum(["secretary", "copilot", "translator"]), managerId: key }).strict(),
  update_role_title: z.object({ ...base, roleId: key, title: text(240), mode }).strict(),
  set_projection_manager: z.object({ ...base, projectionId: z.enum(["employee-katya"]), managerId: key }).strict(),
  replace_employee_profile: z.object({ ...base, roleId: key, sourceDocumentId: key,
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/), targetHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  add_competitor: z.object({ ...base, snapshotJson: text(40000) }).strict(),
};
export const projectionManagersDocument = "DOC-TEAM-PROJECTION-MANAGERS";
const ninaRole = "proposal-4fe46862-f07e-562b-b6d7-4ab34716a545";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const fail = (status: number, message: string): never => { throw new ModelError(status, message); };
function parse(text: string): any {
  try { return JSON.parse(text); } catch { return fail(400, "Нужен JSON-документ установленного формата."); }
}
export function projectionManagers(documents: ProjectModelState["documents"]) {
  const doc = documents.find(d => d.id === projectionManagersDocument);
  if (!doc) return [];
  const value = parse(doc.text);
  if (value.format !== "talkhint.team.projection-managers" || !Number.isSafeInteger(value.version) ||
      !Array.isArray(value.assignments) || value.assignments.length > 1 ||
      value.assignments.some((a: any) => a.projectionId !== "employee-katya" || typeof a.managerId !== "string"))
    return fail(409, "Документ руководителей проекций повреждён; связь не подставлена.");
  return value.assignments as { projectionId: string; managerId: string }[];
}
/** Pure command builder. No storage, provider calls, activation or arbitrary patches. */
export function buildTeamChange(state: ProjectModelState, name: keyof typeof teamChangeInputs, a: any) {
  if (name === "create_secretary_department_structure")
    return createSecretaryDepartment(state, projectionManagersDocument, projectionManagers(state.documents));
  if (name === "update_maria_profile") return mariaProfileCommands(state, a);
  const revision = state.operatingModel!.revisions.at(-1)!;
  const data = structuredClone(revision.data);
  const commands: ModelCommand[] = [];
  const role = (id: string) => data.nodes.find(n => n.id === id && n.kind === "role")
    ?? fail(400, "Существующая роль не найдена.");
  const profiles = (id: string) => state.documents.filter(d => {
    try { return JSON.parse(d.text).visualPassport?.roleId === id; } catch { return false; }
  });
  const profile = (id: string) => {
    const found = profiles(id);
    if (found.length !== 1) return fail(409, "Нужна одна существующая анкета роли.");
    const value = parse(found[0].text);
    if (!Number.isSafeInteger(value.version) || value.version < 1)
      return fail(409, "Версия анкеты не определена.");
    return { doc: found[0], value };
  };
  const saveProfile = (doc: ProjectModelState["documents"][number], value: any) =>
    commands.push({ type: "saveDocument", id: doc.id, title: doc.title,
      text: JSON.stringify(value, null, 2), url: doc.url, elementIds: doc.elementIds });
  const saveGraph = () => commands.push({ type: "saveOperatingModel", baseVersion: revision.version, data });
  let roleId = "head-product", targetId: string;
  if (name === "create_planned_role") {
    if (!/^[a-z][a-z0-9-]{2,100}$/.test(a.id)) return fail(400, "Нужен стабильный ID роли.");
    if (data.nodes.some(n => n.id === a.id) || state.elements.some(e => e.id === a.id) ||
        state.documents.some(d => d.id === a.id)) return fail(409, "ID уже занят; существующее не заменено.");
    const manager = role(a.managerId);
    if (manager.id !== "head-product") return fail(400, "Будущие проекты подчиняются руководителю продукта.");
    if (state.documents.some(d => {
      try { const p = JSON.parse(d.text); return p.plannedRole === true && p.mode === a.mode; } catch { return false; }
    })) return fail(409, "Пустая должность этого режима уже существует.");
    const docId = `DOC-PLANNED-${a.id}`;
    if (state.documents.some(d => d.id === docId)) return fail(409, "ID анкеты уже занят.");
    const node: WorkNode = { id: a.id, code: `PLAN.${a.mode.toUpperCase()}`, name: a.title,
      kind: "role", parentId: manager.parentId, managerId: manager.id, status: "proposal",
      description: "Пустая будущая должность. Исполнитель не назначен и не подключён.",
      purpose: "", clientId: null, roleId: null, executorId: null, recipientId: null,
      acceptorId: null, nextId: null, resourceIds: [], inputs: [],
      schedule: { days: [], hours: "", timezone: "", trigger: "", deadline: "" },
      procedure: "", rules: "", constraints: "", success: "", storage: "", delivery: "",
      exceptions: "", questions: "Сотрудник и обязанности ещё не определены.",
      resourceState: null, referenceIds: [] };
    if (data.nodes.some(n => n.code === node.code)) return fail(409, "Код должности уже существует.");
    data.nodes.push(node);
    data.links.push({ id: `line-${a.id}`, from: a.id, to: manager.id, kind: "accountable_to", reason: a.reason });
    if (revision.data.links.some(l => l.id === `line-${a.id}`)) return fail(409, "ID связи уже занят.");
    saveGraph();
    commands.push({ type: "createDocument", id: docId, title: a.title, url: "", elementIds: [],
      text: JSON.stringify({ format: "talkhint.employee.profile", version: 1, mode: a.mode,
        plannedRole: true, status: "planned", visualPassport: { roleId: a.id, position: a.title,
          selectedName: null, ownerSelectionStatus: "not_selected",
          character: { traits: [null, null, null], motto: null }, portrait: { asset: null } } }) });
    roleId = targetId = a.id;
  } else if (name === "update_role_title") {
    const selected = role(a.roleId);
    const p = profile(a.roleId);
    if (p.value.plannedRole === true && state.documents.some(d => {
      if (d.id === p.doc.id) return false;
      try { const other = JSON.parse(d.text); return other.plannedRole === true && other.mode === a.mode; } catch { return false; }
    })) return fail(409, "Пустая должность этого режима уже существует.");
    if (a.mode !== "secretary" && projectionManagers(state.documents).some(v => v.managerId === a.roleId))
      return fail(409, "Нельзя убрать режим Секретарь у руководителя Кати.");
    selected.name = a.title; p.value.visualPassport.position = a.title;
    p.value.mode = a.mode; p.value.version++;
    saveGraph(); saveProfile(p.doc, p.value);
    roleId = targetId = selected.id;
  } else if (name === "set_projection_manager") {
    const manager = role(a.managerId), p = profile(manager.id);
    if (p.value.mode !== "secretary" || manager.managerId !== "head-product" || manager.id === a.projectionId)
      return fail(400, "Катя подчиняется руководителю проекта Секретарь под Марией.");
    const assignments = projectionManagers(state.documents);
    const old = state.documents.find(d => d.id === projectionManagersDocument);
    const value = { format: "talkhint.team.projection-managers",
      version: old ? parse(old.text).version + 1 : 1,
      assignments: [{ projectionId: a.projectionId, managerId: manager.id }] };
    // Read/validate the old format before replacing the one supported assignment.
    void assignments;
    commands.push({ type: old ? "saveDocument" : "createDocument", id: projectionManagersDocument,
      title: "Руководитель живой карточки Кати", text: JSON.stringify(value, null, 2),
      url: "", elementIds: old?.elementIds ?? [] });
    roleId = manager.id; targetId = a.projectionId;
  } else if (name === "replace_employee_profile") {
    const selected = role(a.roleId);
    if (selected.id !== ninaRole || selected.code !== "P.ORG")
      return fail(403, "В этом проходе разрешена только Нина v2 в существующей P.ORG.");
    const source = state.documents.find(d => d.id === a.sourceDocumentId);
    const target = state.documents.find(d => d.id === "DOC-PORG-OPERATING-PASSPORT");
    if (!source || !target) return fail(404, "Источник или основная анкета не найдены.");
    if (digest(source.text) !== a.sourceHash || digest(target.text) !== a.targetHash)
      return fail(409, "Текст источника или анкеты изменился; нужна новая сверка.");
    const nina = parse(source.text).documents?.["nina-v2"];
    if (nina?.format !== "talkhint.employee.profile" || nina.version !== 2 ||
        nina.resolvedRoleId !== selected.id || nina.employee?.code !== "P.ORG" ||
        nina.activation !== false || nina.employee?.character?.traits?.length !== 3)
      return fail(400, "Нужен сохранённый документ Нины v2 без подключения.");
    if (profiles(selected.id).some(d => d.id !== target.id))
      return fail(409, "Найдена другая анкета P.ORG; дубли не создаются.");
    const employee = nina.employee;
    // Source remains intact; promptDraft is not a runtime prompt or executable configuration.
    const value = { format: nina.format, version: 1, sourceVersion: 2, mode: "company",
      status: "described_not_connected", sourceDocumentId: source.id, sourceHash: a.sourceHash,
      sourceProfile: nina, visualPassport: { roleId: selected.id, selectedName: employee.name,
        ownerSelectionStatus: employee.nameStatus, position: employee.position,
        character: employee.character, portrait: { asset: null, image: employee.portrait?.file ?? null } },
      prohibitions: nina.prohibitions, duties: nina.duties, clients: nina.clients,
      promptDraft: nina.promptDraft, runtimeChanged: false };
    let previous: any;
    try { previous = JSON.parse(target.text); } catch { /* Previous Markdown stays in model history. */ }
    if (previous) {
      if (!Number.isSafeInteger(previous.version)) return fail(409, "Версия старой анкеты не определена.");
      value.version = previous.version + 1;
    }
    saveProfile(target, value);
    roleId = targetId = selected.id;
  } else {
    const checked = competitorSnapshotSchema.safeParse(parse(a.snapshotJson));
    if (!checked.success) return fail(400, "Снимок конкурента не соответствует схеме каталога.");
    const snapshot = checked.data;
    if (snapshot.verification !== "provided" || JSON.stringify(snapshot).includes('"live_verified"'))
      return fail(400, "Этот инструмент добавляет переданные сведения, не подтверждает живую проверку.");
    const host = (s: string) => new URL(s).hostname.toLowerCase().replace(/^www\./, "");
    if (state.competitorDirectory?.records.some(r => {
      const p = r.revisions.at(-1)?.snapshot;
      return p && (host(p.website) === host(snapshot.website) || p.name.trim().toLowerCase() === snapshot.name.trim().toLowerCase());
    })) return fail(409, "Конкурент уже есть; новая карточка не создана.");
    role(roleId);
    commands.push({ type: "saveCompetitor", baseVersion: 0, reason: `${a.reason}; ${a.ownerDecisionRef}`, snapshot });
    targetId = "TH-PILOT-COMPETITORS";
  }
  return { commands, roleId, targetId };
}
