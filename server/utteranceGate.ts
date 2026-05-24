type Speaker = "GST" | "HON";

interface UtteranceState {
  bufferText: string;
  pendingPartial: string;
  lastPartialTs: number;
  lastFinalTs: number;
  debounceTimer?: NodeJS.Timeout;
  utteranceId: number;
  lastGeneratedUtteranceId: number;
  speechActive: boolean;
  hasFinalInCurrentUtterance: boolean;
}

interface IngestParams {
  speaker: Speaker;
  text: string;
  isFinal: boolean;
  speechFinal?: boolean;
  utteranceEnd?: boolean;
  ts?: number;
}

interface IngestResult {
  shouldGenerate: boolean;
  reason: string;
  text: string;
  utteranceId: number;
}

// Time to wait for additional audio after a FINAL transcript before flushing.
// Deepgram VAD's UtteranceEnd fires ~250ms after speech stops and force-flushes
// immediately (see websocket.ts forceFlush handler), so this is just a safety net.
const END_SILENCE_AFTER_FINAL_MS = 500;
// Time to wait after a PARTIAL transcript when no final has arrived yet.
// Keep larger — protects mid-sentence pauses from being treated as end-of-speech.
const END_SILENCE_AFTER_PARTIAL_MS = 1000;
const MIN_CHARS = 10;
const MAX_BUFFER_CHARS = 400;

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
        bufferText: "",
        pendingPartial: "",
        lastPartialTs: 0,
        lastFinalTs: 0,
        utteranceId: 0,
        lastGeneratedUtteranceId: -1,
        speechActive: false,
        hasFinalInCurrentUtterance: false
      });
    }
    return this.states.get(key)!;
  }
  
  ingestTranscript(
    callId: string,
    params: IngestParams
  ): IngestResult {
    const { speaker, text, isFinal, speechFinal, utteranceEnd, ts } = params;
    const state = this.getState(callId, speaker);
    const now = ts || Date.now();
    
    if (!text || text.trim().length === 0) {
      return {
        shouldGenerate: false,
        reason: "empty_text",
        text: state.bufferText,
        utteranceId: state.utteranceId
      };
    }
    
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = undefined;
    }
    
    state.speechActive = true;
    
    if (isFinal) {
      state.lastFinalTs = now;
      state.hasFinalInCurrentUtterance = true;
      
      const trimmedText = text.trim();
      if (state.bufferText.length > 0) {
        state.bufferText = state.bufferText + " " + trimmedText;
      } else {
        state.bufferText = trimmedText;
      }
      
      if (state.bufferText.length > MAX_BUFFER_CHARS) {
        state.bufferText = state.bufferText.slice(-MAX_BUFFER_CHARS);
      }
      
      state.pendingPartial = "";
      
      console.log(`[utteranceGate] speaker=${speaker} event=final_chunk is_final=true bufLen=${state.bufferText.length}`);
      
      if (speechFinal || utteranceEnd) {
        console.log(`[utteranceGate] speaker=${speaker} event=utterance_end speechFinal=${speechFinal} -> flush immediately`);
        return this.flush(callId, speaker, "utterance_end");
      }
      
      state.debounceTimer = setTimeout(() => {
        const result = this.flush(callId, speaker, "silence_timeout");
        if (result.shouldGenerate) {
          console.log(`[utteranceGate] speaker=${speaker} silence_timeout -> generate=true`);
        }
      }, END_SILENCE_AFTER_FINAL_MS);
      
      return {
        shouldGenerate: false,
        reason: "waiting_silence",
        text: state.bufferText,
        utteranceId: state.utteranceId
      };
      
    } else {
      state.lastPartialTs = now;
      state.pendingPartial = text.trim();
      
      console.log(`[utteranceGate] speaker=${speaker} event=partial len=${text.length}`);
      
      state.debounceTimer = setTimeout(() => {
        if (state.hasFinalInCurrentUtterance && state.bufferText.length >= MIN_CHARS) {
          const result = this.flush(callId, speaker, "partial_silence_timeout");
          if (result.shouldGenerate) {
            console.log(`[utteranceGate] speaker=${speaker} partial_silence_timeout -> generate=true`);
          }
        } else {
          console.log(`[utteranceGate] speaker=${speaker} partial_silence_timeout -> skipped (no final in utterance)`);
        }
      }, END_SILENCE_AFTER_PARTIAL_MS);
      
      return {
        shouldGenerate: false,
        reason: "partial_waiting",
        text: state.bufferText,
        utteranceId: state.utteranceId
      };
    }
  }
  
  processTranscript(
    callId: string,
    speaker: Speaker,
    text: string,
    isFinal: boolean,
    speechFinal?: boolean,
    utteranceEnd?: boolean
  ): IngestResult {
    return this.ingestTranscript(callId, {
      speaker,
      text,
      isFinal,
      speechFinal,
      utteranceEnd
    });
  }
  
  private flush(callId: string, speaker: Speaker, trigger: string): IngestResult {
    const state = this.getState(callId, speaker);
    
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = undefined;
    }
    
    if (!state.hasFinalInCurrentUtterance) {
      console.log(`[utteranceGate] speaker=${speaker} event=${trigger} generate=false reason=no_final_in_utterance`);
      return {
        shouldGenerate: false,
        reason: "no_final_in_utterance",
        text: "",
        utteranceId: state.utteranceId
      };
    }
    
    const finalText = state.bufferText.trim();
    
    if (!finalText || finalText.length === 0) {
      console.log(`[utteranceGate] speaker=${speaker} event=${trigger} generate=false reason=empty`);
      this.resetState(state);
      return {
        shouldGenerate: false,
        reason: "empty",
        text: "",
        utteranceId: state.utteranceId
      };
    }
    
    if (finalText.length < MIN_CHARS) {
      console.log(`[utteranceGate] speaker=${speaker} event=${trigger} len=${finalText.length} generate=false reason=min_chars`);
      this.resetState(state);
      return {
        shouldGenerate: false,
        reason: "min_chars",
        text: finalText,
        utteranceId: state.utteranceId
      };
    }
    
    state.utteranceId++;
    
    if (state.utteranceId === state.lastGeneratedUtteranceId) {
      console.log(`[utteranceGate] speaker=${speaker} event=${trigger} dedupe=true utteranceId=${state.utteranceId}`);
      return {
        shouldGenerate: false,
        reason: "duplicate",
        text: finalText,
        utteranceId: state.utteranceId
      };
    }
    
    state.lastGeneratedUtteranceId = state.utteranceId;
    
    console.log(`[utteranceGate] speaker=${speaker} event=${trigger} utteranceId=${state.utteranceId} len=${finalText.length} generate=true`);
    
    this.resetState(state);
    
    this.onGenerate(speaker, finalText, state.utteranceId);
    
    return {
      shouldGenerate: true,
      reason: trigger,
      text: finalText,
      utteranceId: state.utteranceId
    };
  }
  
  private resetState(state: UtteranceState): void {
    state.bufferText = "";
    state.pendingPartial = "";
    state.speechActive = false;
    state.hasFinalInCurrentUtterance = false;
  }
  
  forceFlush(callId: string, speaker: Speaker): IngestResult {
    const state = this.getState(callId, speaker);
    if (!state.hasFinalInCurrentUtterance || state.bufferText.length < MIN_CHARS) {
      console.log(`[utteranceGate] speaker=${speaker} event=force_flush generate=false reason=no_valid_buffer`);
      return {
        shouldGenerate: false,
        reason: "no_valid_buffer",
        text: "",
        utteranceId: state.utteranceId
      };
    }
    return this.flush(callId, speaker, "force_flush");
  }
  
  isSpeechActive(callId: string, speaker: Speaker): boolean {
    const state = this.getState(callId, speaker);
    return state.speechActive;
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
    console.log(`[utteranceGate] cleanup callId=${callId} cleared=${keysToDelete.length} states`);
  }
}
