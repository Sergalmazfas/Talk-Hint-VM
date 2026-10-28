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
  it("keeps comparisons in the full report, not an extra short-letter section", () => {
    const f = buildProductFollowup(report, source, context);
    const text = productLetterSection({ product_followup: f }).join("\n");
    expect(f.previous[0].shown).toBe(11);
    expect(f.current.shown).toBe(10);
    expect(f.comparison).toContain("не доказывают причинный эффект");
    expect(text).not.toContain("ПРОШЛЫЕ ЗВОНКИ");
    expect(f.policy.allowedChanges).not.toContain("model");
    expect(text).toContain("ID строки — да/нет");
  });
  it("does not fabricate journal history, acceptance, zero or new provider suggestions", () => {
    const f = buildProductFollowup(report, source, { status: "unavailable", cases: [], previous: [] });
    expect(f.issues.every(i => i.tried.length === 0)).toBe(true);
    expect(f.sourceRevision).toBeNull();
    expect(f.issues[0].historyStatus).toBe("журнал недоступен");
    expect(productLetterSection({ product_followup: f }).join("\n")).toContain("журнал недоступен");
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
  it("uses history of this problem only, not the entire broad coffee incident", () => {
    const f = buildProductFollowup(report, source, { status: "available", previous: [], cases: [
      { caseId: "broad", label: "wait_state и показ и перевод", history: [
        { note: "Исправили перевод собеседника" }, { note: "Исправили wait_state: checking" },
        { stage: "verified", note: "Результаты см. в общем отчёте", verification: { hint: "показ iPhone", tests: "passed" } },
      ] },
      { caseId: "current-question", problemKey: "filter", history: [
        { stage: "implemented_dev", note: "Исправили текущий вопрос перед показом карточки" },
      ] },
    ] });
    expect(f.issues[0].tried).toEqual([]);
    expect(f.issues[0].historyStatus).toContain("раньше не пробовали");
    expect(f.issues[1].tried[0].attempts).toHaveLength(1);
    expect(f.issues[1].tried[0].attempts[0].action).toContain("wait_state");
    const text = productLetterSection({ product_followup: f }).join("\n");
    expect(text).not.toContain("Исправили перевод");
    for (const issue of f.issues.filter(i => i.decision === "awaiting_owner")) {
      expect(issue.proposal).toContain("→");
      expect(issue.proposal).toContain("Варианты:");
      expect(issue.proposal).toContain("рекомендуем");
    }
  });
  it("does not claim a proposed change was tried or a broad incident rating proves this fix", () => {
    const f = buildProductFollowup(report, source, { status: "available", previous: [], cases: [
      { ownerEvaluationOfImplementedChange: "отлично", history: [
        { stage: "proposed", note: "Предложили wait_state" },
        { stage: "implemented_dev", note: "Исправили показ", decisionId: "saved-call:D1", ownerDecision: "yes" },
      ] },
    ] });
    expect(f.issues[0].tried[0].effect).toBe("помогло ли — не подтверждено");
    expect(f.issues[0].decision).toBe("approved_dev");
    expect(f.issues[1].tried).toEqual([]);
    expect(productLetterSection({ product_followup: f }).join("\n")).toContain("да; подготовлено в Dev");
  });
});
