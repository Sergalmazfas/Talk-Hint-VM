import { createHash } from "node:crypto";
import { z } from "zod";
import profile from "../../shared/hintCallPrepProfile.json";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import type { WorkNode } from "../../shared/operatingModel";
import { ModelError } from "../projectModel/modelError";

export const hintPrepRoleId = "hint-call-prep-master";
export const hintPrepDocumentId = "DOC-HINT-CALL-PREP-MASTER";
export const hintPrepSourceHash = createHash("sha256").update(JSON.stringify(profile)).digest("hex");
export const createHintPrepRoleInput = z.object({
  revision: z.number().int().nonnegative(), requestId: z.string().uuid(),
  reason: z.string().trim().min(1).max(3000),
  ownerDecisionRef: z.string().trim().min(1).max(1000),
  sourceHash: z.literal(hintPrepSourceHash),
}).strict();

/** One fixed owner-supplied proposed role. Not an arbitrary role/profile importer. */
export function createHintPrepRole(state: ProjectModelState, raw: unknown) {
  createHintPrepRoleInput.parse(raw);
  const fail = (message: string): never => { throw new ModelError(409, message); };
  const revision = state.operatingModel?.revisions.at(-1);
  if (!revision) return fail("Структура компании отсутствует.");
  const data = structuredClone(revision.data);
  const manager = data.nodes.find(n => n.id === "product-manager-specialist" && n.kind === "role");
  // Hint-lg-qa-role in the supplied profile is the runtime agent alias.
  // The company graph's existing Foma role is lg-qa-role / P.LG.QA.
  const reviewer = data.nodes.find(n => n.id === "lg-qa-role" && n.code === "P.LG.QA" && n.kind === "role");
  if (!manager || !reviewer || manager.id === reviewer.id)
    return fail("Нужны существующие Паша и независимый проверяющий Фома.");
  const linkIds = ["line-hint-call-prep-master", "review-hint-call-prep-master"];
  if (data.nodes.some(n => n.id === hintPrepRoleId || n.code === "P.PREP") ||
      state.elements.some(e => e.id === hintPrepRoleId || e.id === hintPrepDocumentId) ||
      data.links.some(l => linkIds.includes(l.id)) ||
      state.documents.some(d => {
        if (d.id === hintPrepDocumentId || d.id === hintPrepRoleId) return true;
        try { return JSON.parse(d.text).visualPassport?.roleId === hintPrepRoleId; } catch { return false; }
      })) return fail("P.PREP или её ID уже существует; ничего не заменено.");
  const value = structuredClone(profile);
  const node: WorkNode = {
    id: hintPrepRoleId, code: "P.PREP", kind: "role", parentId: manager.parentId,
    name: profile.visualPassport.title, managerId: manager.id,
    status: "proposal", description: "Предложенная должность; Replit временно выполняет опыт вручную. Агент не подключён.",
    executorId: null, roleId: null, clientId: manager.id, acceptorId: manager.id,
    recipientId: manager.id, nextId: null, resourceIds: [], referenceIds: [],
    inputs: [], purpose: profile.mission, procedure: "", rules: "",
    constraints: profile.prohibitions.join("\n"), success: "", storage: "", delivery: "",
    exceptions: "", questions: "", resourceState: null,
    schedule: { days: [], hours: "", timezone: "", trigger: "", deadline: "" },
  };
  data.nodes.push(node);
  data.links.push(
    { id: linkIds[0], from: hintPrepRoleId, to: manager.id, kind: "accountable_to", reason: "Решение владельца: P.PREP подчиняется Паше." },
    { id: linkIds[1], from: hintPrepRoleId, to: reviewer.id, kind: "feedback", reason: "Независимая проверка результата P.PREP — Фома; приёмка Пашей, не самоприёмка." },
  );
  const commands: ModelCommand[] = [
    { type: "saveOperatingModel", baseVersion: revision.version, data },
    { type: "createDocument", id: hintPrepDocumentId, title: profile.visualPassport.title,
      text: JSON.stringify(value, null, 2), url: "", elementIds: [] },
  ];
  return { commands, roleId: hintPrepRoleId, targetId: hintPrepRoleId };
}
