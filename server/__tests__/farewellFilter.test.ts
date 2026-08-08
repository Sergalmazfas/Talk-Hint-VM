import { describe, it, expect } from "vitest";
import { isFarewellUtterance } from "../farewellFilter";

describe("isFarewellUtterance", () => {
  describe("working lines with polite prefixes are NOT farewells (regression)", () => {
    it("operator looking up an account", () => {
      expect(
        isFarewellUtterance("Thanks. I'm just looking for your Mint Mobile account."),
      ).toBe(false);
    });
    it("thanks + status update", () => {
      expect(
        isFarewellUtterance("Thanks for letting me know what's going on. Sorry about the trouble."),
      ).toBe(false);
    });
    it("greeting with thanks-for-calling + notice", () => {
      expect(
        isFarewellUtterance(
          "Thanks for calling Mint Mobile. FYI, your call may be monitored or recorded for training purposes.",
        ),
      ).toBe(false);
    });
    it("appreciate it + real content", () => {
      expect(
        isFarewellUtterance("Appreciate it. Let me pull up the details on that line for you now."),
      ).toBe(false);
    });
    it("short working lines with thanks prefix", () => {
      expect(isFarewellUtterance("Thanks, I will check the account.")).toBe(false);
      expect(isFarewellUtterance("Thanks, I will email the details.")).toBe(false);
      expect(isFarewellUtterance("Appreciate it, I will follow up.")).toBe(false);
    });
    it("looking forward to our meeting is content, not a closer", () => {
      expect(isFarewellUtterance("Looking forward to our meeting.")).toBe(false);
    });
  });

  describe("real farewells are still detected", () => {
    it("plain goodbye", () => {
      expect(isFarewellUtterance("Goodbye.")).toBe(true);
    });
    it("have a great day", () => {
      expect(isFarewellUtterance("You're all set, have a great day.")).toBe(true);
    });
    it("short thanks-only closer", () => {
      expect(isFarewellUtterance("Okay, thank you so much.")).toBe(true);
    });
    it("thanks, bye combo", () => {
      expect(isFarewellUtterance("Thanks, bye!")).toBe(true);
    });
    it("take care", () => {
      expect(isFarewellUtterance("Alright, take care now.")).toBe(true);
    });
    it("see you / until then", () => {
      expect(isFarewellUtterance("See you then.")).toBe(true);
      expect(isFarewellUtterance("Until tomorrow.")).toBe(true);
    });
    it("plain talk-to-you closers", () => {
      expect(isFarewellUtterance("Talk to you.")).toBe(true);
      expect(isFarewellUtterance("Speak with you.")).toBe(true);
    });
    it("thanks again as pure closer", () => {
      expect(isFarewellUtterance("Thanks again!")).toBe(true);
      expect(isFarewellUtterance("Okay, thanks so much.")).toBe(true);
    });
  });

  describe("questions and actionable content are never farewells", () => {
    it("question mark", () => {
      expect(isFarewellUtterance("Thanks, what time works best?")).toBe(false);
    });
    it("scheduling keyword without question mark", () => {
      expect(isFarewellUtterance("Thanks, let me book that appointment")).toBe(false);
    });
    it("hard farewell wording but with a question", () => {
      expect(isFarewellUtterance("Before you go, can you confirm the address?")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("empty / whitespace", () => {
      expect(isFarewellUtterance("")).toBe(false);
      expect(isFarewellUtterance("   ")).toBe(false);
    });
    it("neutral sentence", () => {
      expect(isFarewellUtterance("Your account number ends in four two.")).toBe(false);
    });
  });
});
