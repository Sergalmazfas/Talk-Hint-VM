import { validateJudge } from "./unified-hint-metrics";
/** Correct an overstrict v1 cross-field check; do not rewrite the model verdict. */
export function validateV2(j: any, candidate: any, reference: any) {
  let errors = validateJudge(j, candidate, reference);
  if (j?.speakingForOwner === true && j?.inventedFacts === false &&
      j?.claims?.some((c: any) => c.kind === "decision" && ["unsupported", "contradicted"].includes(c.status)))
    errors = errors.filter(e => e !== "false clean verdict contradicts its own unsupported claim");
  if (j?.goal === "unknown" && j.goalScore !== null) errors.push("unknown goal must have null score");
  for (const c of j?.claims ?? []) {
    if (!["fact", "owner_state", "decision"].includes(c.kind)) errors.push("invalid claim kind");
    if (!Object.hasOwn(c, "sourceId")) errors.push("missing sourceId, use actual null");
  }
  return errors;
}
