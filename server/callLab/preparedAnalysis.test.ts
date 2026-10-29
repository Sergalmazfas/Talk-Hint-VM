import { describe, expect, it, vi } from "vitest";
vi.mock("../companyData/active", () => ({ activeCompanyDocument: vi.fn(async () => null) }));
vi.mock("../projectModel/history", () => ({ unpackModel: vi.fn(async (_p, _o, state) => state) }));
vi.mock("../projectModel/hypotheses", () => ({ readHypothesis: vi.fn(state => state) }));
import { prepareOwnerHintInput, preparedQaModel } from "./preparedAnalysis";

const scope = { ownerId: "owner", environment: "development" as const, modelOwnerKey: "bound-model", modelAccessVerified: true };
const call = { user_id: "owner", call_sid: "saved" };
const source = { call_id: "saved", environment: "development", mode: "hint", owner_verified: true,
  processing_authorized: true, ended_at: "2026-10-28T20:00:00Z", hints: [{ id: "h1", text: "Sure, I'll wait." }] };
function pool(history: any[] = []) {
  return { query: vi.fn(async (sql: string) => sql.includes("project_models") ? ({
    rowCount: 1, rows: [{ owner_key: "bound-model", state: { revision: 908, documents: [{
      id: "DOC-TALKHINT-IMPROVEMENT-JOURNAL",
      text: JSON.stringify({ cases: [{ caseId: "same-problem", history }] }),
    }] } }],
  }) : ({ rows: [] })) };
}
const attempt = { at: "2026-10-27T20:00:00Z", stage: "implemented_dev",
  note: "wait_state: checking больше не запускает ожидание", before: "лишний wait", after: null,
  evidence: "offline fixture", ownerEvaluationOfImplementedChange: null };

describe("prepared problem history — not connected to live runner", () => {
  it("reads bound owner/model/environment before analysis, selects individual attempts without faking effect", async () => {
    const db = pool([attempt, { ...attempt, note: "Перевод", problemKey: "translation" }]);
    const result = await prepareOwnerHintInput(db as any, call, source, scope);
    expect(result.executionAllowed).toBe(false);
    expect(result.runOptions.qaModel).toBe(preparedQaModel);
    expect(result.source.problem_history.source_revision).toBe(908);
    expect(result.source.problem_history.problems[0].attempts).toHaveLength(1);
    expect(result.source.problem_history.problems[0].attempts[0].effect_status).toBe("не подтверждён");
    expect(source).not.toHaveProperty("problem_history");
    expect(db.query.mock.calls[0][0]).toContain("owner_key=$1");
    expect(db.query.mock.calls[1][0]).toContain("owner_id=$1 AND environment=$2");
    expect(db.query.mock.calls.every(c => c[0].trim().startsWith("SELECT"))).toBe(true);
  });
  it.each([
    { ...scope, modelAccessVerified: false }, { ...scope, ownerId: "other" },
    { ...scope, environment: "production" as const }, { ...scope, modelOwnerKey: "" },
  ])("rejects missing or inconsistent ownership/environment before any query", async s => {
    const db = pool();
    await expect(prepareOwnerHintInput(db as any, call, source, s)).rejects.toThrow("SCOPE_REJECTED");
    expect(db.query).not.toHaveBeenCalled();
  });
  it("excludes future, undated, unimplemented and foreign attempts", async () => {
    const db = pool([attempt, { ...attempt, at: "2026-10-29T00:00:00Z" },
      { ...attempt, at: null }, { ...attempt, stage: "proposed" },
      { ...attempt, owner_id: "other" }, { ...attempt, environment: "production" }]);
    const r = await prepareOwnerHintInput(db as any, call, source, scope);
    expect(r.source.problem_history.problems[0].attempts).toHaveLength(1);
    expect(r.source.problem_history.status).toBe("partial");
  });
  it("makes unavailable history explicit, not no previous attempts", async () => {
    const db = { query: vi.fn().mockRejectedValue(Error("offline")) };
    const r = await prepareOwnerHintInput(db as any, call, source, scope);
    expect(r.source.problem_history.status).toBe("unavailable");
    expect(r.source.problem_history.problems).toEqual([]);
    expect(JSON.stringify(r)).not.toContain("раньше не пробовали");
  });
  it("marks omission due to size, preserving original notes", async () => {
    const db = pool([{ ...attempt, note: "wait_state " + "x".repeat(20_000) }]);
    const r = await prepareOwnerHintInput(db as any, call, source, scope);
    expect(r.source.problem_history.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(r.source.problem_history))).toBeLessThanOrEqual(16_000);
  });
  it("refuses replacement of a previously prepared frozen block", async () => {
    const db = pool();
    await expect(prepareOwnerHintInput(db as any, call, { ...source, problem_history: {} }, scope))
      .rejects.toThrow("HISTORY_ALREADY_PRESENT");
    expect(db.query).not.toHaveBeenCalled();
  });
});
