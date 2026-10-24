/** Only the Dev ElevenLabs adapter consumes these settings. Never a global
 * Secretary model switch. Historical runs retain their own complete snapshot. */
export const elevenProfiles = {
  baseline: { label: "Исходный", ttsModel: "eleven_multilingual_v2", initialLanguage: "en", turnEagerness: "normal", reasoning: "medium", brief: false, checkpoint: "every_round" },
  flash: { label: "Flash 2.5 · основной язык RU", ttsModel: "eleven_flash_v2_5", initialLanguage: "ru", turnEagerness: "normal", reasoning: "medium", brief: false, checkpoint: "every_round" },
  eager: { label: "Только Eager", ttsModel: "eleven_multilingual_v2", initialLanguage: "en", turnEagerness: "eager", reasoning: "medium", brief: false, checkpoint: "every_round" },
  low: { label: "Только Low", ttsModel: "eleven_multilingual_v2", initialLanguage: "en", turnEagerness: "normal", reasoning: "low", brief: false, checkpoint: "every_round" },
  brief: { label: "Только короткие ответы", ttsModel: "eleven_multilingual_v2", initialLanguage: "en", turnEagerness: "normal", reasoning: "medium", brief: true, checkpoint: "every_round" },
  optimized: { label: "Оптимизированный · проверка на iPhone", ttsModel: "eleven_flash_v2_5", initialLanguage: "ru", turnEagerness: "normal", reasoning: "medium", brief: false, checkpoint: "actions_changed" },
} as const;
export type ElevenProfileId = keyof typeof elevenProfiles;
export type ElevenProfile = (typeof elevenProfiles)[ElevenProfileId];
export interface ElevenTiming {
  id: string;
  requestReceivedMs: number;
  speechEndMs: number | null;
  endOfTurnMs: number | null;
  transcriptReceivedMs: number | null;
  firstTextMs: number | null;
  firstAudioMs: number | null;
  providerAudioEventId: number | null;
  playbackClientMs: number | null;
  playbackTelemetryReceivedMs: number | null;
  checkpointsMs: number[];
  checkpointSkipped: number;
  cancelled: boolean;
  correlation: string;
}
