import WebSocket from "ws";
import { performance } from "node:perf_hooks";
import { assertPaidExecutionAuthorized, instructions, sha, type Provider } from "./contracts";
import { NativeLedger } from "./ledger";
import { realtimeCost, sessionReserve, OPENAI_PRICE, type Bounds } from "./cost";
import { assertOutbound, NativeProtocol, ownerContext, setup } from "./protocol";

export interface Transport {
  send(value: unknown): void;
  close(): void;
}
export type Receiver = (message: unknown) => void;
export type TransportFactory = (provider: Provider, model: string, receive: Receiver,
  fail: (error: Error) => void, ready: () => void,
  receipt: (status: number, requestId: string | null) => void) => Transport;

/** The ONLY real socket constructor is fail-closed BEFORE reading keys or connecting. */
export const liveTransport: TransportFactory = (provider, model, receive, fail, ready, receipt) => {
  assertPaidExecutionAuthorized();
  const url = provider === "openai"
    ? `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`
    : "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
  const headers: Record<string, string> = provider === "openai"
    ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    : { "x-goog-api-key": process.env.GEMINI_API_KAY ?? "" };
  const ws = new WebSocket(url, { headers, handshakeTimeout: 15_000 });
  ws.on("open", ready);
  ws.on("upgrade", r => receipt(r.statusCode ?? 101, String(r.headers["x-request-id"] ?? "") || null));
  ws.on("unexpected-response", (_request, r) => {
    receipt(r.statusCode ?? 0, String(r.headers["x-request-id"] ?? "") || null);
    r.resume(); fail(Error("HANDSHAKE_HTTP_" + r.statusCode));
  });
  ws.on("message", raw => {
    try { receive(JSON.parse(raw.toString())); } catch { fail(Error("INVALID_PROVIDER_EVENT")); }
  });
  ws.on("error", () => fail(Error("NATIVE_SOCKET_ERROR")));
  ws.on("close", code => fail(Error("NATIVE_SOCKET_CLOSED_" + code)));
  return {
    send(value) {
      if (ws.readyState !== WebSocket.OPEN) throw Error("NATIVE_SOCKET_NOT_OPEN");
      ws.send(JSON.stringify(value));
    },
    close() { ws.removeAllListeners(); ws.terminate(); },
  };
};

