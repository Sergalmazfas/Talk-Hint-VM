import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Coverage for the pure AirAtoma webhook helpers (server/airatomaWebhook.ts):
//   - renderTranscriptText: flatten turns into "Speaker: text" lines, uncapped.
//   - buildAirAtomaPayload: shape the exact contract body; normalize duration;
//     include recordingUrl only when present.
//   - airAtomaConfigError: classify the configured URL (unset/invalid/ok).
// These are dependency-free, so no DB / Deepgram / server bootstrap is needed.
// ---------------------------------------------------------------------------

const { renderTranscriptText, buildAirAtomaPayload, airAtomaConfigError } =
  await import("../airatomaWebhook");

describe("renderTranscriptText", () => {
  it("joins turns as 'Speaker: text' lines", () => {
    expect(
      renderTranscriptText([
        { speaker: "Owner", text: "Hi there" },
        { speaker: "Guest", text: "Hello" },
      ]),
    ).toBe("Owner: Hi there\nGuest: Hello");
  });

  it("returns an empty string for no turns", () => {
    expect(renderTranscriptText([])).toBe("");
  });
});

describe("buildAirAtomaPayload", () => {
  it("builds the contract body and rounds duration to a whole number", () => {
    const payload = buildAirAtomaPayload({
      callId: "CA123",
      transcript: [{ speaker: "Guest", text: "Hello" }],
      callerName: "Jane",
      durationSecs: 12.7,
    });
    expect(payload).toEqual({
      callId: "CA123",
      transcript: "Guest: Hello",
      callerName: "Jane",
      durationSecs: 13,
    });
  });

  it("never emits a negative duration", () => {
    const payload = buildAirAtomaPayload({
      callId: "CA1",
      transcript: [],
      callerName: "x",
      durationSecs: -5,
    });
    expect(payload.durationSecs).toBe(0);
  });

  it("includes recordingUrl only when present and non-empty", () => {
    expect(
      buildAirAtomaPayload({
        callId: "CA1",
        transcript: [],
        callerName: "x",
        durationSecs: 0,
        recordingUrl: "  https://rec/1.mp3  ",
      }).recordingUrl,
    ).toBe("https://rec/1.mp3");

    expect(
      "recordingUrl" in
        buildAirAtomaPayload({
          callId: "CA1",
          transcript: [],
          callerName: "x",
          durationSecs: 0,
          recordingUrl: "   ",
        }),
    ).toBe(false);

    expect(
      "recordingUrl" in
        buildAirAtomaPayload({
          callId: "CA1",
          transcript: [],
          callerName: "x",
          durationSecs: 0,
        }),
    ).toBe(false);
  });
});

describe("airAtomaConfigError", () => {
  it("reports 'unset' when no URL is configured", () => {
    expect(airAtomaConfigError(undefined)).toBe("unset");
    expect(airAtomaConfigError("")).toBe("unset");
  });

  it("reports 'invalid' for a non-http(s) value", () => {
    expect(airAtomaConfigError("example.com/webhook")).toBe("invalid");
    expect(airAtomaConfigError("ftp://example.com")).toBe("invalid");
    expect(airAtomaConfigError("httpx://example.com")).toBe("invalid");
  });

  it("accepts http and https URLs", () => {
    expect(airAtomaConfigError("http://localhost:3000/api/talkhint/webhook")).toBeNull();
    expect(airAtomaConfigError("https://airatoma.example/api/talkhint/webhook")).toBeNull();
  });
});
