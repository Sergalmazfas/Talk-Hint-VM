import { secretaryPlanFromInstruction } from "../../shared/callPlan";
import { planHash } from "./store";

/** The approved instruction already binds the exact plan to recipient + task.
 * Never invent expected answers by converting a legacy natural-language task. */
export function secretaryPreparationMetadata(task: { id: string; instruction?: string; phoneNumber: string }) {
  const plan = secretaryPlanFromInstruction(task.instruction ?? "", task.phoneNumber);
  return plan ? {
    callPlan: { id: task.id, hash: planHash(plan), plan },
    callPlanPreparation: { status: "structured_plan", source: "approved_secretary_instruction" },
  } : {
    callPlanPreparation: { status: "legacy_instruction_no_structured_plan", source: "approved_secretary_instruction" },
  };
}
