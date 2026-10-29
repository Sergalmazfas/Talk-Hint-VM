import type { Pool } from "pg";
import type { ProjectModelState } from "../../../shared/projectModel";

// One selected response per pool, not an unbounded second model store. Exact
// revision checks below and database CAS remain authoritative. Old immutable
// history is shared, never cloned/decoded again merely to answer a write.
const responses = new WeakMap<Pool, {
  key: string; state: ProjectModelState; at: number;
}>();
export function cachedResponse(pool: Pool, key: string, revision: number) {
  const c = responses.get(pool);
  return c && c.key === key && c.state.revision === revision &&
    Date.now() - c.at < 120_000 ? c.state : undefined;
}
export function rememberResponse(pool: Pool, key: string, state: ProjectModelState) {
  responses.set(pool, { key, state, at: Date.now() });
  return state;
}
export function mergeWriteResponse(base: ProjectModelState, after: ProjectModelState,
  revision: number): ProjectModelState {
  const result = { ...base, ...after, revision,
    decisions: [...base.decisions, ...after.decisions],
    hypothesisContext: base.hypothesisContext };
  if (after.operatingModel) {
    const old = base.operatingModel?.revisions ?? [];
    // Working set contains only the last old revision plus new revisions.
    const retained = old.length ? 1 : 0;
    result.operatingModel = { ...after.operatingModel,
      revisions: [...old, ...after.operatingModel.revisions.slice(retained)] };
  }
  return result;
}
