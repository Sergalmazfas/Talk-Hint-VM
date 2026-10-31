import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import type { WorkNode } from "../../shared/operatingModel";
import { SECRETARY_DEPARTMENT_DOCUMENT, secretaryDepartmentRoles,
  secretaryDepartmentSchema, type SecretaryDepartmentStructure } from "../../shared/secretaryDepartment";
import { ModelError } from "../projectModel/modelError";

const fail = (message: string): never => { throw new ModelError(409, message); };
export function secretaryDepartment(documents: { id: string; text: string }[],
  nodes: Pick<WorkNode, "id" | "kind" | "managerId">[]): SecretaryDepartmentStructure | null {
  const docs = documents.filter(d => d.id === SECRETARY_DEPARTMENT_DOCUMENT);
  if (!docs.length) return null;
  if (docs.length !== 1) return fail("Несколько описаний структуры отдела; нужна сверка.");
  let department: SecretaryDepartmentStructure;
  try { department = secretaryDepartmentSchema.parse(JSON.parse(docs[0].text)); }
  catch { return fail("Структура отдела Секретарь повреждена; каталог не подставлен."); }
  for (const r of secretaryDepartmentRoles) {
    if (!nodes.some(n => n.id === r.id && n.kind === "role" && n.managerId === r.managerId))
      return fail("Связи отдела отличаются от сохранённой структуры; нужна сверка.");
  }
  return department;
}

