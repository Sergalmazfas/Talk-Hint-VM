/** Pure checks; no SDK, environment, network or application imports. */
export const quotaFailure = (e: { code?: string | null; type?: string | null }) =>
  e.code === "credit_balance_exhausted" || e.code === "insufficient_quota" || e.type === "insufficient_quota";
export const canReserve = (charged: number, inflight: number, bound: number, attempts: number) =>
  charged + inflight + bound <= 35 && attempts < 1088;
