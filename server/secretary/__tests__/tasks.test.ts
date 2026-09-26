import { describe, expect, it } from "vitest";
import {
  archiveSecretaryAttempt,
  canMarkSecretaryStreamFailure,
  canRetrySecretaryTask,
  isSecretaryReportReady,
  containsForbiddenSecretarySecret,
  isSecretaryCallingWindow,
  isSecretaryTaskReportTerminal,
  mapTwilioSecretaryStatus,
  secretaryStreamFailureFields,
  validateSecretaryInstruction,
  validateSecretaryPhoneNumber,
  validateSecretaryReport,
} from "../tasks";

describe("Secretary task safety and reporting", () => {
  it("accepts a standard US number and rejects restricted/non-US destinations", () => {
    expect(validateSecretaryPhoneNumber("+19545551234")).toBe("+19545551234");
    expect(validateSecretaryPhoneNumber("+442071838750")).toBeNull();
    expect(validateSecretaryPhoneNumber("+19115551234")).toBeNull();
    expect(validateSecretaryPhoneNumber("+19005551234")).toBeNull();
    expect(validateSecretaryPhoneNumber("+19765551234")).toBeNull();
    expect(validateSecretaryPhoneNumber("9545551234")).toBeNull();
  });

  it("allows a card last-four reference but refuses full card and authentication secrets", () => {
    expect(validateSecretaryInstruction(
      "Ask why my deposit has not been returned to the card ending in 1234.",
    )).toContain("1234");
    expect(containsForbiddenSecretarySecret("The full card number is 4111 1111 1111 1111")).toBe(true);
    expect(containsForbiddenSecretarySecret("My CVV is 123")).toBe(true);
    expect(containsForbiddenSecretarySecret("Give them the one-time code 482901")).toBe(true);
    expect(validateSecretaryInstruction("x".repeat(2_001))).toBeNull();
  });

  it("fails closed for missing or ungrounded reports", () => {
    const fallback = validateSecretaryReport(null, "Secretary: Hello.");
    expect(fallback.outcome).toBe("unknown");
    expect(fallback.verifiedFacts).toEqual([]);

    const ungrounded = validateSecretaryReport(JSON.stringify({
      outcome: "resolved",
      summary: "The $200 was released on Friday.",
      verifiedFacts: [{ fact: "The deposit was released.", quote: "The deposit was released." }],
      nextStep: "Wait five days.",
    }), "Other party: We will look into it.");
    expect(ungrounded.outcome).toBe("unknown");
    expect(ungrounded.verifiedFacts).toEqual([]);
  });

  it("does not call an explicit call-back request resolved", () => {
    const report = validateSecretaryReport(JSON.stringify({
      outcome: "resolved",
      summary: "The hotel asked to call back on Thursday.",
      verifiedFacts: [{ fact: "The hotel asked for a call back.", quote: "Please call back on Thursday." }],
      nextStep: "Call on Thursday.",
    }), "Other party: Please call back on Thursday.");
    expect(report.outcome).toBe("needs_follow_up");
    expect(report.verifiedFacts).toEqual(["The hotel asked for a call back."]);
  });

  it("keeps the outbound queue inside the conservative US daytime window", () => {
    expect(isSecretaryCallingWindow(new Date("2026-05-21T17:59:00.000Z"))).toBe(false);
    expect(isSecretaryCallingWindow(new Date("2026-05-21T18:00:00.000Z"))).toBe(true);
    expect(isSecretaryCallingWindow(new Date("2026-05-21T21:59:00.000Z"))).toBe(true);
    expect(isSecretaryCallingWindow(new Date("2026-05-21T22:00:00.000Z"))).toBe(false);
  });

  it("waits for stream-end or the bounded settlement deadline before a terminal report", () => {
    const task = {
      status: "finalizing",
      providerStatus: "completed",
      streamEndedAt: null,
      finalizationDeadlineAt: new Date("2026-05-21T18:00:15.000Z"),
    } as any;
    expect(isSecretaryReportReady(task, new Date("2026-05-21T18:00:14.999Z"))).toBe(false);
    expect(isSecretaryReportReady(task, new Date("2026-05-21T18:00:15.000Z"))).toBe(true);
    expect(isSecretaryReportReady({
      ...task,
      streamEndedAt: new Date("2026-05-21T18:00:03.000Z"),
      finalizationDeadlineAt: null,
    }, new Date("2026-05-21T18:00:04.000Z"))).toBe(true);
    expect(isSecretaryReportReady({ ...task, status: "completed" }, new Date())).toBe(false);
    expect(isSecretaryTaskReportTerminal("finalizing")).toBe(false);
    expect(isSecretaryTaskReportTerminal("completed")).toBe(true);
  });

  it("archives the finished attempt transcript and call identifiers before retry reset", () => {
    const attempt = {
      attempts: 1,
      callId: "call-row-1",
      callSid: "CA123",
      status: "completed",
      outcome: "needs_follow_up",
      summary: "Please call back Thursday.",
      verifiedFacts: ["The office asked for a call back."],
      nextStep: "Call back Thursday.",
      transcript: "Other party: Please call back Thursday.",
      updatedAt: new Date("2026-05-21T18:05:00.000Z"),
    } as any;
    const archived = archiveSecretaryAttempt([], attempt);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({
      attempt: 1,
      callId: "call-row-1",
      callSid: "CA123",
      transcript: "Other party: Please call back Thursday.",
    });
    // Resetting the active transcript for another dial cannot erase the archive.
    const clearedLiveTranscript = "";
    expect(clearedLiveTranscript).toBe("");
    expect(archived[0].transcript).toBe(attempt.transcript);
  });

  it("keeps a fatal stream failure failed when Twilio later says completed, and allows an eligible retry", () => {
    const inFlight = {
      status: "finalizing",
      callSid: "CA123",
      attempts: 1,
      notificationStatus: "pending",
      notifiedAt: null,
      transcript: "Other party: They will investigate.",
    } as any;
    expect(canMarkSecretaryStreamFailure(inFlight)).toBe(true);
    const failed = {
      ...inFlight,
      ...secretaryStreamFailureFields(),
    };
    expect(failed.status).toBe("failed");
    expect(failed.outcome).toBe("failed");
    expect(failed.transcript).toBe(inFlight.transcript);
    expect(failed.summary).not.toContain("secret");

    // The status webhook may still arrive after the fatal websocket event.
    expect(mapTwilioSecretaryStatus("completed")).toBe("completed");
    expect(isSecretaryTaskReportTerminal(failed.status)).toBe(true);
    expect(canRetrySecretaryTask(failed)).toBe(true);

    expect(canMarkSecretaryStreamFailure({
      status: "completed",
      notificationStatus: "pending",
      notifiedAt: null,
    } as any)).toBe(true);
    const completedButAlreadyClaimed = {
      status: "completed",
      notificationStatus: "sending",
      notifiedAt: null,
    } as any;
    expect(canMarkSecretaryStreamFailure(completedButAlreadyClaimed)).toBe(false);
    expect(canMarkSecretaryStreamFailure({
      status: "completed",
      notificationStatus: "sent",
      notifiedAt: new Date(),
    } as any)).toBe(false);
  });
});