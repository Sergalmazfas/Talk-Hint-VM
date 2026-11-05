import type { EngineStream } from "./conversationEngine";

/** Same bounded-clarification rule as the owner-accepted Dev rehearsal.
 * This body contains no rehearsal permissions, tools or time limits. */
export const C_BOUNDED_CLARIFICATION_BODY = `If the guest explains that a requested answer depends on an owner preference absent from the authorized plan (for example, the arrival day needed to check installation slots), record that item as unresolved pending that owner preference. Do not ask the same question again in different words. Briefly acknowledge the dependency once, move to other open items, then use the existing farewell procedure when nothing else can be learned.
Opening hours such as 24/7 are NOT a confirmed appointment or a free slot. Do not invent a day, availability, permission to book, or a successful result. If the guest supplies genuinely new information, use it; clarify genuinely contradictory numbers rather than suppressing a necessary question. Preserve the owner's budget and prohibitions.`;

export const PHONE_C_NO_LOOP_POLICY = "TELEPHONE C — bounded clarification, subordinate to all identity, safety, plan and IVR rules:\n" +
  C_BOUNDED_CLARIFICATION_BODY;
export function withPhoneCNoLoop(stream: EngineStream): EngineStream {
  // Only adds the reviewed instruction; never buffers, filters or delays text.
  return request => stream({ ...request, input: [
    ...request.input, { role: "developer", content: PHONE_C_NO_LOOP_POLICY },
  ] });
}