/** Pure, fixed stage-1 macro. No provider, runtime agent, number or working prompt access. */
export function createSecretaryDepartment(state: ProjectModelState,
  projectionDocumentId: string, validatedAssignments: { projectionId: string; managerId: string }[]) {
  const revision = state.operatingModel!.revisions.at(-1)!;
  const data = structuredClone(revision.data);
  const maria = data.nodes.find(n => n.id === "head-product" && n.kind === "role" && n.code === "HEAD.06");
  if (!maria || maria.managerId !== "owner") return fail("Нужна существующая Мария HEAD.06 под владельцем.");
  if (state.documents.some(d => d.id === SECRETARY_DEPARTMENT_DOCUMENT))
    return fail("Структура отдела уже существует: перечитайте get_team, не создавайте повторно.");
  if (data.nodes.some(n => n.id === "employee-katya"))
    return fail("Есть нативная карточка Кати; сначала сверка, вторая карточка не создаётся.");
  // An already-created Secretary lead must not be replaced or shadowed.
  for (const doc of state.documents) {
    let p: any; try { p = JSON.parse(doc.text); } catch { continue; }
    if (p.mode === "secretary" && data.nodes.some(n => n.kind === "role" &&
      n.id === p.visualPassport?.roleId && n.managerId === maria.id))
      return fail("У Марии уже есть роль проекта Секретарь; нужен отдельный diff, не дубль.");
  }
  const used = new Set([...data.nodes, ...data.links, ...state.elements, ...state.documents].map(n => n.id));
  const reserved = secretaryDepartmentRoles.flatMap(r => [r.id, `DOC-PLANNED-${r.id}`, `line-${r.id}`]);
  reserved.push(SECRETARY_DEPARTMENT_DOCUMENT, "secretary-slot-work", "secretary-slot-personal");
  if (reserved.some(id => used.has(id)) || data.nodes.some(n => secretaryDepartmentRoles.some(r => r.code === n.code)))
    return fail("ID/код роли, анкеты или слота уже занят; существующее не заменено.");
  const commands: ModelCommand[] = [];
  for (const r of secretaryDepartmentRoles) {
    const node: WorkNode = {
      id: r.id, code: r.code, name: r.title, kind: "role", parentId: maria.parentId,
      managerId: r.managerId, status: "proposal",
      description: "Пустая должность отдела Секретарь. Имя предложено, не принято. Действия — отдельный этап.",
      purpose: "", clientId: null, roleId: null, executorId: null, recipientId: null,
      acceptorId: null, nextId: null, resourceIds: [], inputs: [],
      schedule: { days: [], hours: "", timezone: "", trigger: "", deadline: "" },
      procedure: "", rules: "", constraints: "", success: "", storage: "", delivery: "",
      exceptions: "", questions: "Обязанности, ресурсы, метрики и подключение ещё не утверждены.",
      resourceState: null, referenceIds: [],
    };
    data.nodes.push(node);
    data.links.push({ id: `line-${r.id}`, from: r.id, to: r.managerId, kind: "accountable_to",
      reason: "Решение владельца: только структура отдела Секретарь; имя proposed, работа не включена." });
    commands.push({ type: "createDocument", id: `DOC-PLANNED-${r.id}`, title: r.title, url: "", elementIds: [],
      text: JSON.stringify({ format: "talkhint.employee.profile", version: 1, mode: "secretary",
        plannedRole: true, status: "planned", knowledgeBookDocumentId: null, promptDocumentId: null,
        visualPassport: { roleId: r.id, position: r.title, selectedName: null,
          ownerSelectionStatus: "not_selected", nameProposal: { value: r.proposedName, status: "proposed" },
          character: { traits: [null, null, null], motto: null }, portrait: { asset: null } } }) });
  }
  const department = secretaryDepartmentSchema.parse({
    format: "talkhint.secretary.department-structure", version: 1, stage: "structure_only",
    managerId: secretaryDepartmentRoles[0].id,
    roles: { projectHeadId: secretaryDepartmentRoles[0].id, labEngineerId: secretaryDepartmentRoles[1].id,
      qaId: secretaryDepartmentRoles[2].id },
    catalog: { source: "existing_secretary_personalities", members: [
      { key: "katya", label: "Катя", runtimeProjectionId: "employee-katya",
        personaRef: null, ownerReportedPersonaVersion: 2, referencesStatus: "unresolved",
        knowledgeBookDocumentId: null, promptDocumentId: null }],
      vacancies: [
        { id: "secretary-slot-work", usage: "work_phone", label: "Будущий секретарь — рабочий телефон",
          knowledgeBookDocumentId: null, promptDocumentId: null },
        { id: "secretary-slot-personal", usage: "personal_phone", label: "Будущий секретарь — личный телефон",
          knowledgeBookDocumentId: null, promptDocumentId: null },
      ] },
  });
  const previous = state.documents.find(d => d.id === projectionDocumentId);
  // validatedAssignments came from the existing fail-closed projectionManagers parser.
  if (validatedAssignments.some(a => a.projectionId !== "employee-katya"))
    return fail("Неподдерживаемая проекция; чужие связи не заменены.");
  if (previous && (!Number.isSafeInteger(JSON.parse(previous.text).version) || JSON.parse(previous.text).version < 1))
    return fail("Версия прежней связи Кати не подтверждена; нужна сверка.");
  const managerDocument = { format: "talkhint.team.projection-managers",
    version: previous ? JSON.parse(previous.text).version + 1 : 1,
    assignments: [{ projectionId: "employee-katya", managerId: department.managerId }] };
  commands.unshift({ type: "saveOperatingModel", baseVersion: revision.version, data });
  commands.push({ type: "createDocument", id: SECRETARY_DEPARTMENT_DOCUMENT,
    title: "Секретарь — структура отдела и ссылки каталога", text: JSON.stringify(department, null, 2),
    url: "", elementIds: [] });
  commands.push({ type: previous ? "saveDocument" : "createDocument", id: projectionDocumentId,
    title: previous?.title ?? "Руководитель существующей проекции Кати",
    text: JSON.stringify(managerDocument, null, 2), url: previous?.url ?? "", elementIds: previous?.elementIds ?? [] });
  return { commands, roleId: department.managerId, targetId: SECRETARY_DEPARTMENT_DOCUMENT };
}
