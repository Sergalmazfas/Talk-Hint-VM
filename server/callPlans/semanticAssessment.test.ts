import { describe, it, expect } from "vitest";
import type { CallPlan } from "../../shared/callPlan";
import { planHash } from "./store";
import { reviewedPreparationAssessment } from "./semanticAssessment";
import { secretaryPreparationMetadata } from "./secretary";
import { secretaryInstruction } from "../../shared/callPlan";
import { renderProcessLetter } from "../callLab/processReport";

const fixturePlan: CallPlan = {
  goal: "Buy a new 295/75 R22.5 tire", ownerFacts: ["Trailer axle"], sayAsk: ["Ask stock and installed price"],
  expectedQuestions: [{ q: "Which axle", answer: "Trailer axle" }, { q: "Your budget", answer: null }],
  unknowns: ["Budget"], disclosurePolicy: { allowed: ["Tire requirements"], forbidden: ["Payment details"] },
  language: "en", executor: "hint",
};
const snapshot = { id: "frozen-plan", hash: planHash(fixturePlan), plan: fixturePlan };
const transcript = "Guest: Is this for your trailer?\nOwner: Yes, the axle on my trailer.\nGuest: What can you spend?\nOwner: I have not decided.";
const review = { qa_status: "QA: принято", analysis: { preparation: {
  rows: [
    { guestQuote: "Is this for your trailer?", planIndex: 0, ownerQuote: "Yes, the axle on my trailer.",
      answerMatch: "matched", explanation: "Тот же смысл оси прицепа, другая формулировка." },
    { guestQuote: "What can you spend?", planIndex: 1, ownerQuote: "I have not decided.",
      answerMatch: "unknown", explanation: "Бюджет в плане неизвестен, не готовый ответ." },
  ], limitations: ["Только наблюдаемые вопросы, STT не проверен."],
} } };
const run = (r: any = review, s: any = snapshot, text: unknown = transcript): any =>
  reviewedPreparationAssessment(s, text, r);
describe("P.PREP semantic review from the existing lab + QA", () => {
  it("accepts grounded paraphrases without mistaking literal misses for semantic misses", () => {
    const p = run();
    expect(p.exactQuestionsObserved).toBe(0);
    expect(p.semanticAssessment).toBe("lab_qa_reviewed");
    expect(p.semanticReview).toMatchObject({ questionsCovered: 2, questionsAssessed: 2,
      preparedAnswersAssessed: 1, answersMatched: 1, partialAnswers: 0 });
    expect(p.usefulness).toBe("not_measured");
    const letter = renderProcessLetter({ mode: "hint", execution: "analysis_not_completed", preparation: p });
    expect(letter.body).toContain("По смыслу: покрыто 2/2");
    expect(letter.body).toContain("Is this for your trailer?");
  });
  it("never upgrades an old prose heading or returned QA into a semantic assessment", () => {
    expect(run({ ...review, qa_status: "QA: расхождения не устранены" }).semanticReview.reason).toBe("qa_not_accepted");
    expect(run({ qa_status: "QA: принято", analysis: { summary_ru: "P.PREP all good" } })
      .semanticReview.reason).toBe("structured_review_unavailable");
  });
  it("requires the frozen plan hash and attributed speaker evidence", () => {
    expect(run(review, { ...snapshot, hash: "changed" }).semanticReview.reason).toBe("plan_hash_mismatch");
    expect(run(review, snapshot, "Unlabelled words").semanticReview.reason).toBe("speaker_evidence_unavailable");
    expect(run(review, null).status).toBe("no_valid_plan");
  });
  it.each([
    [{ guestQuote: "Invented question" }, "invalid_guest_evidence"],
    [{ planIndex: 77 }, "invalid_plan_index"],
    [{ ownerQuote: "Invented answer" }, "invalid_owner_evidence"],
    [{ planIndex: null, answerMatch: "matched" }, "answer_without_evidence"],
    [{ planIndex: 1, answerMatch: "partial" }, "answer_without_evidence"],
    [{ ownerQuote: null }, "answer_without_evidence"],
  ])("rejects forged citations, indices and counting unknown answers", (patch, reason) => {
    const r = structuredClone(review);
    Object.assign(r.analysis.preparation.rows[0], patch);
    expect(run(r).semanticReview.reason).toBe(reason);
  });
  it("rejects duplicate question rows and preserves partial answers separately", () => {
    const duplicate = structuredClone(review);
    duplicate.analysis.preparation.rows.push(duplicate.analysis.preparation.rows[0]);
    expect(run(duplicate).semanticReview.reason).toBe("invalid_guest_evidence");
    const partial = structuredClone(review);
    partial.analysis.preparation.rows[0].answerMatch = "partial";
    expect(run(partial).semanticReview).toMatchObject({ answersMatched: 0, partialAnswers: 1 });
  });
  it("does not turn an unknown semantic answer into a zero-quality score", () => {
    const r = structuredClone(review);
    r.analysis.preparation.rows[0].answerMatch = "unknown";
    expect(run(r).semanticReview).toMatchObject({ preparedAnswersAssessed: 0,
      answerMatchPercent: null, answersUnassessed: 1 });
  });
});
describe("Secretary plan metadata, no fabricated legacy plan", () => {
  it("binds the approved structured plan to the task and exact recipient", () => {
    const plan = { ...fixturePlan, executor: "secretary" as const, targetPhone: "+12025550123" };
    const task = { id: "task-fixture", phoneNumber: plan.targetPhone, instruction: secretaryInstruction(plan) };
    expect(secretaryPreparationMetadata(task)).toMatchObject({
      callPlan: { id: task.id, hash: planHash(plan), plan },
      callPlanPreparation: { status: "structured_plan" },
    });
    expect(secretaryPreparationMetadata({ ...task, phoneNumber: "+12025550124" }).callPlan).toBeUndefined();
    expect(secretaryPreparationMetadata({ ...task, instruction: "Legacy goal" })).toEqual({
      callPlanPreparation: { status: "legacy_instruction_no_structured_plan", source: "approved_secretary_instruction" },
    });
  });
});
