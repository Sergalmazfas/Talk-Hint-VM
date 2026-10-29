import { describe, expect, it } from "vitest";
import { cachedResponse, rememberResponse, mergeWriteResponse } from "./responseCache";
import { initialModel } from "../../projectModel/seed";
describe("complete write response without a post-commit full decode", () => {
  it("retains untouched history, context, alternatives and operating history", () => {
    const old: any = { ...initialModel(), revision: 9, alternatives: [{ id: "other", model: {} }],
      decisions: [{ id: "old" }], hypothesisContext: { selectedId: "new-country" },
      operatingModel: { revisions: [{ version: 1 }, { version: 2 }] } };
    const after: any = { ...initialModel(), decisions: [{ id: "new" }],
      operatingModel: { revisions: [{ version: 2 }, { version: 3 }] } };
    const result = mergeWriteResponse(old, after, 10);
    expect(result.revision).toBe(10);
    expect(result.decisions.map(x => x.id)).toEqual(["old", "new"]);
    expect(result.operatingModel!.revisions.map(x => x.version)).toEqual([1, 2, 3]);
    expect(result.alternatives).toBe(old.alternatives);
    expect(result.hypothesisContext).toBe(old.hypothesisContext);
    expect(old.decisions).toHaveLength(1);
  });
  it("does not reuse a different revision/owner/environment/hypothesis or pool", () => {
    const pool = {} as any, other = {} as any, state = { ...initialModel(), revision: 9 };
    rememberResponse(pool, "development/owner/new-country", state);
    expect(cachedResponse(pool, "development/owner/new-country", 9)).toBe(state);
    for (const key of ["production/owner/new-country", "development/other/new-country", "development/owner/original"])
      expect(cachedResponse(pool, key, 9)).toBeUndefined();
    expect(cachedResponse(pool, "development/owner/new-country", 8)).toBeUndefined();
    expect(cachedResponse(other, "development/owner/new-country", 9)).toBeUndefined();
  });
});
