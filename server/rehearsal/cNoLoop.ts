import { createHash } from "node:crypto";
import type { EngineStream } from "../secretary/conversationEngine";
import { C_BOUNDED_CLARIFICATION_BODY } from "../secretary/cNoLoop";

/** A single prompt-only experiment. No timers, transcript classifiers or output filters. */
export const C_NO_LOOP_POLICY = "DEV REHEARSAL — bounded clarification, subordinate to all identity, safety, plan and IVR rules:\n" +
  C_BOUNDED_CLARIFICATION_BODY;
export const C_NO_LOOP_POLICY_HASH = createHash("sha256").update(C_NO_LOOP_POLICY).digest("hex");

export function withCNoLoopRule(stream: EngineStream): EngineStream {
  return request => stream({ ...request, input: [
    ...request.input, { role: "developer", content: C_NO_LOOP_POLICY },
  ] });
}
