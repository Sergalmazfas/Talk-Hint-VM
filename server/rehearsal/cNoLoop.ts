import { createHash } from "node:crypto";
import type { EngineStream } from "../secretary/conversationEngine";

/** A single prompt-only experiment. No timers, transcript classifiers or output filters. */
export const C_NO_LOOP_POLICY = `DEV REHEARSAL — bounded clarification, subordinate to all identity, safety, plan and IVR rules:
If the guest explains that a requested answer depends on an owner preference absent from the authorized plan (for example, the arrival day needed to check installation slots), record that item as unresolved pending that owner preference. Do not ask the same question again in different words. Briefly acknowledge the dependency once, move to other open items, then use the existing farewell procedure when nothing else can be learned.
Opening hours such as 24/7 are NOT a confirmed appointment or a free slot. Do not invent a day, availability, permission to book, or a successful result. If the guest supplies genuinely new information, use it; clarify genuinely contradictory numbers rather than suppressing a necessary question. Preserve the owner's budget and prohibitions.`;
export const C_NO_LOOP_POLICY_HASH = createHash("sha256").update(C_NO_LOOP_POLICY).digest("hex");

export function withCNoLoopRule(stream: EngineStream): EngineStream {
  return request => stream({ ...request, input: [
    ...request.input, { role: "developer", content: C_NO_LOOP_POLICY },
  ] });
}
