import { describe, expect, it, vi } from "vitest";
import { defaultRehearsalScenes, rehearsalInstruction, rehearsalVersions, sceneFromInput, sceneFromText } from "./catalog";
import { legacySecretaryPlan } from "../../shared/callPlan";
import { requireRehearsalDev } from "./store";
import { WAITING_LAB_PLANS } from "../../shared/secretaryWaitingPlans";
describe("rehearsal immutable plans and isolated profiles", () => {
  it("has tires, overnight parking and washing with explicit plans", () => {
    const scenes = defaultRehearsalScenes();
    expect(scenes).toHaveLength(3);
    expect(scenes[0].plan.goal).toContain("295/75R22.5");
    for (const scene of scenes) {
      expect(scene.plan.executor).toBe("secretary");
      expect(scene.plan.targetPhone).toBeUndefined();
      expect(scene.plan.sayAsk.length).toBeGreaterThan(0);
      expect(rehearsalInstruction(scene)).toContain("Wait for the seller's first phrase");
      expect(rehearsalInstruction(scene).length).toBeLessThanOrEqual(4000);
    }
  });
  it("does not split a structured thought on a comma or semicolon", () => {
    const base = defaultRehearsalScenes()[0].plan;
    const item = "Say that the invoice is paid; no second payment, no booking.";
    const scene = sceneFromInput("s", { title: "Owner scenario", plan: { ...base, sayAsk: [item] } });
    expect(scene.plan.sayAsk).toEqual([item]);
    expect(defaultRehearsalScenes()[0].plan.sayAsk).not.toEqual([item]);
  });
  it("gives the tires rehearsal arrival/wait facts, a $400 all-in limit and conditional appointment authorization", () => {
    const scene = defaultRehearsalScenes().find(s => s.id === "trailer-tire")!;
    const text = JSON.stringify(scene.plan);
    expect(scene.title).toBe("Шины · приезд через 2 часа");
    expect(scene.plan.ownerFacts).toContain("Sergey is ready to arrive two hours from this conversation.");
    expect(scene.plan.ownerFacts).toContain("Maximum waiting time after arrival: one hour.");
    expect(scene.plan.expectedQuestions).toContainEqual({ q: "When can Sergey arrive?", answer: "In two hours." });
    expect(scene.plan.goal).toContain("Arrange an installation appointment");
    for (const phrase of ["price of the tires", "installation price", "total price", "open in two hours",
      "receive Sergey", "how long", "at most one hour", "exact appointment time and address",
      "do not book", "Opening 24/7 does not prove", "unconfirmed", "ask whether a discount",
      "Reconfirm the discounted total", "Only if the confirmed all-in price is at most $400"])
      expect(scene.plan.sayAsk.join("\n")).toContain(phrase);
    expect(text).not.toMatch(/No price ceiling|right rear inner|Do not book, order or pay|Report the seller's answers only/);
    expect(scene.plan.ownerFacts).toContain("Maximum all-in budget: $400 for the new tires and installation, including taxes and fees. Never agree to a higher total.");
    expect(scene.plan.expectedQuestions).toContainEqual({ q: "What is the budget?", answer: "At most $400 total, including new tires, installation, taxes and fees." });
    expect(scene.plan.targetPhone).toBeUndefined();
    expect(scene.plan.disclosurePolicy.forbidden.join(" ")).toContain("Agreement to a total over $400");
    expect(rehearsalInstruction(scene)).toContain("Any agreement is only simulated.");
    expect(rehearsalInstruction(scene).length).toBeLessThanOrEqual(4000);
  });
  it("preserves parking, washing and the separate waiting stand's tire plan", () => {
    const scenes = defaultRehearsalScenes();
    const parking = WAITING_LAB_PLANS.find(p => p.id === "overnight-parking")!;
    expect(scenes[1]).toMatchObject({ id: parking.id, title: parking.label, plan: parking.plan });
    expect(scenes[2].plan).toEqual({
      goal: "Ask about washing one tractor and trailer. No booking or payment.",
      ownerFacts: ["One tractor and one trailer"], sayAsk: ["Ask if truck and trailer washing is available.",
        "Ask for the total price.", "Ask about waiting time and opening hours."],
      expectedQuestions: [], unknowns: ["Price", "Availability", "Arrival time"],
      disclosurePolicy: { allowed: ["Vehicle type"], forbidden: ["Payment details", "Private contact information"] },
      language: "en", executor: "secretary", voicemail: "skip",
    });
    expect(WAITING_LAB_PLANS[0].plan.goal).toContain("maximum $400");
  });
  it("prepares pasted free text exactly like legacy prepare_call, without a phone or model", () => {
    const text = "Ask about a new trailer tire 295/75R22.5. Ask total price. Do not book or pay.";
    const { targetPhone: _phone, ...expected } = legacySecretaryPlan(text, "+12025550123");
    const scene = sceneFromText("text", { text });
    expect(scene.plan).toEqual(expected);
    expect(scene.plan.disclosurePolicy.forbidden).toEqual(["Do not book or pay."]);
    expect(rehearsalInstruction(scene)).not.toContain("+12025550123");
  });
  it.each(["raw", "fenced", "wrapped", "instruction"])("preserves ChatGPT %s plans and removes only the dialing target", mode => {
    const plan = { ...defaultRehearsalScenes()[0].plan, targetPhone: "+12025550123",
      sayAsk: ["Say the invoice was paid; no second payment, no booking."] };
    const json = JSON.stringify(plan);
    const text = mode === "fenced" ? "```json\n" + json + "\n```" :
      mode === "wrapped" ? JSON.stringify({ plan }) : mode === "instruction" ? "Owner-approved call plan.\n" + json : json;
    const scene = sceneFromText("s", { text });
    const { targetPhone: _phone, ...expected } = plan;
    expect(scene.plan).toEqual(expected);
    expect(scene.plan.sayAsk).toHaveLength(1);
  });
  it.each(["", "{bad}", "Owner-approved call plan."])("refuses empty/broken structured input %s without converting it to an assignment", text => {
    expect(() => sceneFromText("s", { text })).toThrow();
  });
  it("refuses Hint plans, extra input capabilities and oversize input", () => {
    const plan = { ...defaultRehearsalScenes()[0].plan, executor: "hint" };
    expect(() => sceneFromText("s", { text: JSON.stringify(plan) })).toThrow("SECRETARY_ONLY");
    expect(() => sceneFromText("s", { text: "Ask price", model: "injected" })).toThrow();
    expect(() => sceneFromText("s", { text: "x".repeat(12001) })).toThrow();
  });
  it.each([{ targetPhone: "+15555551234" }, { executor: "hint" }, { unknownField: true }])("rejects expanded capabilities %j", patch => {
    expect(() => sceneFromInput("s", { title: "new", plan: { ...defaultRehearsalScenes()[0].plan, ...patch } })).toThrow();
  });
  it("pins profiles without claiming a code snapshot verifies production", () => {
    const versions = rehearsalVersions();
    expect(versions.map(v => v.id)).toEqual(["production-C", "dev-C", "saved-dev-waiting", "saved-A"]);
    expect(versions[0].productionVerified).toBe(false);
    expect(versions[0].waiting).toBe(false);
    expect(versions[1]).toMatchObject({ waiting: false, manners: false, noLoop: true, productionRules: true });
    expect(versions[2]).toMatchObject({ waiting: true, manners: true, noLoop: false, productionRules: false });
    expect(new Set(versions.map(v => v.hash)).size).toBe(4);
    expect(rehearsalVersions()).toEqual(versions);
  });
  it.each(["production", "test"])("rejects environment %s", mode => {
    vi.stubEnv("NODE_ENV", mode); expect(requireRehearsalDev).toThrow("REHEARSAL_DEV_ONLY"); vi.unstubAllEnvs();
  });
  it("even development is refused on a deployment", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    expect(requireRehearsalDev).toThrow(); vi.unstubAllEnvs();
  });
});
