// Mandatory Candidate Matrix v1 — the exact list from the task spec.
// Rules: every candidate must pass a REAL API availability check before it is
// benchmarked. Unavailable candidates are reported as UNAVAILABLE — they are
// NEVER silently substituted with a different model.

import type { EarsCandidate, BrainCandidate } from "./types";

export const EARS_CANDIDATES: EarsCandidate[] = [
  {
    id: "dg-flux-general-en",
    label: "Current TalkHint: Deepgram Flux flux-general-en (baseline)",
    provider: "deepgram",
    kind: "realtime",
    config: {
      url: "wss://api.deepgram.com/v2/listen",
      model: "flux-general-en",
      encoding: "mulaw",
      sample_rate: 8000,
      eot_threshold: 0.7,
      eot_timeout_ms: 3000,
    },
  },
  {
    id: "dg-flux-general-multi",
    label: "Deepgram Flux flux-general-multi (multilingual, model-native EOT)",
    provider: "deepgram",
    kind: "realtime",
    config: {
      url: "wss://api.deepgram.com/v2/listen",
      model: "flux-general-multi",
      encoding: "mulaw",
      sample_rate: 8000,
      eot_threshold: 0.7,
      eot_timeout_ms: 3000,
    },
  },
  {
    id: "dg-nova-3-multi",
    label: "Deepgram nova-3 language=multi (conventional streaming baseline)",
    provider: "deepgram",
    kind: "realtime",
    config: {
      url: "wss://api.deepgram.com/v1/listen",
      model: "nova-3",
      language: "multi",
      encoding: "mulaw",
      sample_rate: 8000,
      interim_results: true,
      punctuate: true,
    },
  },
  {
    id: "oai-realtime-server-vad",
    label: "OpenAI gpt-4o-transcribe realtime + server VAD",
    provider: "openai",
    kind: "realtime",
    config: {
      model: "gpt-4o-transcribe",
      turn_detection: "server_vad",
    },
  },
  {
    id: "oai-realtime-semantic-vad",
    label: "OpenAI gpt-4o-transcribe realtime + semantic VAD",
    provider: "openai",
    kind: "realtime",
    config: {
      model: "gpt-4o-transcribe",
      turn_detection: "semantic_vad",
    },
  },
  {
    id: "oai-batch-gpt-4o-transcribe",
    label: "OpenAI batch gpt-4o-transcribe (accuracy ceiling / reference only)",
    provider: "openai",
    kind: "batch",
    referenceOnly: true,
    config: { model: "gpt-4o-transcribe" },
  },
  {
    id: "azure-speech-realtime",
    label: "Azure Speech realtime (optional external control)",
    provider: "azure",
    kind: "realtime",
    optional: true,
    config: { note: "secondary candidate; only if connectable without production changes" },
  },
];

// Current production model is read from the same env override the production
// path uses, but the benchmark NEVER writes it.
export const CURRENT_PRODUCTION_MODEL = process.env.HINT_MODEL || "gpt-5.6-terra";

export const BRAIN_CANDIDATES: BrainCandidate[] = [
  {
    id: "current-production",
    label: `Current TalkHint production model (${CURRENT_PRODUCTION_MODEL})`,
    model: CURRENT_PRODUCTION_MODEL,
    reasoningEffort: "n/a",
    baseline: true,
  },
  { id: "gpt-5.2", label: "GPT-5.2 (stronger control model)", model: "gpt-5.2", reasoningEffort: "none" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna (low-cost / high-volume)", model: "gpt-5.6-luna", reasoningEffort: "none" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra (intelligence/cost balance)", model: "gpt-5.6-terra", reasoningEffort: "none" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol (flagship quality reference)", model: "gpt-5.6-sol", reasoningEffort: "none" },
];

// Judge preference order: strongest available candidate model. Sol-judging-Sol
// results MUST be marked selfJudged=true in every scorecard.
export const JUDGE_PREFERENCE = ["gpt-5.6-sol", "gpt-5.2", "gpt-5.6-terra", CURRENT_PRODUCTION_MODEL];
