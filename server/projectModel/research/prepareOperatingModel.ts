import type { ProjectModelState } from "../../../shared/projectModel";
import { defaultOperatingModel, initialOperatingModelDraft } from "../../../shared/operatingModelTemplate";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { isDeepStrictEqual } from "node:util";
/** Explicit Dev import, never a startup seed and never replaces owner edits. */
export function prepareOperatingModel(root: ProjectModelState, actor: string) {
  const old = readHypothesis(root, "new-country");
  const data = defaultOperatingModel();
  const legacy = initialOperatingModelDraft();
  if (old.analystPreparation) {
    const reference = {
      ...structuredClone(data.nodes.find(n => n.id === "qualification-role")!),
      id: "benchmark-role-reference", code: "P-BENCH", name: "AI-аналитик конкурентов — существующий паспорт",
      parentId: "research-dept", description: "Паспорт уже подготовлен и ожидает согласования. Ссылка, не новый сотрудник или копия паспорта.",
      referenceIds: ["analyst-preparation"],
    };
    data.nodes.push(reference);
    legacy.nodes.push(reference);
  }
  const last = old.operatingModel?.revisions.at(-1);
  if (last && !isDeepStrictEqual(last.data, legacy)) return root;
  // Only a known unchanged initial draft can be enriched. Owner edits are never replaced.
  const next = applyHypothesisCommand(root, "new-country", { type: "saveOperatingModel", baseVersion: last?.version ?? 0, data }, actor);
  const after = readHypothesis(next, "new-country");
  const strip = ({ operatingModel, revision, decisions, hypothesisContext, ...rest }: ProjectModelState) => rest;
  const stripRoot = ({ alternatives, revision, ...rest }: ProjectModelState) => rest;
  if (!isDeepStrictEqual(strip(old), strip(after)) || !isDeepStrictEqual(stripRoot(root), stripRoot(next)) ||
    !isDeepStrictEqual(old.decisions, after.decisions.slice(0, -1)) ||
    !isDeepStrictEqual(root.alternatives?.filter(a => a.id !== "new-country"), next.alternatives?.filter(a => a.id !== "new-country")))
    throw new Error("Preservation guard failed; nothing saved");
  return next;
}
