import { describe, expect, it } from "vitest";
import { elapsedClientMs, elevenProxySocketUrl, isElevenReportEnded } from "./eleven-engine-helpers";

describe("ElevenLabs Engine browser proxy helpers", () => {
  it("uses a secure same-origin websocket URL and preserves the one-time path", () => {
    expect(elevenProxySocketUrl("/eleven-engine-audio/one-time", "https://lab.example.test"))
      .toBe("wss://lab.example.test/eleven-engine-audio/one-time");
  });

  it("rejects absolute and protocol-relative proxy URLs", () => {
    expect(() => elevenProxySocketUrl("wss://provider.example/secret", "https://lab.example.test")).toThrow();
    expect(() => elevenProxySocketUrl("//provider.example/secret", "https://lab.example.test")).toThrow();
  });

  it("recognizes terminal server reports", () => {
    expect(isElevenReportEnded("ended")).toBe(true);
    expect(isElevenReportEnded("failed")).toBe(true);
    expect(isElevenReportEnded("live")).toBe(false);
    expect(isElevenReportEnded("stop_failed")).toBe(false);
  });

  it("keeps client playback timing non-negative and rounded", () => {
    expect(elapsedClientMs(100, 124.7)).toBe(25);
    expect(elapsedClientMs(100, 50)).toBe(0);
  });
});
