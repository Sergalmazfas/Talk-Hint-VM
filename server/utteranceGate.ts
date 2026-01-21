type Speaker = "GST" | "HON";

interface UtteranceState {
  lastPartialText: string;
  lastFinalText: string;
  utteranceId: number;
  speechActive: boolean;
  debounceTimer?: NodeJS.Timeout;
  lastGeneratedUtteranceId: number;
  pendingText: string;
  lastTranscriptAt: number;
}

interface ShouldGenerateParams {
  speaker: Speaker;
  text: string;
  isFinal: boolean;
}

interface ShouldGenerateResult {
  shouldGenerate: boolean;
  reason: "final_accumulated" | "debounce_timeout" | "duplicate" | "too_short" | "pending";
  text: string;
  utteranceId: number;
}

const DEBOUNCE_MS = 750;
const MIN_CHARS = 8;

export class UtteranceGate {
  private states: Map<string, UtteranceState> = new Map();
  private onGenerate: (speaker: Speaker, text: string, utteranceId: number) => void;
  
  constructor(onGenerate: (speaker: Speaker, text: string, utteranceId: number) => void) {
    this.onGenerate = onGenerate;
  }
  
  private getState(callId: string, speaker: Speaker): UtteranceState {
    const key = `${callId}:${speaker}`;
    if (!this.states.has(key)) {
      this.states.set(key, {
        lastPartialText: "",
        lastFinalText: "",
        utteranceId: 0,
        speechActive: false,
        lastGeneratedUtteranceId: -1,
        pendingText: "",
        lastTranscriptAt: 0
      });
    }
    return this.states.get(key)!;
  }
  
  processTranscript(
    callId: string,
    speaker: Speaker,
    text: string,
    isFinal: boolean
  ): ShouldGenerateResult {
    const state = this.getState(callId, speaker);
    const now = Date.now();
    
    state.lastTranscriptAt = now;
    
    // Clear existing debounce timer on ANY transcript (partial or final)
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = undefined;
    }
    
    if (isFinal) {
      // Accumulate final text
      if (state.pendingText && !state.pendingText.endsWith(text)) {
        state.pendingText = state.pendingText + " " + text;
      } else {
        state.pendingText = text;
      }
      
      state.lastFinalText = text;
      state.speechActive = true;
      
      // Start debounce timer - will flush after 750ms of silence
      state.debounceTimer = setTimeout(() => {
        this.flushUtterance(callId, speaker, "debounce_after_final");
      }, DEBOUNCE_MS);
      
      console.log(`[utteranceGate] speaker=${speaker} event=final len=${text.length} generate=false reason=waiting_debounce`);
      
      return {
        shouldGenerate: false,
        reason: "pending",
        text: state.pendingText,
        utteranceId: state.utteranceId
      };
    } else {
      // Partial transcript - update pending text and start/reset debounce
      state.lastPartialText = text;
      state.pendingText = text; // Use partial as pending if no final yet
      state.speechActive = true;
      
      // Start debounce timer even on partials (fallback if final never comes)
      state.debounceTimer = setTimeout(() => {
        this.flushUtterance(callId, speaker, "debounce_after_partial");
      }, DEBOUNCE_MS);
      
      console.log(`[utteranceGate] speaker=${speaker} event=partial len=${text.length} generate=false reason=waiting`);
      
      return {
        shouldGenerate: false,
        reason: "pending",
        text: text,
        utteranceId: state.utteranceId
      };
    }
  }
  
  private flushUtterance(callId: string, speaker: Speaker, trigger: string): void {
    const state = this.getState(callId, speaker);
    
    if (!state.pendingText || state.pendingText.trim().length === 0) {
      console.log(`[utteranceGate] speaker=${speaker} event=${trigger} len=0 generate=false reason=empty`);
      return;
    }
    
    if (state.pendingText.length < MIN_CHARS) {
      console.log(`[utteranceGate] speaker=${speaker} event=${trigger} len=${state.pendingText.length} generate=false reason=too_short`);
      state.pendingText = "";
      state.speechActive = false;
      return;
    }
    
    state.utteranceId++;
    
    if (state.utteranceId === state.lastGeneratedUtteranceId) {
      console.log(`[utteranceGate] speaker=${speaker} event=${trigger} utteranceId=${state.utteranceId} generate=false reason=duplicate`);
      return;
    }
    
    const finalText = state.pendingText.trim();
    state.lastGeneratedUtteranceId = state.utteranceId;
    
    console.log(`[utteranceGate] speaker=${speaker} event=${trigger} utteranceId=${state.utteranceId} len=${finalText.length} generate=true`);
    
    state.pendingText = "";
    state.speechActive = false;
    state.lastPartialText = "";
    
    this.onGenerate(speaker, finalText, state.utteranceId);
  }
  
  forceFlush(callId: string, speaker: Speaker): void {
    const state = this.getState(callId, speaker);
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = undefined;
    }
    this.flushUtterance(callId, speaker, "force_flush");
  }
  
  cleanup(callId: string): void {
    const keysToDelete: string[] = [];
    Array.from(this.states.keys()).forEach(key => {
      if (key.startsWith(`${callId}:`)) {
        const state = this.states.get(key);
        if (state?.debounceTimer) {
          clearTimeout(state.debounceTimer);
        }
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this.states.delete(key));
  }
}
