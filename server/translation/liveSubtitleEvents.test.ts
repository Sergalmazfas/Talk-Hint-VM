import { describe, expect, it } from "vitest";
import {
  buildGuestSubtitleEvent,
  buildGuestTranscriptFinalEvent,
  buildOwnerSubtitleEvent,
  buildOwnerTranscriptFinalEvent,
  buildSubtitleUnavailableEvent,
} from "./liveSubtitleEvents";

describe("live owner subtitle event contract", () => {
  it("emits numeric utterance IDs as matching string turn IDs on transcript and subtitle", () => {
    const transcript = buildOwnerTranscriptFinalEvent({
      text: "I will ask about the return.",
      confidence: 0.97,
      utteranceId: 42,
      callSid: "CA0123456789abcdef0123456789abcdef",
    });
    const subtitle = buildOwnerSubtitleEvent({
      turnId: transcript.utteranceId,
      translation: "Я спрошу о возврате.",
      language: "ru",
      callSid: transcript.callSid,
    });

    expect(transcript).toEqual({
      type: "owner_transcript",
      text: "I will ask about the return.",
      isFinal: true,
      isComplete: true,
      confidence: 0.97,
      utteranceId: 42,
      turnId: "42",
      callSid: "CA0123456789abcdef0123456789abcdef",
    });
    expect(typeof transcript.turnId).toBe("string");
    expect(subtitle).toMatchObject({
      type: "owner_translation",
      turnId: transcript.turnId,
      language: "ru",
      callSid: transcript.callSid,
    });
  });

  it("emits guest originals immediately and a separate subtitle with the same string ID", () => {
    const transcript = buildGuestTranscriptFinalEvent({
      text: "The office closes at five.",
      confidence: 0.93,
      utteranceId: 81,
      callSid: "CA0123456789abcdef0123456789abcdef",
    });
    const subtitle = buildGuestSubtitleEvent({
      turnId: transcript.utteranceId,
      translation: "Офис закрывается в пять.",
      language: "ru",
      callSid: transcript.callSid,
    });

    expect(transcript).toMatchObject({
      type: "guest_transcript",
      text: "The office closes at five.",
      translation: "",
      turnId: "81",
      isFinal: true,
    });
    expect(subtitle).toMatchObject({
      type: "guest_subtitle",
      turnId: transcript.turnId,
      callSid: transcript.callSid,
    });
  });

  it("gives an explicit per-turn unavailable state when translation cannot be delivered", () => {
    expect(buildSubtitleUnavailableEvent({
      turnId: 100,
      role: "owner",
      language: "es",
      reason: "queue_full",
      callSid: "CA0123456789abcdef0123456789abcdef",
    })).toEqual({
      type: "subtitle_unavailable",
      turnId: "100",
      role: "owner",
      language: "es",
      reason: "queue_full",
      callSid: "CA0123456789abcdef0123456789abcdef",
    });
  });
});