import { describe, it, expect } from "vitest";
import {
  isQuestionOrActionRequest,
  resolveWaitState,
  WAIT_PATTERNS,
  EXIT_WAIT_PATTERNS,
} from "../waitState";

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

describe("resolveWaitState (shared by LIVE and TRAINING modes)", () => {
  it("training scenario: 'let me check' enters, then a question lifts the wait state", () => {
    // GST: "Let me check, one moment."
    let s = resolveWaitState(false, "Let me check, one moment.");
    expect(s.waiting).toBe(true);
    expect(s.event).toBe("entered");

    // GST comes back with a real question — hint MUST NOT be blocked.
    s = resolveWaitState(s.waiting, "Are you using an iPhone or an Android device?");
    expect(s.waiting).toBe(false);
    expect(s.event).toBe("exited_question");
  });

  it("question without a question mark also lifts the wait state", () => {
    const s = resolveWaitState(true, "Just to confirm, you're trying to activate your eSIM on your new phone");
    expect(s.waiting).toBe(false);
    expect(s.event).toBe("exited_question");
  });

  it("hold phrase with an embedded question exits, not stays waiting", () => {
    const s = resolveWaitState(false, "Let me check — are you on an iPhone?");
    expect(s.waiting).toBe(false);
    expect(s.event).toBe("exited_question");
  });

  it("real answer exits the wait state", () => {
    const s = resolveWaitState(true, "Unfortunately we have no openings tomorrow.");
    expect(s.waiting).toBe(false);
    expect(s.event).toBe("exited_answer");
  });

  it("pure hold phrase keeps waiting", () => {
    const s = resolveWaitState(true, "Bear with me while I look into this.");
    expect(s.waiting).toBe(true);
    expect(s.event).toBe("still_waiting");
  });

  it("neutral chatter does not enter or exit", () => {
    expect(resolveWaitState(false, "Alright.")).toEqual({ waiting: false, event: null });
    expect(resolveWaitState(true, "Hmm, mm-hmm.")).toEqual({ waiting: true, event: null });
  });

  it("shared patterns match both modes' historical triggers", () => {
    expect(WAIT_PATTERNS.test("just a minute")).toBe(true); // training-only before
    expect(EXIT_WAIT_PATTERNS.test("starting at fifty per hour")).toBe(true); // live-only before
    expect(EXIT_WAIT_PATTERNS.test("we can do Tuesday")).toBe(true); // training-only before
  });
});
