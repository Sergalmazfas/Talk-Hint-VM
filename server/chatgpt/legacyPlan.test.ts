import { describe, expect, it } from "vitest";
import { legacySecretaryPlan, secretaryInstruction, secretaryPlanFromInstruction,
  displaySecretaryInstruction } from "../../shared/callPlan";
import { secretaryPreparationMetadata } from "../callPlans/secretary";

const phone = "+12025550123";
describe("legacy prepare_call compatibility", () => {
  it("preserves amounts, prohibitions and short checklist without invented answers", () => {
    const text = "Ask availability; confirm total $207.57. Do not place an order or pay without my approval.";
    const plan = legacySecretaryPlan(text, phone);
    expect(plan.sayAsk).toEqual(["Ask availability;", "confirm total $207.57.", "Do not place an order or pay without my approval."]);
    expect(plan.disclosurePolicy.forbidden).toEqual(["Do not place an order or pay without my approval."]);
    expect(plan.expectedQuestions).toEqual([]);
    expect(plan.ownerFacts).toEqual([]);
    expect(plan.disclosurePolicy.allowed).toEqual(["Ask availability;", "confirm total $207.57."]);
    const stored = secretaryInstruction(plan);
    const metadata = secretaryPreparationMetadata({ id: "task", phoneNumber: phone, instruction: stored });
    expect(metadata.callPlanPreparation.status).toBe("structured_plan");
    expect(metadata.callPlan?.plan).toEqual(plan);
  });
  it("never splits JSON string values or normalizes an already structured plan into text", () => {
    const plan = { ...legacySecretaryPlan("Ask price", phone),
      goal: "Ask NEW tire price", ownerFacts: ["295/75 R22.5. NEW only."],
      sayAsk: ["NEW 295/75 R22.5; confirm $1,500.", "Не оплачивать без согласия."],
      disclosurePolicy: { allowed: ["size"], forbidden: ["private address"] } };
    const stored = secretaryInstruction(plan);
    const read = legacySecretaryPlan(stored, phone);
    expect(read.ownerFacts).toEqual(plan.ownerFacts);
    expect(read.disclosurePolicy).toEqual(plan.disclosurePolicy);
    expect(read.sayAsk.join(" ")).toContain("$1,500.");
    expect(secretaryPlanFromInstruction(secretaryInstruction(read), phone)).toEqual(read);
  });
  it("shows readable history without leaking the JSON envelope or hiding restrictions", () => {
    const plan = { ...legacySecretaryPlan("Ask hours", phone),
      ownerFacts: ["Already paid $207.57"], disclosurePolicy: { allowed: ["payment status"], forbidden: ["card number"] } };
    const view = displaySecretaryInstruction(secretaryInstruction(plan), phone);
    expect(view).toContain("1. Ask hours");
    expect(view).toContain("Already paid $207.57");
    expect(view).toContain("card number");
    expect(view).not.toContain('{"goal"');
    expect(view).not.toContain("Owner-approved");
    expect(displaySecretaryInstruction("Old plain task", phone)).toBe("Old plain task");
  });
  it("refuses malformed/wrong-recipient structured input rather than stripping restrictions", () => {
    expect(() => legacySecretaryPlan("Owner-approved call plan.\n{bad}", phone)).toThrow("Malformed");
    const stored = secretaryInstruction(legacySecretaryPlan("Ask stock", phone));
    expect(() => legacySecretaryPlan(stored, "+12025550124")).toThrow("Malformed");
  });
  it("never truncates overflow, strips a prohibition or expands the existing 2000 limit", () => {
    const input = ("Ask stock and confirm availability; ").repeat(40) + "Never pay.";
    expect(() => secretaryInstruction(legacySecretaryPlan(input, phone))).toThrow();
    expect(() => legacySecretaryPlan("a".repeat(501), phone)).toThrow("too long");
  });
  it("does not turn a factual Russian negation into a ban on communicating the goal", () => {
    const plan = legacySecretaryPlan("Сообщить, что счёт уже оплачен и повторно платить не нужно. Не оплачивать без моего согласия.", phone);
    expect(plan.disclosurePolicy.forbidden).toEqual(["Не оплачивать без моего согласия."]);
    expect(plan.disclosurePolicy.allowed).toContain("Сообщить, что счёт уже оплачен и повторно платить не нужно.");
  });
});
