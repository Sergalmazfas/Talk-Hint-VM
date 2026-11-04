import { describe, it, expect } from "vitest";
import type { ProjectModelState } from "../../shared/projectModel";
import { expectedResultSchema } from "../../shared/journalExpectation";
import { selectCallExpectations, compareExpectations, validExpectationChecks } from "./expectations";
import { initialState, log } from "./domain";
import { crewControlPage } from "./controlPage";
const expectation = { text: "Катя ≤ 6 реплик, 0 повторов", appliesTo: "secretary_call",
  metrics: [{ metric: "katya_turns", operator: "lte", value: 6, unit: "turns" },
    { metric: "repeat_questions", operator: "eq", value: 0, unit: "repeats" }] };
const entry = (id: string, at = "2026-11-04T09:00:00Z") => ({ id,
  expectedResult: expectation, expectedResultRecordedAt: at, registeredAt: "2026-01-01T00:00:00Z",
  targetRoleIds: ["secretary-lab-engineer"] });
const model = (entries: unknown[]) => ({ documents: [{ id: "DOC-TALKHINT-IMPROVEMENT-JOURNAL",
  text: JSON.stringify({ format: "talkhint.improvement-journal", crewJournalEntries: entries }) }] }) as ProjectModelState;
const before = "2026-11-04T10:00:00Z";
describe("Numeric journal expectation and immutable call comparison", () => {
  it("requires numeric finite targets, forbids duplicate metrics and protected fields", () => {
    expect(expectedResultSchema.safeParse(expectation).success).toBe(true);
    for (const value of [undefined, { ...expectation, metrics: [] },
      { ...expectation, metrics: [{ ...expectation.metrics[0], value: "6" }] },
      { ...expectation, metrics: [{ ...expectation.metrics[0], value: Infinity }] },
      { ...expectation, metrics: [expectation.metrics[0], expectation.metrics[0]] },
      { ...expectation, enabled: true }]) expect(expectedResultSchema.safeParse(value).success).toBe(false);
  });
  it("uses server recording time, not a backdated registeredAt; old records remain untouched", () => {
    const entries = [entry("before"), entry("after", "2026-11-04T11:00:00Z"),
      { id: "old", fact: "Historical text without expectedResult" }];
    const m = model(entries), old = m.documents[0].text, snap = selectCallExpectations(m, before);
    expect(snap.targets.map(t => t.entryId)).toEqual(["before", "before"]);
    expect(snap.documentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(m.documents[0].text).toBe(old);
    expect(selectCallExpectations(m, undefined).status).toBe("call_start_unknown");
  });
  it("does not use another mode's goals or invent 6/0 for a legacy journal", () => {
    expect(selectCallExpectations(model([{ ...entry("hint"), expectedResult: { ...expectation, appliesTo: "hint_call" } }]), before).targets).toEqual([]);
    expect(selectCallExpectations(model([{ id: "legacy" }]), before).status).toBe("not_recorded_before_call");
    expect(compareExpectations(undefined, {}, 12)).toEqual([]);
  });
  it("takes latest pre-call target per metric, not a contradictory older limit", () => {
    const old = entry("old", "2026-11-04T08:00:00Z");
    old.expectedResult = { ...expectation, metrics: [{ ...expectation.metrics[0], value: 10 }] };
    expect(selectCallExpectations(model([old, entry("new")]), before).targets[0].value).toBe(6);
    old.expectedResultRecordedAt = entry("new").expectedResultRecordedAt;
    expect(selectCallExpectations(model([old, entry("new")]), before).targets[0].entryId).toBe("new");
  });
  it("computes pass/fail from real turns and each reviewer's independent repeat count", () => {
    const snapshot = selectCallExpectations(model([entry("target")]), before);
    const author = { manners: [{ kind: "repeat_questions", value: 0 }] };
    const reviewer = { manners: [{ kind: "repeat_questions", value: 2 }] };
    expect(compareExpectations(snapshot, author, 6).map(r => r.status)).toEqual(["сошлось", "сошлось"]);
    expect(compareExpectations(snapshot, reviewer, 8).map(r => r.status)).toEqual(["не сошлось", "не сошлось"]);
    const checks = compareExpectations(snapshot, reviewer, 8).map(r => ({ ...r, reason: "8 > 6; два повторных вопроса" }));
    expect(validExpectationChecks(snapshot, { ...reviewer, expectationChecks: checks }, 8)).toBe(true);
    expect(validExpectationChecks(snapshot, { ...reviewer, expectationChecks: checks.map(r => ({ ...r, status: "сошлось" })) }, 8)).toBe(false);
    expect(validExpectationChecks(snapshot, { ...reviewer, expectationChecks: [] }, 8)).toBe(false);
  });
  it("unmeasured target is not a pass and requires an explanation", () => {
    const snapshot = selectCallExpectations(model([{ ...entry("latency"), expectedResult: { ...expectation,
      metrics: [{ metric: "first_audio_p95", operator: "lte", value: 1000, unit: "ms" }] } }]), before);
    expect(compareExpectations(snapshot, {}, 2)[0]).toMatchObject({ actual: null, status: "не проверено" });
    expect(validExpectationChecks(snapshot, { expectationChecks: [{ ...compareExpectations(snapshot, {}, 2)[0], reason: "" }] }, 2)).toBe(false);
  });
  it("every new runtime journal event has a numeric safety expectation without rewriting history", () => {
    const s = initialState(), legacy = { id: "old", at: before, actor: "owner", kind: "old", detail: {} };
    s.journal.push(legacy); log(s, "test", "diagnostic", {}, before);
    expect(s.journal[0]).toEqual(legacy);
    expect(s.journal[1].expectedResult?.metrics[0].value).toBe(0);
    expect(s.journal[1].expectedResult?.appliesTo).toBe("other");
    expect(crewControlPage).toContain("Ожидаемый результат: ");
    expect(crewControlPage).toContain("e.expectedResult?text(e.expectedResult)");
  });
});
