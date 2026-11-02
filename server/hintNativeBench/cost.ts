/** Micro-USD per token == USD per million tokens. Rates are NOT an invoice.
 * Only OpenAI's verified TEXT session tariff is frozen for preparation.
 * Gemini tariff/handshake must be rechecked before opening the paid gate. */
export const OPENAI_PRICE = Object.freeze({
  model: "gpt-realtime-2.1", text: 4, audio: 32, cachedText: 0.4, cachedAudio: 0.4,
  outText: 24, outAudio: 64,
  source: "https://developers.openai.com/api/docs/pricing",
  tokenSource: "https://developers.openai.com/api/docs/guides/realtime-costs",
  retrieved: "2026-11-02",
});
const count = (v: unknown): number => {
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw Error("USAGE_UNKNOWN");
  return v as number;
};
export function realtimeCost(u: any) {
  const input = count(u?.input_tokens), output = count(u?.output_tokens);
  const d = u?.input_token_details, o = u?.output_token_details;
  const text = count(d?.text_tokens), audio = count(d?.audio_tokens);
  const outText = count(o?.text_tokens), outAudio = count(o?.audio_tokens);
  if (input !== text + audio || output !== outText + outAudio) throw Error("USAGE_MODALITY_MISMATCH");
  const cached = count(d?.cached_tokens ?? 0), c = d?.cached_tokens_details;
  if (cached && !c) throw Error("CACHE_USAGE_UNKNOWN");
  const ct = count(c?.text_tokens ?? 0), ca = count(c?.audio_tokens ?? 0);
  if (ct + ca !== cached || ct > text || ca > audio) throw Error("CACHE_USAGE_INVALID");
  return Math.ceil((text - ct) * OPENAI_PRICE.text + (audio - ca) * OPENAI_PRICE.audio +
    ct * OPENAI_PRICE.cachedText + ca * OPENAI_PRICE.cachedAudio +
    outText * OPENAI_PRICE.outText + outAudio * OPENAI_PRICE.outAudio);
}
export type Bounds = {
  durationMs: number; maxResponses: number; maxOutputTokens: number;
  instructionBytes: number; ownerBytes: number;
};
export function sessionReserve(b: Bounds) {
  if (!Object.values(b).every(v => Number.isSafeInteger(v) && v >= 0) ||
      b.durationMs < 1 || b.maxResponses < 1 || b.maxResponses > 128 ||
      b.maxOutputTokens < 1 || b.maxOutputTokens > 500) throw Error("INVALID_SESSION_BOUND");
  // Each automatic response may reprocess the ENTIRE growing conversation.
  // Use 5x documented audio token rate, byte-per-token text upper estimate,
  // all responses' output as possible subsequent input, envelope + drain.
  const inputText = b.instructionBytes + b.ownerBytes + 8192 + b.maxResponses * b.maxOutputTokens * 4;
  const inputAudio = (b.durationMs + 30_000) / 1000 * 50;
  // Include one in-flight over-bound response before the socket can terminate.
  return Math.ceil((b.maxResponses + 1) * (inputText * OPENAI_PRICE.text * 1.25 +
    inputAudio * OPENAI_PRICE.audio + b.maxOutputTokens * OPENAI_PRICE.outAudio) * 1.25);
}
