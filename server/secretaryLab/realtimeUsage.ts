import type { LabRealtimeUsage } from "../../shared/secretaryLabCost";

/** Sideband telemetry only; never changes model/session/audio configuration.
 * Missing or future modalities remain unpriced rather than being treated as 0. */
export class RealtimeUsageMeter {
  readonly totals: LabRealtimeUsage = { requests: 0, measuredRequests: 0, textInput: 0, textCached: 0,
    textOutput: 0, audioInput: 0, audioCached: 0, audioOutput: 0 };
  private responses = new Map<string, boolean>();
  record(id: string, usage?: any) {
    if (!id || id.length > 200 || (!this.responses.has(id) && this.responses.size >= 1000)) return;
    if (!this.responses.has(id)) { this.responses.set(id, false); this.totals.requests++; }
    if (this.responses.get(id) || !usage) return;
    const i = usage.input_token_details, o = usage.output_token_details, c = i?.cached_tokens_details;
    const values = [i?.text_tokens, i?.audio_tokens, o?.text_tokens, o?.audio_tokens,
      c?.text_tokens, c?.audio_tokens, usage.input_tokens, usage.output_tokens, i?.cached_tokens];
    if (!values.every(n => Number.isSafeInteger(n) && n >= 0) ||
        i.text_tokens + i.audio_tokens !== usage.input_tokens ||
        o.text_tokens + o.audio_tokens !== usage.output_tokens ||
        c.text_tokens + c.audio_tokens !== i.cached_tokens ||
        c.text_tokens > i.text_tokens || c.audio_tokens > i.audio_tokens) return;
    this.responses.set(id, true); this.totals.measuredRequests++;
    this.totals.textInput += i.text_tokens; this.totals.audioInput += i.audio_tokens;
    this.totals.textCached += c.text_tokens; this.totals.audioCached += c.audio_tokens;
    this.totals.textOutput += o.text_tokens; this.totals.audioOutput += o.audio_tokens;
  }
}
