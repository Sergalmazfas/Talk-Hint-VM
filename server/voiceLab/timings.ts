export type VoiceLabTimings = {
  micRelease: number;
  transcriptionComplete: number;
  englishReady: number;
  elevenlabsRequest?: number | null;
  firstAudio?: number | null;
};

export type PlaybackOffsets = {
  firstAudioMs: number | null;
  elevenlabsRequestMs?: number;
};

export function withAbsolutePlaybackTimings(
  timings: VoiceLabTimings,
  offsets: PlaybackOffsets,
): VoiceLabTimings {
  const releaseAt = timings.micRelease;
  if (!Number.isSafeInteger(releaseAt) || releaseAt <= 0) {
    throw new Error("Run is missing its microphone-release timestamp");
  }

  const previousRequestOffset = typeof timings.elevenlabsRequest === "number" && timings.elevenlabsRequest >= releaseAt
    ? timings.elevenlabsRequest - releaseAt
    : undefined;
  const requestOffset = offsets.elevenlabsRequestMs ?? previousRequestOffset;
  if (offsets.firstAudioMs !== null && requestOffset !== undefined && offsets.firstAudioMs < requestOffset) {
    throw new Error("firstAudioMs cannot be earlier than elevenlabsRequestMs");
  }

  return {
    ...timings,
    ...(offsets.elevenlabsRequestMs === undefined
      ? {}
      : { elevenlabsRequest: releaseAt + Math.round(offsets.elevenlabsRequestMs) }),
    firstAudio: offsets.firstAudioMs === null
      ? null
      : releaseAt + Math.round(offsets.firstAudioMs),
  };
}