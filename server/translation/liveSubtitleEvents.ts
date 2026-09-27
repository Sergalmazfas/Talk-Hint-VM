import type { SubtitleLanguage, SubtitleUnavailableReason } from "./textSubtitle";

export interface OwnerTranscriptFinalEvent {
  type: "owner_transcript";
  text: string;
  isFinal: true;
  isComplete: true;
  confidence?: number;
  utteranceId: number | string;
  turnId: string;
  callSid: string | null;
}

export function buildOwnerTranscriptFinalEvent(input: {
  text: string;
  confidence?: number;
  utteranceId: number | string;
  callSid: string | null;
}): OwnerTranscriptFinalEvent {
  return {
    type: "owner_transcript",
    text: input.text,
    isFinal: true,
    isComplete: true,
    ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
    utteranceId: input.utteranceId,
    turnId: String(input.utteranceId),
    callSid: input.callSid,
  };
}

export function buildGuestTranscriptFinalEvent(input: {
  text: string;
  confidence?: number;
  utteranceId: number | string;
  callSid: string | null;
}) {
  return {
    type: "guest_transcript" as const,
    text: input.text,
    translation: "",
    isFinal: true as const,
    isComplete: true as const,
    ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
    utteranceId: input.utteranceId,
    turnId: String(input.utteranceId),
    callSid: input.callSid,
  };
}

export function buildOwnerSubtitleEvent(input: {
  turnId: number | string;
  translation: string;
  language: SubtitleLanguage;
  callSid: string | null;
}) {
  return {
    type: "owner_translation" as const,
    turnId: String(input.turnId),
    translation: input.translation,
    language: input.language,
    callSid: input.callSid,
  };
}

export function buildGuestSubtitleEvent(input: {
  turnId: number | string;
  translation: string;
  language: SubtitleLanguage;
  callSid: string | null;
}) {
  return {
    type: "guest_subtitle" as const,
    turnId: String(input.turnId),
    translation: input.translation,
    language: input.language,
    callSid: input.callSid,
  };
}

export function buildSubtitleUnavailableEvent(input: {
  turnId: number | string;
  role: "guest" | "owner";
  language: SubtitleLanguage;
  reason: SubtitleUnavailableReason;
  callSid: string | null;
}) {
  return {
    type: "subtitle_unavailable" as const,
    turnId: String(input.turnId),
    role: input.role,
    language: input.language,
    reason: input.reason,
    callSid: input.callSid,
  };
}