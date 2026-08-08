import { textSimilarity, normalizeText } from "./dialogueMatch";
import { isQuestionOrActionRequest } from "./waitState";

// Duplicate-suggestion / self-overlap guard for the live-hint pipeline.
//
// Extracted from the websocket handler closure (server/websocket.ts,
// runGuestUtterance) so the decision logic is a pure, testable unit — same
// pattern as HintCarryover.
//
// Prod incident this encodes: the bot re-asked an almost identical clarifying
// question ("Mint phone number or home Internet?") twice; both generated
// answers were >=80% similar, so the duplicate filter suppressed the second
// one and the user saw exactly ONE hint for the whole call. Fix: when the
// guest's CURRENT utterance is itself a question, they are waiting for an
// answer right now — a similar hint must be re-shown. BOUNDED: at most one
// exempted re-show per normalized guest question, so a looping IVR repeating
// the same prompt can't re-show forever.
//
// One instance per media-stream connection (per-call state: the exemption
// counter). Tests: server/__tests__/hintDedup.test.ts.

export type DedupDecision =
  | { action: "show" }
  | { action: "show_exempt"; similarity: number }
  | { action: "drop"; reason: "duplicate_suggestion" | "self_overlap"; similarity: number };

export interface DedupInput {
  /** The candidate suggestion text (English) about to be shown. */
  suggestionText: string;
  /** The guest utterance that triggered this suggestion. */
  guestText: string;
  /** Recent suggestions already shown (duplicate window). */
  recentSuggestions: readonly string[];
  /** Recent owner (HON) utterances (self-overlap window). */
  recentOwnerUtterances: readonly string[];
}

export const DUPLICATE_SIMILARITY = 0.8; // Block if >=80% similar to any recent suggestion
export const SELF_OVERLAP_SIMILARITY = 0.7; // Block if >=70% similar to a recent HON turn
export const MAX_DUP_EXEMPTIONS_PER_QUESTION = 1;

export class SuggestionDedupGuard {
  // Per-call cap on duplicate-suggestion exemptions, keyed by normalized
  // guest question — a re-asked question may re-show a similar hint ONCE;
  // further repeats (looping IVR) are suppressed as duplicates again.
  private dupExemptionCounts = new Map<string, number>();

  constructor(
    private readonly deps: {
      similarity?: (a: string, b: string) => number;
      normalize?: (text: string) => string;
      isQuestion?: (text: string) => boolean;
      duplicateSimilarity?: number;
      selfOverlapSimilarity?: number;
      maxExemptionsPerQuestion?: number;
    } = {}
  ) {}

  private get similarity() { return this.deps.similarity ?? textSimilarity; }
  private get normalize() { return this.deps.normalize ?? normalizeText; }
  private get isQuestion() { return this.deps.isQuestion ?? isQuestionOrActionRequest; }
  private get dupThreshold() { return this.deps.duplicateSimilarity ?? DUPLICATE_SIMILARITY; }
  private get selfThreshold() { return this.deps.selfOverlapSimilarity ?? SELF_OVERLAP_SIMILARITY; }
  private get maxExemptions() { return this.deps.maxExemptionsPerQuestion ?? MAX_DUP_EXEMPTIONS_PER_QUESTION; }

  /**
   * Decide whether the candidate suggestion may be shown.
   *
   * Order mirrors the original closure logic exactly:
   * 1. Duplicate window: if the suggestion is too similar to a recent one,
   *    it is dropped — UNLESS the guest just (re-)asked a question and that
   *    normalized question hasn't used up its single exemption yet.
   * 2. Self-overlap: if HON already said essentially the same thing recently,
   *    the suggestion is dropped regardless of any exemption.
   */
  evaluate(input: DedupInput): DedupDecision {
    let maxSim = 0;
    for (const prev of input.recentSuggestions) {
      const sim = this.similarity(input.suggestionText, prev);
      if (sim > maxSim) maxSim = sim;
    }
    let exempted = false;
    if (maxSim >= this.dupThreshold) {
      const dupSig = this.normalize(input.guestText);
      if (this.isQuestion(input.guestText) && (this.dupExemptionCounts.get(dupSig) ?? 0) < this.maxExemptions) {
        this.dupExemptionCounts.set(dupSig, (this.dupExemptionCounts.get(dupSig) ?? 0) + 1);
        exempted = true;
      } else {
        return { action: "drop", reason: "duplicate_suggestion", similarity: maxSim };
      }
    }

    let maxOwnerSim = 0;
    for (const prev of input.recentOwnerUtterances) {
      const sim = this.similarity(input.suggestionText, prev);
      if (sim > maxOwnerSim) maxOwnerSim = sim;
    }
    if (maxOwnerSim >= this.selfThreshold) {
      return { action: "drop", reason: "self_overlap", similarity: maxOwnerSim };
    }

    return exempted ? { action: "show_exempt", similarity: maxSim } : { action: "show" };
  }

  /** Reset per-call state (call teardown). */
  reset(): void {
    this.dupExemptionCounts.clear();
  }
}
