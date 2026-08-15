// Shared types for the LIVE Ears & Brain Benchmark (admin-only bench layer).
// This module has ZERO imports from the production call path — the benchmark
// must never change production behavior.

export type SpeakerRole = "owner" | "guest";

export interface ReferenceTurn {
  idx: number;
  role: SpeakerRole;
  text: string;
  tStartMs?: number;
  tEndMs?: number;
}

export interface CriticalEntities {
  money: string[];
  dates: string[];
  digits: string[];
  names: string[];
  decisions: string[];
  /** domain terms weighted separately (eSIM, SMS code, port-in, ...) */
  terms?: string[];
}

// ---------------------------------------------------------------------------
// Candidate matrix (Mandatory Candidate Matrix v1 — no silent substitution)
// ---------------------------------------------------------------------------

export type CandidateStatus = "AVAILABLE" | "UNAVAILABLE" | "NOT_CHECKED";

export interface AvailabilityResult {
  candidateId: string;
  status: CandidateStatus;
  checkedAt: string; // ISO
  detail: string; // human-readable proof / error
  latencyMs?: number;
}

export interface EarsCandidate {
  id: string; // stable id used in scorecards
  label: string;
  provider: "deepgram" | "openai" | "azure";
  kind: "realtime" | "batch";
  /** true = reference-only accuracy ceiling, never a LIVE winner */
  referenceOnly?: boolean;
  /** true = optional external control, absence is not a failure */
  optional?: boolean;
  config: Record<string, string | number | boolean>;
}

export interface BrainCandidate {
  id: string;
  label: string;
  model: string;
  /** reasoning effort recorded per run; "n/a" for non-reasoning models */
  reasoningEffort: "none" | "low" | "n/a";
  baseline?: boolean;
}

// ---------------------------------------------------------------------------
// BRAIN benchmark envelope (normalized — NOT the production wire format)
// ---------------------------------------------------------------------------

export type Strategy =
  | "answer" | "clarify" | "challenge" | "confirm"
  | "alternative" | "escalate" | "wait";

export interface BrainEnvelopeInput {
  originalGoal: string;
  confirmedFacts: string[];
  conversationSoFar: ReferenceTurn[]; // complete history up to current turn
  currentGuestTurn: ReferenceTurn;
  lastOwnerTurn: ReferenceTurn | null;
  previousHintsShown: string[];
  previousHintsRejected: string[];
  currentCallState: string; // short state summary, e.g. "bank refused to apply $350"
}

export interface BrainEnvelopeOutput {
  should_suggest: boolean;
  suggested_reply?: string;
  translation?: string;
  current_topic?: string;
  goal_status?: string;
  strategy?: Strategy;
}

export interface BrainTurnResult {
  turnIdx: number;
  candidateId: string;
  output: BrainEnvelopeOutput | null;
  rawText?: string;
  schemaValid: boolean;
  error?: string; // timeout / API error / malformed
  // Engineering metrics
  firstTokenMs: number | null;
  fullOutputMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  // Hint usefulness deadline: benchmark equivalents measured from the moment
  // the Guest turn "ended" (envelope submitted) to suggestion ready. The
  // client_rendered figure adds the measured WS→render overhead constant when
  // real delivery data is unavailable (marked estimated in scorecards).
  suggestionReadyAfterGuestEndMs: number | null;
  deterministic?: DeterministicChecks;
  judge?: JudgeScores | null;
}

export interface DeterministicChecks {
  schemaValid: boolean;
  strategyValid: boolean;
  nonRepetition: boolean; // did not repeat a previously rejected strategy verbatim
  sideTopicHandled: boolean | null; // null = not applicable this turn
  mentionsCriticalEntityWhenExpected: boolean | null;
  restraintRespected: boolean | null;
  notes: string[];
}

export interface JudgeScores {
  judgeModel: string;
  selfJudged: boolean;
  scores: {
    goal_awareness: number;
    current_turn_relevance: number;
    conversation_intelligence: number;
    usefulness: number;
    language_naturalness: number;
    non_repetition: number;
    strategy_progression: number;
    restraint: number;
    multi_turn_coherence: number;
    overall_live_copilot_quality: number;
  };
  rationale: string;
}

// ---------------------------------------------------------------------------
// EARS results
// ---------------------------------------------------------------------------

export interface EarsTurnResult {
  turnIdx: number;
  candidateId: string;
  hypothesisText: string;
  role: SpeakerRole | null;
  wer: number | null;
  cer: number | null;
  entityAccuracy: {
    money: number | null;
    dates: number | null;
    digits: number | null;
    names: number | null;
    /** domain-term accuracy (terms present in this reference turn) */
    terms?: number | null;
  } | null;
  prematureEot: boolean | null;
  falseContinuation: boolean | null;
  speechEndToFinalMs: number | null;
  speechEndToEotMs: number | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Continuity metrics (hint chain: EARS → trigger → BRAIN → delivery → render)
// ---------------------------------------------------------------------------

export type ChainStage = "ears" | "trigger" | "brain" | "delivery" | "render";

export interface ContinuityMetrics {
  eligibleGuestTurns: number;
  hintsRequested: number;
  hintsGenerated: number;
  hintsWsSent: number;
  hintsClientRendered: number;
  hintsMissed: number;
  maxConsecutiveMissedHints: number;
  misses: Array<{ turnIdx: number; stage: ChainStage; reason: string }>;
}

// ---------------------------------------------------------------------------
// Replay timeline (per turn timestamp trail)
// ---------------------------------------------------------------------------

export interface ReplayTurn {
  turnIdx: number;
  role: SpeakerRole;
  said: string;
  aiState: string | null;
  strategy: Strategy | null;
  suggestedReply: string | null;
  timestamps: Partial<Record<
    | "audioEnd" | "sttFinal" | "hintTrigger" | "llmFirstToken"
    | "suggestionReady" | "wsSent" | "clientRendered",
    number // ms offset from turn audio end
  >>;
  latencyMs: number | null;
  judgeScore: number | null;
}
