import { isQuestionOrActionRequest } from "./waitState";

// When the robot/guest speaks several phrases in quick bursts, a suggestion
// generated for an earlier phrase can be superseded (dropped as stale), blocked
// by the hint cooldown, or the model may return no suggestion at all. If that
// superseded phrase contained a QUESTION, the question used to vanish without a
// trace — no hint ever addressed it (prod call: guest phrases #13/#23/#25).
//
// HintCarryover remembers the most recent dropped question so the NEXT guest
// turn's hint generation folds it into a single combined turn.
//
// RACE the design must survive (burst of 3 phrases, question in the first):
// phrase 1's suggestion request is still in flight when phrases 2 and 3 arrive.
// If the dropped question were only remembered when phrase 1's request finally
// resolves (at the stale guard), phrases 2/3 would have already consumed an
// EMPTY carryover and delivered hints without the question. Therefore the
// capture is EAGER: `beginTurn` runs synchronously at handler entry and, if the
// previous guest turn is still generating (not finished), remembers its
// question immediately — before the new turn builds its model input.
//
// One instance per media-stream connection (pure per-call state). Unit +
// concurrency tests: server/__tests__/hintCarryover.test.ts.

export interface PendingQuestion {
  text: string;
  utteranceId: number;
  reason: string; // why the original hint was dropped (superseded/cooldown/no_suggestion/...)
  ts: number;
}

/** Per-guest-turn tracking handle. `text` is updated when carryover is merged in. */
export interface GuestTurn {
  utteranceId: number;
  text: string;
  /** True once the turn's handler finished (hint delivered OR deliberately blocked). */
  done: boolean;
}

// A remembered question older than this is unlikely to still be relevant —
// the conversation has moved on. Bursty robot phrases arrive within 3-5s, so
// 30s comfortably covers the real failure mode without resurrecting ancient turns.
export const CARRYOVER_MAX_AGE_MS = 30_000;

export class HintCarryover {
  private pending: PendingQuestion | null = null;
  private inflight: GuestTurn | null = null;
  private readonly isQuestion: (text: string) => boolean;
  private readonly now: () => number;

  constructor(
    isQuestion: (text: string) => boolean = isQuestionOrActionRequest,
    now: () => number = Date.now
  ) {
    this.isQuestion = isQuestion;
    this.now = now;
  }

  /**
   * Called SYNCHRONOUSLY at guest-handler entry, before any await. If the
   * previous guest turn is still generating its hint, it is being superseded
   * right now — its suggestion will be dropped as stale later. Capture its
   * question immediately so THIS turn can fold it in. If that previous turn
   * never got to consume an even earlier pending question, merge the two so
   * neither is lost.
   *
   * Returns the new turn handle plus the utteranceId whose question was
   * captured (for logging), if any.
   */
  beginTurn(text: string, utteranceId: number): { turn: GuestTurn; capturedFromUtteranceId?: number } {
    let capturedFromUtteranceId: number | undefined;
    const prev = this.inflight;
    if (prev && !prev.done) {
      // prev.text already includes any carryover prev merged in (it updates its
      // handle in buildHintText). If prev never consumed the pending question,
      // merge it so the older question still survives.
      const supersededText = this.pending
        ? combineWithCarryover(this.pending.text, prev.text)
        : prev.text;
      if (this.remember(supersededText, prev.utteranceId, "superseded")) {
        capturedFromUtteranceId = prev.utteranceId;
      }
      prev.done = true; // superseded — its own late stale-drop must not re-remember
    }
    const turn: GuestTurn = { utteranceId, text, done: false };
    this.inflight = turn;
    return { turn, capturedFromUtteranceId };
  }

  /**
   * Build the model input for a turn, folding in a pending dropped question.
   * `isLatest` must be false when the turn is already known to be superseded —
   * then the pending question is NOT consumed (it stays for the newest turn,
   * which is the one that will actually deliver a hint).
   */
  buildHintText(turn: GuestTurn, isLatest: boolean): { hintText: string; carried: PendingQuestion | null } {
    if (!isLatest) return { hintText: turn.text, carried: null };
    const carried = this.consume();
    const hintText = carried ? combineWithCarryover(carried.text, turn.text) : turn.text;
    turn.text = hintText; // if THIS turn is later superseded, the merged text is what gets carried
    return { hintText, carried };
  }

  /** Mark a turn finished (hint delivered or deliberately blocked). */
  finishTurn(turn: GuestTurn): void {
    turn.done = true;
    if (this.inflight === turn) this.inflight = null;
  }

  /**
   * Record a guest turn whose hint was dropped. Only turns that contain a
   * question / action request are remembered — statements can be safely lost.
   * The newest dropped question wins (a later question supersedes an earlier one).
   * Returns true when the turn was remembered.
   */
  remember(text: string, utteranceId: number, reason: string): boolean {
    const trimmed = (text || "").trim();
    if (!trimmed || !this.isQuestion(trimmed)) return false;
    this.pending = { text: trimmed, utteranceId, reason, ts: this.now() };
    return true;
  }

  /**
   * Take (and clear) the pending question, if any and not expired.
   */
  consume(): PendingQuestion | null {
    const p = this.pending;
    this.pending = null;
    if (!p) return null;
    if (this.now() - p.ts > CARRYOVER_MAX_AGE_MS) return null;
    return p;
  }

  /** Peek without clearing (for logging/tests). */
  peek(): PendingQuestion | null {
    return this.pending;
  }

  clear(): void {
    this.pending = null;
    this.inflight = null;
  }
}

/**
 * Merge a carried-over question with the current guest turn into a single
 * "guest said" text for the hint model, so the suggestion addresses BOTH.
 */
export function combineWithCarryover(pendingText: string, currentText: string): string {
  const pending = pendingText.trim();
  const current = currentText.trim();
  if (!pending) return current;
  if (!current) return pending;
  return `${pending} ${current}`;
}
