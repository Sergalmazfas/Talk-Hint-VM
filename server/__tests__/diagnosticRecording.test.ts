// Diagnostic call recording (Task #173) — unit tests for the pure policy
// helpers: transcript → reference-turn conversion and the consent policy
// configuration. The fail-closed DB capability check and TwiML wiring are
// covered by design (every check is try/caught to "do not record").

import { describe, it, expect } from "vitest";
import {
  transcriptToReferenceTurns,
  RECORDING_NOTICE_TEXT,
  RECORDING_POLICY_VERSION,
  SILENT_TEST_RECORDING_POLICY_VERSION,
  isSilentDiagnosticTestCall,
} from "../benchmark/diagnosticRecording";

describe("transcriptToReferenceTurns", () => {
  it("maps Owner/You speakers to owner role and everyone else to guest", () => {
    const turns = transcriptToReferenceTurns(
      "Owner: Hello there\nGuest: Hi, who is this?\nYou: This is Alex\nMaria: Nice to meet you",
    );
    expect(turns.map((t) => t.role)).toEqual(["owner", "guest", "owner", "guest"]);
    expect(turns.map((t) => t.idx)).toEqual([0, 1, 2, 3]);
    expect(turns[0].text).toBe("Hello there");
  });

  it("treats Russian first-person speakers as owner", () => {
    const turns = transcriptToReferenceTurns("Я: Привет\nГость: Здравствуйте");
    expect(turns[0].role).toBe("owner");
    expect(turns[1].role).toBe("guest");
  });

  it("drops empty lines and lines with empty text, keeping indices dense", () => {
    const turns = transcriptToReferenceTurns("Owner: Hi\n\nGuest:   \nGuest: Bye");
    expect(turns).toHaveLength(2);
    expect(turns.map((t) => t.idx)).toEqual([0, 1]);
    expect(turns[1].text).toBe("Bye");
  });

  it("keeps prefix-less lines as guest turns so no content is lost", () => {
    const turns = transcriptToReferenceTurns("just some words without a speaker");
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe("guest");
  });

  it("returns an empty array for an empty/missing transcript", () => {
    expect(transcriptToReferenceTurns("")).toEqual([]);
  });
});

describe("recording consent policy", () => {
  it("keeps distinct policies for global and approved diagnostic recordings", () => {
    expect(RECORDING_NOTICE_TEXT.length).toBeGreaterThan(10);
    expect(RECORDING_POLICY_VERSION).toBe("notice-v1");
    expect(SILENT_TEST_RECORDING_POLICY_VERSION).toBe("silent-test-v1");
  });

  it("allows silent recording only for the configured user and exact test number", () => {
    process.env.DIAGNOSTIC_SILENT_TEST_USER_ID = "approved-user";
    process.env.DIAGNOSTIC_SILENT_TEST_PHONE_NUMBERS = "+15550001111,+15550002222";

    expect(isSilentDiagnosticTestCall("approved-user", "+15550001111")).toBe(true);
    expect(isSilentDiagnosticTestCall("another-user", "+15550001111")).toBe(false);
    expect(isSilentDiagnosticTestCall("approved-user", "+15559999999")).toBe(false);
    expect(isSilentDiagnosticTestCall("approved-user", "5550001111")).toBe(false);

    delete process.env.DIAGNOSTIC_SILENT_TEST_USER_ID;
    delete process.env.DIAGNOSTIC_SILENT_TEST_PHONE_NUMBERS;
  });

  it("fails closed when the silent-test allowlist is absent or malformed", () => {
    delete process.env.DIAGNOSTIC_SILENT_TEST_USER_ID;
    delete process.env.DIAGNOSTIC_SILENT_TEST_PHONE_NUMBERS;
    expect(isSilentDiagnosticTestCall("approved-user", "+15550001111")).toBe(false);

    process.env.DIAGNOSTIC_SILENT_TEST_USER_ID = "approved-user";
    process.env.DIAGNOSTIC_SILENT_TEST_PHONE_NUMBERS = "not-a-number";
    expect(isSilentDiagnosticTestCall("approved-user", "+15550001111")).toBe(false);

    delete process.env.DIAGNOSTIC_SILENT_TEST_USER_ID;
    delete process.env.DIAGNOSTIC_SILENT_TEST_PHONE_NUMBERS;
  });
});

describe("canonicalRecordingUrl (SSRF guard)", () => {
  const AC = "AC" + "a".repeat(32);
  const RE = "RE" + "b".repeat(32);
  it("builds the URL from a valid RecordingSid", async () => {
    const { canonicalRecordingUrl } = await import("../benchmark/recordedCalls");
    expect(canonicalRecordingUrl(undefined, RE, AC))
      .toBe(`https://api.twilio.com/2010-04-01/Accounts/${AC}/Recordings/${RE}`);
  });
  it("accepts only a canonical Twilio URL for OUR account", async () => {
    const { canonicalRecordingUrl } = await import("../benchmark/recordedCalls");
    const good = `https://api.twilio.com/2010-04-01/Accounts/${AC}/Recordings/${RE}`;
    expect(canonicalRecordingUrl(good, undefined, AC)).toBe(good);
    expect(() => canonicalRecordingUrl(`https://evil.example.com/x`, undefined, AC)).toThrow();
    expect(() => canonicalRecordingUrl(`https://api.twilio.com/2010-04-01/Accounts/AC${"c".repeat(32)}/Recordings/${RE}`, undefined, AC)).toThrow();
    expect(() => canonicalRecordingUrl(`https://api.twilio.com@evil.com/2010-04-01/Accounts/${AC}/Recordings/${RE}`, undefined, AC)).toThrow();
    expect(() => canonicalRecordingUrl(undefined, "not-a-sid", AC)).toThrow();
  });
});
