// Minimal, timeout-bounded OpenAI Chat Completions helpers for the benchmark.
// Uses plain fetch (no SDK, zero new deps). ZERO imports from the production
// call path. Every call has an explicit AbortController timeout so a hung API
// can never hang the benchmark.
//
// No silent model substitution: callers pass an exact model id and we send it
// verbatim. A rejected model id surfaces as the real API error string.

import type { BrainEnvelopeOutput, Strategy } from "./types";

export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

export const STRATEGY_ENUM: Strategy[] = [
  "answer",
  "clarify",
  "challenge",
  "confirm",
  "alternative",
  "escalate",
  "wait",
];

// json_schema for structured outputs (response_format). Kept strict so the
// model can only emit the frozen envelope fields.
export const ENVELOPE_JSON_SCHEMA = {
  name: "brain_envelope",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "should_suggest",
      "suggested_reply",
      "translation",
      "current_topic",
      "goal_status",
      "strategy",
    ],
    properties: {
      should_suggest: { type: "boolean" },
      // strict mode requires all keys present; allow null for optionals.
      suggested_reply: { type: ["string", "null"] },
      translation: { type: ["string", "null"] },
      current_topic: { type: ["string", "null"] },
      goal_status: { type: ["string", "null"] },
      strategy: { type: ["string", "null"], enum: [...STRATEGY_ENUM, null] },
    },
  },
} as const;

export interface FetchLike {
  (input: string, init?: any): Promise<{
    ok: boolean;
    status: number;
    body?: any;
    text: () => Promise<string>;
    json: () => Promise<any>;
  }>;
}

export interface NonStreamResult {
  ok: boolean;
  status: number;
  errorText?: string;
  content: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  latencyMs: number;
}

export interface ChatRequestOptions {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  responseFormat?: any;
  reasoningEffort?: "none" | "low";
  timeoutMs: number;
  fetchImpl?: FetchLike;
  nowMs: () => number;
}

// Build the request body. Some newer models require max_completion_tokens and
// reject max_tokens; we include a caller-chosen field. Reasoning models take a
// reasoning_effort param.
export function buildChatBody(opts: ChatRequestOptions, stream: boolean): Record<string, any> {
  const body: Record<string, any> = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    stream,
  };
  body.max_completion_tokens = opts.maxTokens;
  if (opts.responseFormat) body.response_format = opts.responseFormat;
  if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;
  if (stream) body.stream_options = { include_usage: true };
  return body;
}

async function doFetch(
  url: string,
  init: any,
  timeoutMs: number,
  fetchImpl?: FetchLike,
): Promise<any> {
  const f: any = fetchImpl || (globalThis as any).fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await f(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Streaming fetch whose AbortController + timer are returned to the CALLER so
// the timeout can keep protecting the ENTIRE body consumption (not just the
// header/handshake). The caller MUST call cleanup() when done reading to clear
// the timer, and can abort the reader by letting the deadline fire.
interface StreamingFetch {
  resp: any;
  controller: AbortController;
  timedOut: () => boolean;
  cleanup: () => void;
}

async function doFetchStreaming(
  url: string,
  init: any,
  timeoutMs: number,
  fetchImpl?: FetchLike,
): Promise<StreamingFetch> {
  const f: any = fetchImpl || (globalThis as any).fetch;
  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const resp = await f(url, { ...init, signal: controller.signal });
  return {
    resp,
    controller,
    timedOut: () => didTimeout,
    cleanup: () => clearTimeout(timer),
  };
}

// A single non-streaming chat call, timeout-bounded.
export async function chatOnce(opts: ChatRequestOptions): Promise<NonStreamResult> {
  const start = opts.nowMs();
  const body = buildChatBody(opts, false);
  let resp: any;
  try {
    resp = await doFetch(
      OPENAI_CHAT_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      },
      opts.timeoutMs,
      opts.fetchImpl,
    );
  } catch (e: any) {
    const latencyMs = opts.nowMs() - start;
    const msg = e?.name === "AbortError" ? `timeout after ${opts.timeoutMs}ms` : String(e?.message || e);
    return { ok: false, status: 0, errorText: msg, content: "", latencyMs };
  }
  const latencyMs = opts.nowMs() - start;
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, errorText: errText.slice(0, 500), content: "", latencyMs };
  }
  const data = await resp.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content ?? "";
  return { ok: true, status: resp.status, content, usage: data?.usage, latencyMs };
}

