import { describe, it, expect } from "vitest";
import { isQuestionOrActionRequest } from "../waitState";

describe("isQuestionOrActionRequest", () => {
  describe("real questions from the 2026-08-08 prod call MUST lift the wait state", () => {
    it("confirmation question about eSIM activation", () => {
      expect(
        isQuestionOrActionRequest(
          "Just to confirm, you're trying to activate your eSIM on your new phone, right?",
        ),
      ).toBe(true);
    });
    it("same phrase without a question mark (STT often drops it)", () => {
      expect(
        isQuestionOrActionRequest(
          "Just to confirm, you're trying to activate your eSIM on your new phone",
        ),
      ).toBe(true);
    });
    it("device question", () => {
      expect(isQuestionOrActionRequest("Are you using an iPhone or an Android device?")).toBe(true);
    });
    it("device question without a question mark", () => {
      expect(isQuestionOrActionRequest("Are you using an iPhone or an Android device")).toBe(true);
    });
  });

  describe("other questions / action requests", () => {
    it("do-you question", () => {
      expect(isQuestionOrActionRequest("Do you have the QR code we sent you")).toBe(true);
    });
    it("did-you question", () => {
      expect(isQuestionOrActionRequest("Did you receive the confirmation email")).toBe(true);
    });
    it("have-you question", () => {
      expect(isQuestionOrActionRequest("Have you tried restarting the phone")).toBe(true);
    });
    it("WH-question at sentence start", () => {
      expect(isQuestionOrActionRequest("What phone model do you have")).toBe(true);
    });
    it("WH-question after a hold phrase in the same utterance", () => {
      expect(
        isQuestionOrActionRequest("Okay, I'll help you out. When did you first see this error?"),
      ).toBe(true);
    });
    it("please-provide request", () => {
      expect(isQuestionOrActionRequest("Please provide the account number on file")).toBe(true);
    });
    it("can-you-tell-me request", () => {
      expect(isQuestionOrActionRequest("Can you tell me the last four digits of your card")).toBe(true);
    });
    it("go-ahead-and action request", () => {
      expect(isQuestionOrActionRequest("Go ahead and open your settings app for me")).toBe(true);
    });
    it("bare question mark from rising intonation", () => {
      expect(isQuestionOrActionRequest("You already installed the profile?")).toBe(true);
    });
  });

  describe("pure hold / wait phrases must NOT lift the wait state", () => {
    it("classic hold phrase", () => {
      expect(isQuestionOrActionRequest("I'll help you out, let me check on that for you.")).toBe(false);
    });
    it("let me see what I can do (WH inside a hold phrase)", () => {
      expect(isQuestionOrActionRequest("Let me see what I can do for you.")).toBe(false);
    });
    it("one moment please", () => {
      expect(isQuestionOrActionRequest("One moment please, I'm pulling up the account.")).toBe(false);
    });
    it("bear with me", () => {
      expect(isQuestionOrActionRequest("Bear with me while I look into this.")).toBe(false);
    });
    it("thank you, I'll wait (owner-side wait-ACK phrasing)", () => {
      expect(isQuestionOrActionRequest("Thank you. I'll wait.")).toBe(false);
    });
    it("empty / whitespace", () => {
      expect(isQuestionOrActionRequest("")).toBe(false);
      expect(isQuestionOrActionRequest("   ")).toBe(false);
    });
    it("plain status update", () => {
      expect(isQuestionOrActionRequest("Still checking the system, almost there.")).toBe(false);
    });
  });
});
