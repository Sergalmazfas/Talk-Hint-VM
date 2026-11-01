import { createHash } from "node:crypto";
import { z } from "zod";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import { employeeSectionsSchema } from "../../shared/employeeSections";
import { ModelError } from "../projectModel/modelError";

const text = (max: number) => z.string().trim().min(1).max(max);
export const updateEmployeeSectionsInput = z.object({
  revision: z.number().int().nonnegative(), requestId: z.string().uuid(),
  reason: text(3000), ownerDecisionRef: text(1000), roleId: text(120),
  profileHash: z.string().regex(/^[a-f0-9]{64}$/),
  sections: employeeSectionsSchema.optional(),
  repairReportsTo: z.literal(true).optional(),
}).strict().refine(a => a.repairReportsTo || a.sections?.workplace || a.sections?.modelRecommendation,
  "Нужен хотя бы один разрешённый раздел или исправление reportsTo.");

const fail = (status: number, message: string): never => { throw new ModelError(status, message); };
export function employeeSectionCommands(state: ProjectModelState, input: unknown) {
  const a = updateEmployeeSectionsInput.parse(input);
  const nodes = state.operatingModel!.revisions.at(-1)!.data.nodes;
  const role = nodes.find(n => n.id === a.roleId && n.kind === "role");
  if (!role) return fail(404, "Существующая роль не найдена.");
  const matches = state.documents.flatMap(doc => {
    try {
      const profile = JSON.parse(doc.text);
      return profile?.visualPassport?.roleId === role.id ? [{ doc, profile }] : [];
    } catch { return []; }
  });
  if (matches.length !== 1) return fail(409, "Нужна ровно одна существующая анкета; новая не создаётся.");
  const { doc, profile } = matches[0];
  if (createHash("sha256").update(doc.text).digest("hex") !== a.profileHash)
    return fail(409, "Анкета изменилась; нужна новая сверка.");
  if (!Number.isSafeInteger(profile.version) || profile.version < 1 ||
      profile.version === Number.MAX_SAFE_INTEGER)
    return fail(409, "Версия анкеты не определена.");
  // Unknown existing fields are retained, never used as input permissions.
  if (profile.employeeSections !== undefined &&
      (!profile.employeeSections || typeof profile.employeeSections !== "object" ||
       Array.isArray(profile.employeeSections)))
    return fail(409, "Разделы анкеты повреждены; существующие данные не заменены.");
  const workplace = a.sections?.workplace;
  const references = [...(workplace?.sourceDocumentIds ?? []),
    ...(workplace?.laboratory?.documentId ? [workplace.laboratory.documentId] : [])];
  if (references.some(id => !state.documents.some(d => d.id === id)))
    return fail(400, "Документ рабочего места отсутствует в выбранной модели.");
  if (a.sections) profile.employeeSections = { ...profile.employeeSections, ...a.sections };
  if (a.repairReportsTo) {
    const manager = role.managerId ? nodes.find(n => n.id === role.managerId &&
      (n.kind === "role" || n.kind === "client")) : null;
    if (role.managerId && !manager) return fail(409, "Руководитель из текущего графа не найден.");
    const old = profile.visualPassport.reportsTo;
    if (old != null && (typeof old !== "object" || Array.isArray(old)))
      return fail(409, "Существующий reportsTo повреждён.");
    profile.visualPassport.reportsTo = manager ? {
      ...old, roleId: manager.id, roleCode: manager.code, kind: "manager",
      source: "operatingModel.nodes.managerId", status: "model_declared",
    } : null;
  }
  profile.version++;
  const commands: ModelCommand[] = [{
    type: "saveDocument", id: doc.id, title: doc.title,
    text: JSON.stringify(profile, null, 2), url: doc.url, elementIds: doc.elementIds,
  }];
  return { commands, roleId: role.id, targetId: role.id };
}