export interface StreamResult {
  ok: boolean;
  status: number;
  errorText?: string;
  content: string;
  firstTokenMs: number | null;
  fullOutputMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

// A streaming chat call. Returns first-delta timing + full output timing and
// usage tokens (from the final chunk when include_usage is set). Timeout-bounded.
export async function chatStream(opts: ChatRequestOptions): Promise<StreamResult> {
  const start = opts.nowMs();
  const body = buildChatBody(opts, true);

  const timeoutResult = (): StreamResult => ({
    ok: false,
    status: 0,
    errorText: `timeout after ${opts.timeoutMs}ms`,
    content: "",
    firstTokenMs: null,
    fullOutputMs: null,
    tokensIn: null,
    tokensOut: null,
  });

  let sf: StreamingFetch;
  try {
    sf = await doFetchStreaming(
      OPENAI_CHAT_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      },
      opts.timeoutMs,
      opts.fetchImpl,
    );
  } catch (e: any) {
    // Abort during the handshake => timeout; anything else is a network error.
    if (e?.name === "AbortError") return timeoutResult();
    return {
      ok: false,
      status: 0,
      errorText: String(e?.message || e),
      content: "",
      firstTokenMs: null,
      fullOutputMs: null,
      tokensIn: null,
      tokensOut: null,
    };
  }

  const { resp, timedOut, cleanup } = sf;

  try {
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return {
        ok: false,
        status: resp.status,
        errorText: errText.slice(0, 500),
        content: "",
        firstTokenMs: null,
        fullOutputMs: null,
        tokensIn: null,
        tokensOut: null,
      };
    }

    let content = "";
    let firstTokenMs: number | null = null;
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;

    // resp.body is a web ReadableStream of SSE bytes. Read incrementally. The
    // timer from doFetchStreaming stays armed for the WHOLE read, so a stalled
    // stream trips controller.abort() and reader.read() rejects — the deadline
    // covers body consumption, not just the handshake.
    const reader = resp.body?.getReader?.();
    const decoder = new TextDecoder();
    let buffer = "";

    const handleData = (payload: string) => {
      if (payload === "[DONE]") return;
      let json: any;
      try {
        json = JSON.parse(payload);
      } catch {
        return;
      }
      const delta = json?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        if (firstTokenMs === null) firstTokenMs = opts.nowMs() - start;
        content += delta;
      }
      if (json?.usage) {
        tokensIn = json.usage.prompt_tokens ?? tokensIn;
        tokensOut = json.usage.completion_tokens ?? tokensOut;
      }
    };

    const consumeBuffer = () => {
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith("data:")) handleData(line.slice(5).trim());
      }
    };

    if (reader) {
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          consumeBuffer();
        }
        buffer += decoder.decode();
        consumeBuffer();
      } catch (e: any) {
        // Deadline fired mid-stream (or the transport errored). Cancel the
        // reader and surface a bounded timeout/error — never hang the turn.
        await reader.cancel().catch(() => {});
        if (timedOut() || e?.name === "AbortError") return timeoutResult();
        return {
          ok: false,
          status: 0,
          errorText: `stream read error: ${String(e?.message || e)}`,
          content: "",
          firstTokenMs: null,
          fullOutputMs: null,
          tokensIn: null,
          tokensOut: null,
        };
      }
    } else if (typeof resp.text === "function") {
      // Fallback for mocked responses that expose text() with the raw SSE stream.
      buffer = await resp.text();
      consumeBuffer();
    }

    // If the deadline fired but the read still completed (e.g. tiny mock), honor it.
    if (timedOut()) return timeoutResult();

    const fullOutputMs = opts.nowMs() - start;
    return {
      ok: true,
      status: resp.status,
      content,
      firstTokenMs,
      fullOutputMs,
      tokensIn,
      tokensOut,
    };
  } finally {
    cleanup();
  }
}

// Parse envelope JSON from raw model text into a typed output. Returns null on
// malformed JSON so callers can mark schemaValid=false and continue.
export function parseEnvelope(raw: string): BrainEnvelopeOutput | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.should_suggest !== "boolean") return null;
  const out: BrainEnvelopeOutput = { should_suggest: parsed.should_suggest };
  if (typeof parsed.suggested_reply === "string") out.suggested_reply = parsed.suggested_reply;
  if (typeof parsed.translation === "string") out.translation = parsed.translation;
  if (typeof parsed.current_topic === "string") out.current_topic = parsed.current_topic;
  if (typeof parsed.goal_status === "string") out.goal_status = parsed.goal_status;
  if (typeof parsed.strategy === "string" && (STRATEGY_ENUM as string[]).includes(parsed.strategy)) {
    out.strategy = parsed.strategy as Strategy;
  }
  return out;
}
