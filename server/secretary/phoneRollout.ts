import { z } from "zod";
import { log, type CrewState } from "../aiCrew/domain";
import type { StateStore } from "../aiCrew/store";

export type PhoneVariant = "C" | "legacy";
export type PhoneRollout = {
  variant: PhoneVariant; changedAt: string; changedBy: string;
  reviews: { callRef: string; ordinal: number; taskId?: string; reported?: boolean }[];
};
let store: (() => StateStore) | undefined;
export function bindPhoneRollout(value: () => StateStore) { store = value; }
export const phoneRolloutInput = z.object({
  variant: z.enum(["C", "legacy"]), revision: z.number().int().nonnegative(),
}).strict();
export function rolloutState(s: CrewState): PhoneRollout {
  // Explicit owner promotion: C becomes the default only when this code is published.
  return s.secretaryPhoneRollout ?? { variant: "C", changedAt: "", changedBy: "owner-approved-release", reviews: [] };
}
export async function selectedPhoneVariant(): Promise<PhoneVariant> {
  try { return rolloutState(await store!().read()).variant; }
  catch { console.warn("[Secretary] Rollout control unavailable; using previous Katya"); return "legacy"; }
}
export function changePhoneVariant(s: CrewState, input: unknown, actor: string, now = new Date().toISOString()) {
  const command = phoneRolloutInput.parse(input);
  if (s.revision !== command.revision) throw Error("STALE_REVISION");
  s.secretaryPhoneRollout = { ...rolloutState(s), variant: command.variant, changedAt: now, changedBy: actor };
  log(s, actor, "secretary_phone_variant_changed", { variant: command.variant, nextCallsOnly: true }, now);
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
