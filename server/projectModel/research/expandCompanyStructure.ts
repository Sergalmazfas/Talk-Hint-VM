import type { ProjectModelState } from "../../../shared/projectModel";
import { buildCompanyStructure } from "../../../shared/companyStructure";
import { companyCoverage } from "../../../shared/operatingModel";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { isDeepStrictEqual } from "node:util";

/** Explicit approved Dev change. Never called at startup or against another hypothesis. */
export function expandCompanyStructure(root: ProjectModelState, actor: string) {
  const old = readHypothesis(root, "new-country");
  const latest = old.operatingModel?.revisions.at(-1);
  if (!latest) throw new Error("Saved operating model required; not a new seed");
  if (latest.data.companyStructureVersion) return root;
  const data = buildCompanyStructure(latest.data);
  const gaps = companyCoverage(data);
  if (gaps.length) throw new Error(`Top structure incomplete: ${gaps.join("; ")}`);
  const next = applyHypothesisCommand(root, "new-country", {
    type: "saveOperatingModel", baseVersion: latest.version, data,
  }, actor);
  const after = readHypothesis(next, "new-country");
  const strip = ({ operatingModel, revision, decisions, hypothesisContext, ...rest }: ProjectModelState) => rest;
  const stripRoot = ({ alternatives, revision, ...rest }: ProjectModelState) => rest;
  if (!isDeepStrictEqual(strip(old), strip(after)) || !isDeepStrictEqual(stripRoot(root), stripRoot(next)) ||
      !isDeepStrictEqual(old.decisions, after.decisions.slice(0, -1)) ||
      !isDeepStrictEqual(old.operatingModel!.revisions, after.operatingModel!.revisions.slice(0, -1)) ||
      !isDeepStrictEqual(root.alternatives?.filter(a => a.id !== "new-country"), next.alternatives?.filter(a => a.id !== "new-country")))
    throw new Error("Preservation guard failed");
  for (const n of latest.data.nodes) {
    const saved = data.nodes.find(row => row.id === n.id);
    if (!saved || saved.code !== n.code || saved.name !== n.name)
      throw new Error("An existing identity/code/name changed unexpectedly");
  }
  for (const link of latest.data.links)
    if (!data.links.some(row => isDeepStrictEqual(row, link))) throw new Error("An existing link was lost");
  return next;
}
