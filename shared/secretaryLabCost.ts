/** USD estimates only. A usage measurement is NOT a billing receipt. */
export interface LabTariffSnapshot {
  version: 1;
  checkedAt: string;
  capturedAt: string;
  sources: Array<{ label: string; url: string }>;
  rates: {
    elevenAdditionalMinute: number;
    elevenBurstMinute: number;
    retellInfraMinute: number;
    retellPlatformVoiceMinute: number;
    retellSolMinute: number;
    liveMinute: number;
    solInputMillion: number;
    solCachedMillion: number;
    solOutputMillion: number;
    realtimeTextInputMillion: number;
    realtimeTextCachedMillion: number;
    realtimeTextOutputMillion: number;
    realtimeAudioInputMillion: number;
    realtimeAudioCachedMillion: number;
    realtimeAudioOutputMillion: number;
  };
}
export interface LabTokenUsage {
  requests: number;
  measuredRequests: number;
  input: number;
  cachedInput: number;
  output: number;
}
export interface LabRealtimeUsage {
  requests: number;
  measuredRequests: number;
  textInput: number;
  textCached: number;
  textOutput: number;
  audioInput: number;
  audioCached: number;
  audioOutput: number;
}
export interface LabCostLine {
  label: string;
  status: "estimated" | "included" | "unknown" | "not_applicable";
  quantity: number | null;
  unit: "minute" | "million_tokens" | "item";
  rateUsd: number | null;
  amountUsd: number | null;
  note: string;
}
export interface LabRunCost {
  currency: "USD";
  status: "estimate";
  complete: boolean;
  estimatedTotalUsd: number | null;
  knownSubtotalUsd: number;
  confirmedChargeUsd: number | null;
  durationSeconds: number | null;
  durationBasis: string;
  model: string;
  voice: string;
  ttsModel: string | null;
  profileId: string | null;
  tokenUsage: LabTokenUsage | null;
  realtimeUsage: LabRealtimeUsage | null;
  tariff: LabTariffSnapshot;
  lines: LabCostLine[];
  notes: string[];
}
