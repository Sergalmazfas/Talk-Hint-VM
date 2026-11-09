import { callPlanSchema, checklistCallPlan, secretaryInstruction, type CallPlan } from "../../shared/callPlan";
import { planHash } from "../callPlans/store";
import { ChatError } from "./contracts";

/** A model may propose data, never approve it or acquire a dialing capability. */
export type ChatPlanAction = {
  plan: CallPlan;
  planHash: string;
  status: "proposed" | "confirmed";
  result?: { id?: string; status?: string; expiresAt?: string; taskId?: string };
};
export function proposedPlan(raw: unknown): ChatPlanAction {
  const parsed = callPlanSchema.safeParse(raw);
  if (!parsed.success) throw new ChatError("INVALID_CALL_PLAN", 422);
  const plan = checklistCallPlan(parsed.data);
  if (!plan.sayAsk.length) throw new ChatError("PLAN_CHECKLIST_REQUIRED", 422);
  // Do not truncate or silently discard restrictions to fit Secretary's existing limit.
  if (plan.executor === "secretary") {
    if (!plan.targetPhone || !/^\+1\d{10}$/.test(plan.targetPhone))
      throw new ChatError("SECRETARY_PHONE_REQUIRED", 422);
    try { secretaryInstruction(plan); }
    catch { throw new ChatError("SECRETARY_PLAN_TOO_LONG", 422); }
  }
  return { plan, planHash: planHash(plan), status: "proposed" };
}

export interface ChatPlanBackend {
  saveHint(owner: string, requestId: string, plan: CallPlan): Promise<ChatPlanAction["result"]>;
  reviewSecretary(owner: string, plan: CallPlan, source?: { conversationId: string; messageId: string }): Promise<{
    phoneNumber: string; instruction: string; confirmationToken: string;
  }>;
}
/** Reuse existing storage and the native review authorization. No dialer import. */
export const nativePlanBackend: ChatPlanBackend = {
  async saveHint(owner, requestId, plan) {
    const { callPlans } = await import("../callPlans/runtime");
    const result = await (await callPlans()).save(owner, requestId, plan);
    return { id: result.id, status: result.status, expiresAt: new Date(result.expiresAt).toISOString() };
  },
  async reviewSecretary(owner, plan, source) {
    const instruction = secretaryInstruction(plan);
    const { signSecretaryConfirmation } = await import("../secretary/confirmation");
    return { phoneNumber: plan.targetPhone!, instruction,
      confirmationToken: signSecretaryConfirmation(owner, instruction, source) };
  },
};
