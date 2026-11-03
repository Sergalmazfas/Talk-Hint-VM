import { createHash } from "node:crypto";
import { z } from "zod";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import { ModelError } from "../projectModel/modelError";

const names = {
  "secretary-project-head": "Сева Секретарев",
  "secretary-lab-engineer": "Лёва Секретарев",
  "secretary-qa": "Тома Секретарева",
} as const;
export const approveSecretaryNameInput = z.object({
  revision: z.number().int().nonnegative(), requestId: z.string().uuid(),
  roleId: z.enum(["secretary-project-head", "secretary-lab-engineer", "secretary-qa"]),
  profileHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(1).max(3000),
  ownerDecisionRef: z.string().trim().min(1).max(1000),
}).strict();

/** Fixed prior owner decision, not a general employee/profile/name editor. */
export function approveSecretaryNameCommands(state: ProjectModelState, input: unknown) {
  const a = approveSecretaryNameInput.parse(input);
  const fail = (message: string): never => { throw new ModelError(409, message); };
  if (!state.operatingModel?.revisions.at(-1)?.data.nodes.some(n => n.id === a.roleId && n.kind === "role"))
    return fail("Существующая роль Секретаря не найдена.");
  const found = state.documents.flatMap(doc => {
    try {
      const profile = JSON.parse(doc.text);
      return profile?.visualPassport?.roleId === a.roleId ? [{ doc, profile }] : [];
    } catch { return []; }
  });
  if (found.length !== 1) return fail("Нужна ровно одна существующая анкета Секретаря.");
  const { doc, profile } = found[0];
  if (createHash("sha256").update(doc.text).digest("hex") !== a.profileHash)
    return fail("Анкета изменилась; нужна новая сверка.");
  const v = profile.visualPassport;
  if (profile.format !== "talkhint.employee.profile" || !Number.isSafeInteger(profile.version) ||
      profile.version < 1 || profile.version === Number.MAX_SAFE_INTEGER ||
      v.nameProposal?.status !== "proposed" || v.nameProposal.value !== names[a.roleId] ||
      v.selectedName !== null || v.ownerSelectionStatus !== "not_selected")
    return fail("Ожидается неизменённое proposed-имя из утверждённого списка.");
  // Source fields of the single derived nameStatus; no other employee fields change.
  v.nameProposal.status = "accepted";
  v.selectedName = names[a.roleId];
  v.ownerSelectionStatus = "accepted";
  profile.version++;
  const commands: ModelCommand[] = [{ type: "saveDocument", id: doc.id, title: doc.title,
    text: JSON.stringify(profile, null, 2), url: doc.url, elementIds: doc.elementIds }];
  return { commands, roleId: a.roleId, targetId: a.roleId };
}
