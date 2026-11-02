import { firstCompleteEnglishWord, instructions, plainEnglish, type Provider } from "./contracts";

export type Hint = {
  id: string; text: string; firstWordAt: number | null; fullAt: number;
  completed: boolean; interrupted: boolean;
};
export type NativeEvent =
  | { kind: "eot"; at: number; audioEndMs: number | null; itemId: string | null }
  | { kind: "hint"; hint: Hint }
  | { kind: "usage"; value: unknown }
  | { kind: "ready"; modelEcho: string | null }
  | { kind: "interruption"; at: number };

export function setup(provider: Provider, model: string, goal: string, maxOutputTokens: number) {
  if (!model || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 500)
    throw Error("INVALID_SESSION_BOUND");
  if (provider === "openai") return {
    type: "session.update", session: {
      type: "realtime", model, output_modalities: ["text"], instructions: instructions(goal),
      max_output_tokens: maxOutputTokens,
      audio: { input: {
        format: { type: "audio/pcmu" },
        turn_detection: {
          type: "server_vad", create_response: true, interrupt_response: true,
          threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600,
        },
      } },
    },
  };
  return { setup: {
    model: model.startsWith("models/") ? model : "models/" + model,
    generationConfig: { responseModalities: ["TEXT"], maxOutputTokens },
    realtimeInputConfig: { automaticActivityDetection: {
      disabled: false, prefixPaddingMs: 300, silenceDurationMs: 600,
    } },
    systemInstruction: { parts: [{ text: instructions(goal) }] },
  } };
}
export function ownerContext(provider: Provider, text: string) {
  if (provider === "openai") return {
    type: "conversation.item.create", item: { type: "message", role: "user",
      content: [{ type: "input_text", text: "Owner already said (context only): " + text }] },
  };
  return { clientContent: {
    turns: [{ role: "user", parts: [{ text: "Owner already said (context only): " + text }] }],
    turnComplete: false,
  } };
}
/** Never forward commands from model/fixture content to the transport. */
export function assertOutbound(provider: Provider, value: unknown) {
  const v = value as Record<string, any>;
  const allowed = provider === "openai"
    ? ["session.update", "input_audio_buffer.append", "conversation.item.create"]
    : ["setup", "realtimeInput", "clientContent"];
  if (provider === "openai" ? !allowed.includes(v.type) : Object.keys(v).some(k => !allowed.includes(k)))
    throw Error("MANUAL_TURN_CONTROL_FORBIDDEN");
  if (v.realtimeInput && Object.keys(v.realtimeInput).some(k => k !== "audio"))
    throw Error("MANUAL_ACTIVITY_CONTROL_FORBIDDEN");
  if (v.clientContent?.turnComplete !== undefined && v.clientContent.turnComplete !== false)
    throw Error("MANUAL_TURN_COMPLETE_FORBIDDEN");
}

