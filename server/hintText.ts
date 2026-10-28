/** Remove only an explicit model wrapper, never words the owner should say. */
export function stripHintWrapper(text: string): string {
  return text.trim().replace(/^(?:you can say|suggested reply|suggestion|translation)\s*:\s*/i, "").trim();
}

export const guestTranslationTokenLimit = 600;

export function parseGuestTranslation(raw: string): string {
  const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  if (/^[{[]/.test(text)) {
    try {
      const value = JSON.parse(text);
      return typeof value.translation === "string" ? value.translation.trim() : "";
    } catch { return ""; } // Never display a truncated JSON object as translation.
  }
  return text;
}
