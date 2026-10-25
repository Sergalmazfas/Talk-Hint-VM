import type { ProjectModelState } from "../../shared/projectModel";
export { activeModelSize } from "./history";
/** Per-hypothesis bound stays unchanged; independent hypotheses share an envelope. */
export function modelSizeBudget(state: ProjectModelState) {
  return state.alternatives?.length ? 8_000_000 : 5_000_000;
}
