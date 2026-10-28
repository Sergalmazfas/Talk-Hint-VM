import type { ProjectModelState } from "../../shared/projectModel";
export { activeModelSize } from "./history";
/** CAP.2, owner decision 2026-10-28: temporary relief for new-country only. */
export function modelSizeBudget(state: ProjectModelState) {
  return state.alternatives?.length ? 8_000_000 :
    state.hypothesisContext?.selectedId === "new-country" ? 6_500_000 : 5_000_000;
}
