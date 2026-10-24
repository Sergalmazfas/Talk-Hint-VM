import { labPersonalitySelection } from "../../shared/secretaryLabPersonality";
import type { LabPersonalitySummary } from "../../shared/secretaryLabPersonality";
import type { PersonalityBinding } from "../secretary/personalities/types";
import { availablePersonalityVersion } from "../secretary/personalities/store";

export function parseLabPersonality(value: unknown) {
  if (value == null) return null;
  const result = labPersonalitySelection.safeParse(value);
  if (!result.success) throw Object.assign(new Error("Проверьте личность, версию и TEST-профиль"), { status: 400 });
  return result.data;
}
export async function resolveLabPersonality(value: unknown) {
  const selected = parseLabPersonality(value);
  return selected ? availablePersonalityVersion(selected.id, selected.version, selected.mode) : undefined;
}
export function labPersonalitySummary(binding?: PersonalityBinding): LabPersonalitySummary | null {
  return binding ? { id: binding.personalityId, version: binding.version, name: binding.snapshot.name, mode: binding.mode } : null;
}