/** Protocol state only. Transport and timing are injectable for offline tests. */
export class NativeProtocol {
  readonly hints: Hint[] = [];
  readonly events: NativeEvent[] = [];
  private responses = new Map<string, { text: string; first: number | null }>();
  private geminiTurn = 0;
  private geminiText = "";
  private geminiFirst: number | null = null;
  private geminiInterrupted = false;
  ready = false;
  constructor(readonly provider: Provider, readonly model: string) {}
  receive(m: any, at: number): NativeEvent[] {
    const start = this.events.length;
    if (m.error) throw Error("PROVIDER_ERROR_" + String(m.error.code ?? "UNKNOWN").replace(/[^a-z0-9_-]/gi, ""));
    if (this.provider === "openai") this.openai(m, at);
    else this.gemini(m, at);
    return this.events.slice(start);
  }
  private openai(m: any, at: number) {
    if (m.type === "session.updated") {
      const s = m.session, t = s?.audio?.input?.turn_detection;
      if (s?.model !== this.model) throw Error("MODEL_SUBSTITUTION");
      if (JSON.stringify(s.output_modalities) !== '["text"]' || t?.type !== "server_vad" ||
          t.create_response !== true || t.interrupt_response !== true ||
          s.audio.input.format?.type !== "audio/pcmu")
        throw Error("NATIVE_TEXT_AUTO_EOT_NOT_CONFIRMED");
      this.ready = true; this.events.push({ kind: "ready", modelEcho: s.model });
    }
    if (m.type === "input_audio_buffer.speech_stopped") this.events.push({
      kind: "eot", at, audioEndMs: Number.isFinite(m.audio_end_ms) ? m.audio_end_ms : null,
      itemId: typeof m.item_id === "string" ? m.item_id : null,
    });
    if (m.type === "response.created") {
      if (!m.response?.id || this.responses.has(m.response.id)) throw Error("RESPONSE_ID_INVALID");
      this.responses.set(m.response.id, { text: "", first: null });
    }
    if (/audio|transcript/.test(m.type ?? "") && /^response\./.test(m.type ?? ""))
      throw Error("AUDIO_TRANSCRIPT_NOT_TEXT");
    if (m.type === "response.output_text.delta") {
      const r = this.responses.get(m.response_id);
      if (!r || typeof m.delta !== "string") throw Error("UNMATCHED_TEXT_DELTA");
      r.text += m.delta;
      if (r.first === null && firstCompleteEnglishWord(r.text)) r.first = at;
    }
    if (m.type === "response.done") {
      const response = m.response, r = this.responses.get(response?.id);
      if (!r) throw Error("UNMATCHED_RESPONSE");
      if (response.model && response.model !== this.model) throw Error("MODEL_SUBSTITUTION");
      if (response.output?.some((item: any) => item.type !== "message" ||
          item.content?.some((part: any) => part.type !== "output_text")))
        throw Error("NON_TEXT_OUTPUT_FORBIDDEN");
      this.events.push({ kind: "usage", value: response.usage });
      const completed = response.status === "completed";
      if (completed) plainEnglish(r.text);
      const hint: Hint = {
        id: response.id, text: r.text.trim(),
        firstWordAt: r.first ?? (completed && firstCompleteEnglishWord(r.text, true) ? at : null),
        fullAt: at, completed, interrupted: response.status === "cancelled",
      };
      if (hint.interrupted) this.events.push({ kind: "interruption", at });
      this.hints.push(hint); this.events.push({ kind: "hint", hint });
      this.responses.delete(response.id);
    }
  }
  private gemini(m: any, at: number) {
    if (m.setupComplete) {
      // Gemini does not echo effective model/modalities. Do not fabricate verification.
      this.events.push({ kind: "ready", modelEcho: null }); this.ready = true;
    }
    if (m.usageMetadata) this.events.push({ kind: "usage", value: m.usageMetadata });
    const s = m.serverContent;
    if (!s) return;
    if (s.outputTranscription || s.inputTranscription ||
        s.modelTurn?.parts?.some((p: any) => p.inlineData || p.executableCode || p.functionCall))
      throw Error("AUDIO_TRANSCRIPT_NOT_TEXT");
    if (s.interrupted) {
      this.geminiInterrupted = true; this.events.push({ kind: "interruption", at });
    }
    for (const p of s.modelTurn?.parts ?? []) {
      if (p.thought === true) continue;
      if (typeof p.text !== "string") throw Error("NON_TEXT_OUTPUT_FORBIDDEN");
      this.geminiText += p.text;
      if (this.geminiFirst === null && firstCompleteEnglishWord(this.geminiText)) this.geminiFirst = at;
    }
    if (s.turnComplete) {
      if (!this.geminiInterrupted) plainEnglish(this.geminiText);
      const hint: Hint = {
        id: "gemini-" + this.geminiTurn++, text: this.geminiText.trim(),
        firstWordAt: this.geminiFirst ?? (!this.geminiInterrupted &&
          firstCompleteEnglishWord(this.geminiText, true) ? at : null),
        fullAt: at, completed: !this.geminiInterrupted, interrupted: this.geminiInterrupted,
      };
      this.hints.push(hint); this.events.push({ kind: "hint", hint });
      this.geminiText = ""; this.geminiFirst = null; this.geminiInterrupted = false;
    }
    // No documented physical input-EOT event is invented for Gemini.
  }
  pending() { return this.responses.size > 0 || !!this.geminiText; }
}
