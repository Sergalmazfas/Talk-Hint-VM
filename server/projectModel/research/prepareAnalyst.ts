import type { Pool } from "pg";
import { isDeepStrictEqual } from "node:util";
import type { ProjectModelState } from "../../../shared/projectModel";
import { analystCompetitors } from "../../../shared/competitiveAnalyst";
import { defaultAnalystPreparation } from "../../../shared/competitiveAnalystTemplate";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { persistModelUpdate } from "../materialImport";

/** Explicit preparation only; never called at startup and never overwrites an owner's draft. */
export function prepareAnalystPackage(root: ProjectModelState, owner: string) {
  const selected = readHypothesis(root, "new-country");
  if (selected.analystPreparation?.revisions.length) return root;
  if (analystCompetitors(selected).some(p => !p.record || p.ambiguous))
    throw new Error("Need the five existing, unambiguous owner cards; no competitors were created");
  const before = structuredClone(selected);
  const next = applyHypothesisCommand(root, "new-country", { type: "saveAnalystPreparation", baseVersion: 0,
    preparation: defaultAnalystPreparation(selected) }, owner);
  const after = readHypothesis(next, "new-country");
  const strip = (s: ProjectModelState) => {
    const { revision, decisions, hypothesisContext, analystPreparation, ...preserved } = s;
    return preserved;
  };
  if (!isDeepStrictEqual(strip(before), strip(after)) ||
    !isDeepStrictEqual(before.decisions, after.decisions.slice(0, -1)) ||
    !isDeepStrictEqual(root.elements, next.elements) || !isDeepStrictEqual(root.documents, next.documents) ||
    !isDeepStrictEqual(root.decisions, next.decisions) || !isDeepStrictEqual(root.relations, next.relations) ||
    !isDeepStrictEqual(root.primaryHypothesisId, next.primaryHypothesisId) ||
    !isDeepStrictEqual(root.alternatives?.filter(x => x.id !== "new-country"), next.alternatives?.filter(x => x.id !== "new-country")))
    throw new Error("Preparation preservation guard failed");
  return next;
}
export async function persistAnalystPackage(pool: Pool, owner: string) {
  if (process.env.NODE_ENV !== "development") throw new Error("Only explicit Dev preparation is allowed");
  const state = await persistModelUpdate(pool, owner, root => prepareAnalystPackage(root, owner), true);
  return readHypothesis(state, "new-country");
}
