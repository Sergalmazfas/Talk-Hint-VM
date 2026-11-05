import { z } from "zod";
import { log, type CrewState } from "../aiCrew/domain";
import type { StateStore } from "../aiCrew/store";

export type PhoneVariant = "C" | "legacy";
export type PhoneConversationVersion = "streaming-v1" | "C-reserve";
export const PROMOTED_PHONE_CONVERSATION: PhoneConversationVersion = "streaming-v1";
export type PhoneRollout = {
  variant: PhoneVariant; changedAt: string; changedBy: string;
  conversationVersion?: PhoneConversationVersion;
  reviews: { callRef: string; ordinal: number; taskId?: string; reported?: boolean }[];
};
let store: (() => StateStore) | undefined;
export function bindPhoneRollout(value: () => StateStore) { store = value; }
export const phoneRolloutInput = z.object({
  variant: z.enum(["C", "legacy"]), revision: z.number().int().nonnegative(),
  conversationVersion: z.enum(["streaming-v1", "C-reserve"]).optional(),
}).strict();
export function rolloutState(s: CrewState): PhoneRollout {
  // Explicit owner promotion. Old saved C state gets the reviewed engine on Publish;
  // an explicit reserve selection survives restarts. No DB migration or state reset.
  const previous = s.secretaryPhoneRollout ?? { variant: "C" as const, changedAt: "", changedBy: "owner-approved-release", reviews: [] };
  return { ...previous, conversationVersion: previous.conversationVersion ?? PROMOTED_PHONE_CONVERSATION };
}
export async function selectedPhoneConfiguration(): Promise<{ variant: PhoneVariant; conversationVersion: PhoneConversationVersion }> {
  try {
    const current = rolloutState(await store!().read());
    return { variant: current.variant, conversationVersion: current.conversationVersion! };
  } catch {
    console.warn("[Secretary] Rollout control unavailable; using previous Katya");
    return { variant: "legacy", conversationVersion: "C-reserve" };
  }
}
export async function selectedPhoneVariant(): Promise<PhoneVariant> {
  return (await selectedPhoneConfiguration()).variant;
}
export function changePhoneVariant(s: CrewState, input: unknown, actor: string, now = new Date().toISOString()) {
  const command = phoneRolloutInput.parse(input);
  if (s.revision !== command.revision) throw Error("STALE_REVISION");
  s.secretaryPhoneRollout = { ...rolloutState(s), variant: command.variant,
    ...(command.conversationVersion ? { conversationVersion: command.conversationVersion } : {}),
    changedAt: now, changedBy: actor };
  log(s, actor, "secretary_phone_variant_changed", { variant: command.variant,
    conversationVersion: s.secretaryPhoneRollout.conversationVersion, nextCallsOnly: true }, now);
  return s.secretaryPhoneRollout;
}
export function claimCReview(s: CrewState, callRef: string) {
  const rollout = s.secretaryPhoneRollout ??= rolloutState(s);
  const existing = rollout.reviews.find(r => r.callRef === callRef);
  if (existing) return existing;
  if (rollout.reviews.length >= 5) return undefined;
  const entry = { callRef, ordinal: rollout.reviews.length + 1 };
  rollout.reviews.push(entry);
  log(s, "call-lab", "katya_c_review_selected", entry, new Date().toISOString());
  return entry;
}