export type SessionConfig = {
  provider: Provider; model: string; goal: string; requestId: string;
  audioSha256: string; corpusHash: string; bounds: Bounds; kind: "control" | "session" | "diagnostic";
  /** Must come from the complete free model catalogue, never from a guessed alias. */
  catalogIds: readonly string[];
};
export class NativeSession {
  readonly protocol: NativeProtocol;
  fatal: Error | null = null;
  private transport?: Transport;
  private usage: unknown[] = [];
  private epoch = 0;
  private reserved = false;
  private closed = false;
  private responseCount = 0;
  private ownerBytes = 0;
  private audioBytes = 0;
  private resolveReady?: () => void;
  private rejectReady?: (error: Error) => void;
  private httpStatus?: number;
  private handshakeId: string | null = null;
  constructor(readonly config: SessionConfig, private ledger: NativeLedger,
    private factory: TransportFactory = liveTransport, private now = () => performance.now()) {
    this.protocol = new NativeProtocol(config.provider, config.model);
  }
  private send(value: unknown) {
    if (this.fatal) throw this.fatal;
    assertOutbound(this.config.provider, value);
    this.transport!.send(value);
  }
  async open() {
    // Local preparation must fail before even creating a reserve or lock-sensitive request.
    if (this.factory === liveTransport) assertPaidExecutionAuthorized();
    const c = this.config;
    if (!c.catalogIds.includes(c.model)) throw Error("MODEL_NOT_IN_VERIFIED_CATALOG");
    if (c.provider !== "openai" || c.model !== OPENAI_PRICE.model)
      throw Error("MODEL_TEXT_TARIFF_NOT_VERIFIED_NO_REQUEST");
    if (c.bounds.instructionBytes < Buffer.byteLength(instructions(c.goal)))
      throw Error("INSTRUCTION_EXCEEDS_RESERVED_BOUND");
    const amount = sessionReserve(c.bounds);
    await this.ledger.reserve(c.requestId, c.kind, amount, sha(JSON.stringify({
      series: "native-text-autoeot", provider: c.provider, model: c.model,
      audio: c.audioSha256, corpus: c.corpusHash, goal: sha(c.goal),
      setup: setup(c.provider, c.model, c.goal, c.bounds.maxOutputTokens), bounds: c.bounds,
    })));
    this.reserved = true;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(Error("NATIVE_HANDSHAKE_TIMEOUT")), 20_000);
      this.resolveReady = () => { clearTimeout(timer); resolve(); };
      this.rejectReady = e => { clearTimeout(timer); reject(e); };
      try {
        this.transport = this.factory(c.provider, c.model, m => this.receive(m), e => this.fail(e),
          () => { if (c.provider === "gemini") this.send(setup(c.provider, c.model, c.goal, c.bounds.maxOutputTokens)); },
          (status, id) => { this.httpStatus = status; this.handshakeId = id; });
      } catch (e) { this.fail(e as Error); }
    });
  }
  private fail(e: Error) { this.fatal ??= e; this.rejectReady?.(e); }
  private receive(m: any) {
    try {
      if (m.type === "session.created") this.send(setup(this.config.provider, this.config.model,
        this.config.goal, this.config.bounds.maxOutputTokens));
      if (m.type === "response.created" && ++this.responseCount > this.config.bounds.maxResponses)
        throw Error("SESSION_RESPONSE_BOUND_EXCEEDED");
      for (const event of this.protocol.receive(m, this.now() - this.epoch)) {
        if (event.kind === "ready") this.resolveReady?.();
        if (event.kind === "usage") this.usage.push(event.value);
      }
    } catch (e) { this.fail(e as Error); }
  }
  beginAudio(epoch: number) { this.epoch = epoch; }
  audio(mulaw8k: Buffer) {
    if (!this.protocol.ready) throw Error("SESSION_NOT_READY");
    this.audioBytes += mulaw8k.length;
    if (this.audioBytes > (this.config.bounds.durationMs + 30_000) * 8) {
      this.fail(Error("AUDIO_EXCEEDS_RESERVED_BOUND")); throw this.fatal;
    }
    if (this.config.provider === "openai") {
      this.send({ type: "input_audio_buffer.append", audio: mulaw8k.toString("base64") });
    } else {
      // Required Gemini PCM16k container; sample repetition only, no enhancement.
      const pcm = Buffer.alloc(mulaw8k.length * 4);
      for (let i = 0; i < mulaw8k.length; i++) {
        const u = (~mulaw8k[i]) & 255, magnitude = (((u & 15) << 3) + 132) << ((u & 112) >> 4);
        const sample = u & 128 ? 132 - magnitude : magnitude - 132;
        pcm.writeInt16LE(sample, i * 4); pcm.writeInt16LE(sample, i * 4 + 2);
      }
      this.send({ realtimeInput: { audio: { data: pcm.toString("base64"), mimeType: "audio/pcm;rate=16000" } } });
    }
  }
  owner(text: string) {
    this.ownerBytes += Buffer.byteLength("Owner already said (context only): " + text);
    if (this.ownerBytes > this.config.bounds.ownerBytes) {
      this.fail(Error("OWNER_CONTEXT_EXCEEDS_RESERVED_BOUND")); throw this.fatal;
    }
    this.send(ownerContext(this.config.provider, text));
  }
  async close() {
    if (this.closed) return;
    this.closed = true; this.transport?.close();
    if (!this.reserved) return;
    const meta = { httpStatus: this.httpStatus, requestId: this.handshakeId };
    try {
      if (this.fatal || this.protocol.pending() || this.usage.length !== this.responseCount ||
          !this.responseCount) throw Error("NATIVE_SESSION_USAGE_OR_COMPLETION_UNKNOWN");
      const cost = this.usage.reduce<number>((sum, usage) => sum + realtimeCost(usage), 0);
      await this.ledger.finish(this.config.requestId, cost, meta);
    } catch (e) { this.fatal ??= e as Error; await this.ledger.unknown(this.config.requestId, meta); }
  }
  audit() {
    return {
      requestedModel: this.config.model,
      modelEcho: this.protocol.events.find(e => e.kind === "ready") ?? null,
      httpStatus: this.httpStatus ?? null, requestId: this.handshakeId,
      responseCount: this.responseCount, usage: this.usage, error: this.fatal?.message ?? null,
      events: this.protocol.events,
    };
  }
}
