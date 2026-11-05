import { callPlanSchema, type CallPlan } from "./callPlan";

/** Fictional seller role-play, never an authorization to dial/order/pay. */
const base = {
  ownerFacts: [] as string[], expectedQuestions: [] as CallPlan["expectedQuestions"],
  unknowns: ["Availability and the seller's actual terms are unknown."],
  disclosurePolicy: { allowed: ["The requested item, position and spending ceiling."],
    forbidden: ["Payment credentials or unconfirmed personal details."] },
  language: "en" as const, executor: "secretary" as const, voicemail: "skip" as const,
};
export const WAITING_LAB_PLANS = [
  { id: "trailer-tire", label: "Новая шина 295/75R22.5 · до $400",
    plan: callPlanSchema.parse({ ...base,
      goal: "Ask a seller about ONE NEW trailer tire, 295/75R22.5, right rear inner position, maximum $400.",
      ownerFacts: ["Size: 295/75R22.5.", "Position: trailer, right rear inner.", "New only; budget ceiling $400."],
      sayAsk: ["Ask whether the new tire is in stock.", "Ask the brand and total price, including installation and taxes.",
        "Ask when installation is possible.", "Do not book, order or pay. Report the seller's answers only."] }) },
  { id: "overnight-parking", label: "Парковка для тягача на ночь",
    plan: callPlanSchema.parse({ ...base,
      goal: "Ask about overnight truck parking, without making a reservation.",
      ownerFacts: ["The owner needs truck parking for one night."],
      sayAsk: ["Ask whether overnight truck parking is available.", "Ask the overnight price and permitted arrival/departure times.",
        "Ask whether a reservation is required.", "Do not reserve or pay. If the date is needed, it is unknown; do not invent it."] }) },
] as const;
export function waitingPlanInstruction(plan: CallPlan): string {
  return ["DEV ROLE-PLAY ONLY: you are calling the seller played by the user, not receiving a callback.",
    `Goal: ${plan.goal}`, ...plan.ownerFacts.map(f => `Fact: ${f}`),
    ...plan.sayAsk.map((f, i) => `${i + 1}. ${f}`),
    "Pause silently after one brief acknowledgement when the seller goes to check.",
    "Unknown answers must not be invented. No real calls, bookings, payments or notifications."].join("\n");
}
export function waitingPlanSelection(variant: string, instruction: string, id?: unknown) {
  if (id === undefined) return undefined;
  const preset = WAITING_LAB_PLANS.find(p => p.id === id);
  if (variant !== "C" || !preset || instruction !== waitingPlanInstruction(preset.plan))
    throw Object.assign(Error("INVALID_WAITING_LAB_PLAN"), { status: 400 });
  return { id: preset.id, source: "dev-preset" as const, fictional: true as const,
    plan: JSON.parse(JSON.stringify(preset.plan)) as CallPlan };
}
