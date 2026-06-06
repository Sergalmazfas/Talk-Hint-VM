type Speaker = "GST" | "HON";

// Deepgram Flux (v2) emits a single, turn-complete `EndOfTurn` transcript once
// the model decides the speaker has finished — by meaning/intonation, not by a
// fixed silence timer. That replaces the old timer-based buffering this class
// used to do for Nova-3. What remains is a thin finalizer: minimum-length
// filtering, consecutive-duplicate suppression, and a per-speaker turn counter.
interface TurnState {
  utteranceId: number;
  lastCommittedNorm: string;
}

interface CommitResult {
  shouldGenerate: boolean;
  reason: string;
  text: string;
  utteranceId: number;
}

// Turns shorter than this are ignored (filler like "ok", "mhm").
const MIN_CHARS = 10;

export class UtteranceGate {
  private states: Map<string, TurnState> = new Map();
  private onGenerate: (speaker: Speaker, text: string, utteranceId: number, confidence?: number) => void;

  constructor(onGenerate: (speaker: Speaker, text: string, utteranceId: number, confidence?: number) => void) {
    this.onGenerate = onGenerate;
  }

  private getState(callId: string, speaker: Speaker): TurnState {
    const key = `${callId}:${speaker}`;
    if (!this.states.has(key)) {
      this.states.set(key, {
        utteranceId: 0,
        lastCommittedNorm: ""
      });
    }
    return this.states.get(key)!;
  }

  /**
   * Commit a turn-complete transcript from Flux's `EndOfTurn`. Fires the
   * onGenerate callback (downstream GPT/translation pipeline) unless the turn is
   * empty, too short, or an exact repeat of the previous committed turn.
   */
  commitTurn(callId: string, speaker: Speaker, text: string, confidence?: number): CommitResult {
    const state = this.getState(callId, speaker);
    const trimmed = (text || "").trim();

    if (trimmed.length === 0) {
      console.log(`[utteranceGate] speaker=${speaker} event=end_of_turn generate=false reason=empty`);
      return { shouldGenerate: false, reason: "empty", text: "", utteranceId: state.utteranceId };
    }

    if (trimmed.length < MIN_CHARS) {
      console.log(`[utteranceGate] speaker=${speaker} event=end_of_turn len=${trimmed.length} generate=false reason=min_chars`);
      return { shouldGenerate: false, reason: "min_chars", text: trimmed, utteranceId: state.utteranceId };
    }

    const norm = trimmed.toLowerCase().replace(/\s+/g, " ");
    if (norm === state.lastCommittedNorm) {
      console.log(`[utteranceGate] speaker=${speaker} event=end_of_turn generate=false reason=duplicate`);
      return { shouldGenerate: false, reason: "duplicate", text: trimmed, utteranceId: state.utteranceId };
    }

    state.utteranceId++;
    state.lastCommittedNorm = norm;

    console.log(`[utteranceGate] speaker=${speaker} event=end_of_turn utteranceId=${state.utteranceId} len=${trimmed.length} generate=true`);

    this.onGenerate(speaker, trimmed, state.utteranceId, confidence);

    return { shouldGenerate: true, reason: "end_of_turn", text: trimmed, utteranceId: state.utteranceId };
  }

  cleanup(callId: string): void {
    const keysToDelete: string[] = [];
    Array.from(this.states.keys()).forEach(key => {
      if (key.startsWith(`${callId}:`)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this.states.delete(key));
    console.log(`[utteranceGate] cleanup callId=${callId} cleared=${keysToDelete.length} states`);
  }
}
