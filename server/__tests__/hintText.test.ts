import { describe, it, expect } from "vitest";
import { stripHintWrapper, parseGuestTranslation, guestTranslationTokenLimit } from "../hintText";
describe("Hint spoken text is not a model preamble", () => {
  for (const text of ["I see the reset menu now.", "Let me open Settings.", "Okay, it works now.",
    "I understand the charge.", "Sure, I can wait."]) {
    it(text, () => expect(stripHintWrapper(text)).toBe(text));
  }
  it("removes an explicit wrapper only", () =>
    expect(stripHintWrapper("Suggested reply: I see it.")).toBe("I see it."));
  it("never displays broken JSON as guest translation", () => {
    expect(parseGuestTranslation('{"translation":"оборван')).toBe("");
    expect(parseGuestTranslation('{"translation":"Откройте настройки"}')).toBe("Откройте настройки");
    expect(guestTranslationTokenLimit).toBeGreaterThan(80);
  });
});
