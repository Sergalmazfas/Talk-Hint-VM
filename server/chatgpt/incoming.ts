/**
 * Deliberately not imported into the Twilio voice webhook. This is a policy
 * seam for a separately approved future implementation, not a routing switch.
 */
export type ConditionalAnswerPolicy = {
  ownerId: string;
  condition: "busy" | "no_answer" | "unavailable";
  explicitlyApproved: boolean;
};
export function evaluateIncomingSecretaryPolicy(_policy?: ConditionalAnswerPolicy): {
  action: "preserve_native"; aiAnswerEnabled: false; reason: string;
} {
  return { action: "preserve_native", aiAnswerEnabled: false,
    reason: "AI answering requires separate approval and a verified call handoff implementation." };
}
