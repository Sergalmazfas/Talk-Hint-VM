import { describe, expect, it } from "vitest";
import { buildProductFollowup, productLetterSection } from "./productFollowup";
import { renderProcessLetter } from "./processReport";

const context = { status: "available" as const, revision: 885, cases: [
  { caseId: "HINT-UI", label: "экран", history: [{ at: "2026-10-27", note: "Проверили показ; тест прошёл" }], ownerEvaluationOfImplementedChange: null },
  { caseId: "HINT-WAIT", label: "wait_state", history: [{ at: "2026-10-27", note: "Предложили триггер ожидания" }] },
], previous: [{ call_id: "earlier", ended_at: "2026-10-27", lab_release: { version: "old" },
  deterministic: { hints_ui_claimed: 11, sent: 14, stt_final_to_ack_ms: { p50: 2154, p95: 3617 } } }] };
const report = { call_id: "saved-call", qa_status: "QA: расхождения не устранены", qa_issues: ["Спорная категория"],
  deterministic: { acknowledged: 15, hints_ui_claimed: 10, sent: 15,
    stt_final_to_ack_ms: { p50: 1835, p95: 4063 } },
  engineering_dossier: { answers: [{ question: "Подсказка не на тот вопрос" }] } };
const source = { hints: [{ id: "8", delivered_at: 1000 }, { id: "22", text: "Sure, I'll wait." }],
  ui_visibility: { events: [{ kind: "hint", utteranceId: 8, receivedAt: new Date(24958).toISOString() }] } };
describe("per-call P.PRODUCT decision handoff", () => {
  it("keeps 23.958s as a receipt gap, not physical screen latency", () => {
    const f = buildProductFollowup(report, source, context);
    expect(f.issues[0].evidence).toContain("23958 мс");
    expect(f.issues[0].evidence).toContain("не доказательство");
    expect(f.issues.map(i => i.kind)).toEqual(["ios_display", "trigger", "filter", "diagnostics"]);
  });
  it("does not call passed technical checks an owner-confirmed improvement", () => {
    const f = buildProductFollowup(report, source, context);
    expect(f.issues[0].tried[0].effect).toBe("помогло ли — не подтверждено");
    expect(f.issues.filter(i => i.kind !== "diagnostics").every(i => i.decision === "awaiting_owner" && i.implemented === false)).toBe(true);
    expect(f.issues.at(-1)?.decision).toBe("internal_role_step");
    expect(f.executionStarted).toBe(false);
  });
  it("compares saved counters without claiming causal effect", () => {
    const f = buildProductFollowup(report, source, context);
    const text = productLetterSection({ product_followup: f }).join("\n");
    expect(text).toContain("11/14 → 10/15");
    expect(text).toContain("2154/3617 → 1835/4063");
    expect(text).toContain("не доказывают причинный эффект");
    expect(f.policy.allowedChanges).not.toContain("model");
    expect(text).toContain("ID строки — да/нет");
  });
  it("does not fabricate journal history, acceptance, zero or new provider suggestions", () => {
    const f = buildProductFollowup(report, source, { status: "unavailable", cases: [], previous: [] });
    expect(f.issues.every(i => i.tried.length === 0)).toBe(true);
    expect(f.sourceRevision).toBeNull();
    expect(f.issues[0].historyStatus).toBe("журнал недоступен");
    expect(productLetterSection({ product_followup: f }).join("\n")).toContain("эффект неизвестен");
    expect(productLetterSection({}).join("\n")).toContain("История не приложена");
  });
  it("keeps the same handoff in failed, normal and manual-report letter paths", () => {
    const f = buildProductFollowup(report, source, context);
    for (const patch of [{}, { execution: "analysis_not_completed" },
      { manual_trigger: true, manual_diagnostic: { version: 1, answers: [], acknowledged_without_ui_ids: [] } }]) {
      const text = renderProcessLetter({ ...report, ...patch, product_followup: f }).body;
      expect(text).toContain("ЧТО УЖЕ ПРОБОВАЛИ");
      expect(text).toContain("НУЖНО РЕШЕНИЕ");
      expect(text).toContain("ближайшая публикация владельцем");
    }
  });
  it("does not treat an unsupported-mode notice as rejected QA", () => {
    const f = buildProductFollowup({ execution: "mode_analysis_not_connected" }, null, context);
    expect(f.issues).toEqual([]);
  });
});
