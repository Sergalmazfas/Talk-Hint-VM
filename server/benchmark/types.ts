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
  /** Human-verified: an admin listened to this turn's audio and confirmed/fixed the text. */
  verified?: boolean;
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

// Copilot-chain judge scores: each link of the live-copilot chain is scored
// separately (1-10) with its own short explanation. overall_* is kept for
// winner ranking and run-history compatibility.
export interface JudgeScores {
  judgeModel: string;
  selfJudged: boolean;
  scores: {
    understood_current_turn: number;
    goal_memory: number;
    tried_memory: number;
    avoids_rejected_strategy: number;
    next_move_quality: number;
    reply_naturalness_en: number;
    overall_live_copilot_quality: number;
  };
  explanations: {
    understood_current_turn: string;
    goal_memory: string;
    tried_memory: string;
    avoids_rejected_strategy: string;
    next_move_quality: string;
    reply_naturalness_en: string;
    overall_live_copilot_quality: string;
  };
  rationale: string;
  // Multi-sample aggregation (Task: stable judge). When present, `scores` are
  // per-dimension MEDIANS over `samples` independent judge calls and
  // `scoreStds` is the per-dimension sample standard deviation (spread).
  samples?: number;
  scoreStds?: Record<string, number>;
  // Cross-check by a SECOND judge model when the primary judge judged its own
  // candidate (selfJudged). null = second judge was available but failed
  // (fail-closed: never substituted). undefined = not applicable / no second
  // judge available (honest self-judged mark stays).
  crossJudge?: {
    judgeModel: string;
    samples: number;
    scores: JudgeScores["scores"];
    scoreStds: Record<string, number>;
  } | null;
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
