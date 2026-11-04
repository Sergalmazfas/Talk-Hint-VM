import { createHash } from "node:crypto";
import { compactSpeedPrompt, COMPACT_PROMPT_FALLBACK_REASON } from "../secretaryLab/speedExperiment";
import { confirmedSecretaryOwnerName } from "./ownerIdentity";
import type { PersonalityBinding } from "./personalities/types";
import type { OutgoingContext } from "./personalities/outgoing";

/** Same immutable task/cards as legacy; never truncate a plan or a policy. */
export function selectPhonePrompt(full: string, owner: string, assignment: string,
  personality?: PersonalityBinding, facts: OutgoingContext["cards"] = [], now = new Date().toISOString()) {
  try {
    const prompt = compactSpeedPrompt({ owner: confirmedSecretaryOwnerName(owner), personality,
      plan: { assignment, authorizedCards: facts }, runtimeUtc: now, telephone: true });
    return { instructions: prompt.instructions, mode: "compact" as const, reason: null,
      hash: prompt.hash, chars: prompt.chars,
      cacheKey: "katya-C-" + prompt.prefixHash.slice(0, 32) };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith(COMPACT_PROMPT_FALLBACK_REASON + ":")) throw error;
    return { instructions: full, mode: "full" as const, reason: COMPACT_PROMPT_FALLBACK_REASON,
      hash: createHash("sha256").update(full).digest("hex"), chars: full.length,
      cacheKey: "katya-C-full-v1" };
  }
}
