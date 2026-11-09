import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { callPlanSchema, callPlanContext, secretaryInstruction, secretaryPlanFromInstruction, type CallPlan } from "../../shared/callPlan";
import { preparationAssessment } from "./assessment";
import { planHash } from "./store";
import { talkHintActionsSchema } from "../chatgpt/actionsSchema";
import { renderProcessLetter } from "../callLab/processReport";

export const fixturePlan: CallPlan = {
  goal: "Buy a new 295/75 R22.5 tire",
  ownerFacts: ["Trailer axle"], sayAsk: ["Ask stock and installed price"],
  expectedQuestions: [{ q: "Which axle", answer: "Trailer axle" }, { q: "Your budget", answer: null }],
  unknowns: ["Budget"], disclosurePolicy: { allowed: ["Tire requirements"], forbidden: ["Payment details"] },
  language: "en", executor: "hint",
};
describe("unified owner call plan", () => {
  it("requires all fields and rejects extra rights, owner IDs and invalid numbers", () => {
    expect(callPlanSchema.parse(fixturePlan)).toEqual(fixturePlan);
    for (const v of [{ ...fixturePlan, ownerId: "other" }, { ...fixturePlan, executor: "dial" },
      { ...fixturePlan, targetPhone: "911" }, { ...fixturePlan, disclosurePolicy: {} },
      { ...fixturePlan, ownerFacts: undefined }, { ...fixturePlan, expectedQuestions: [{ q: "x" }] }])
      expect(callPlanSchema.safeParse(v).success).toBe(false);
    expect(callPlanSchema.safeParse({ ...fixturePlan, sayAsk: Array(15).fill("x".repeat(500)),
      ownerFacts: Array(20).fill("y".repeat(500)) }).success).toBe(false);
  });
  it("hashes normalized schema, independent of PostgreSQL jsonb key order", () => {
    const reversed = Object.fromEntries(Object.entries(fixturePlan).reverse()) as CallPlan;
    expect(planHash(reversed)).toBe(planHash(fixturePlan));
    expect(planHash({ ...fixturePlan, goal: "Different" })).not.toBe(planHash(fixturePlan));
  });
  it("grounds prepared answers without converting unknowns or disclosures into authority", () => {
    const text = callPlanContext(fixturePlan);
    for (const fragment of ["CURRENT", "FIRST", "null", "UNKNOWN", "forbidden", "corrections override", "no calls"])
      expect(text).toContain(fragment);
    expect(text).toContain("Trailer axle");
  });
  it("uses the same Secretary instruction and round-trips the exact common plan", () => {
    const p = { ...fixturePlan, executor: "secretary" as const, targetPhone: "+12025550123" };
    expect(secretaryPlanFromInstruction(secretaryInstruction(p), p.targetPhone)).toEqual(p);
    expect(secretaryPlanFromInstruction(secretaryInstruction(p), "+12025550124")).toBeNull();
    expect(secretaryPlanFromInstruction("Normal legacy instruction", p.targetPhone)).toBeNull();
    expect(() => secretaryInstruction(fixturePlan)).toThrow();
    const long = secretaryInstruction({ ...p, ownerFacts: Array(10).fill("x".repeat(500)) });
    expect(long.length).toBeGreaterThan(2000);
    expect(secretaryPlanFromInstruction(long, p.targetPhone)?.ownerFacts).toHaveLength(10);
  });
  it("does not claim semantic usefulness, invent speakers, or count unknown answers", () => {
    const snapshot = { id: "plan", hash: planHash(fixturePlan), plan: fixturePlan };
    const result = preparationAssessment(snapshot, "Guest: Which axle?\nOwner: Trailer axle.\nGuest: Your budget?");
    expect(result).toMatchObject({ exactQuestionsObserved: 2, exactAnswersObserved: 1,
      semanticAssessment: "not_measured", usefulness: "not_measured" });
    expect(result.rows![1].exactAnswerObserved).toBeNull();
    expect(preparationAssessment(snapshot, "unlabelled transcript").status).toBe("speaker_evidence_unavailable");
    expect(preparationAssessment(null, "").status).toBe("no_valid_plan");
  });
  it("exposes the common plan without new OAuth scopes or dialing from Hint", () => {
    const schema: any = talkHintActionsSchema("https://example.test", true);
    const hint = schema.paths["/api/chatgpt-actions/hint-plan"].post;
    const secretary = schema.paths["/api/chatgpt-actions/secretary-plan"].post;
    expect(hint.security).toEqual(secretary.security);
    expect(hint.requestBody.content["application/json"].schema.properties.plan)
      .toEqual(secretary.requestBody.content["application/json"].schema.properties.plan);
    expect(Object.keys(schema.components.securitySchemes.TalkHintOAuth.flows.authorizationCode.scopes))
      .not.toContain("hint:write");
    expect((talkHintActionsSchema("https://example.test", false) as any).paths["/api/chatgpt-actions/hint-plan"]).toBeUndefined();
  });
  it("connects plan to both live branches and suppresses the generic canned-answer bypass", () => {
    const stream = readFileSync("server/websocket.ts", "utf8");
    expect(stream).toContain("&& !preparedPlanContext");
    expect(stream).toContain("ownerContext + preparedPlanContext");
    expect(stream).toContain("tutorMemory: tutorMemoryBlock }) + preparedPlanContext");
    expect(stream).toContain("setUserGoal(streamUserId, parsed.data.goal)");
    expect(readFileSync("server/routes.ts", "utf8")).toContain(".bind(placingUserId, callSid)");
    const lab = readFileSync("workers/hint_lab/pipeline.py", "utf8");
    expect(lab).toContain('if source.get("call_plan"):');
    expect(lab).toContain("qa_brief += PREPARATION_BRIEF");
  });
  it("includes preparation evidence in the existing per-call owner letter", () => {
    const letter = renderProcessLetter({ mode: "hint", execution: "analysis_not_completed",
      preparation: { planId: "test-plan", planHash: "abc", expectedQuestions: 2,
        exactQuestionsObserved: 1, exactAnswersObserved: 0, limitations: [] } });
    expect(letter.body).toContain("P.PREP");
    expect(letter.body).toContain("test-plan");
    expect(letter.body).toContain("не процент качества");
  });
});
