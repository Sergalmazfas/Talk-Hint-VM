/** Isolated offline lab. Never imported by the live server or the old bench. */
import { createHash } from "node:crypto";
import { z } from "zod";

export const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
export const SERIES = "hint-polygon-owner-36-v1";
export const LIMIT_MICRO_USD = 15_000_000;
export const RecipeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), architecture: z.enum(["stt-brain", "audio-direct", "hint-first", "precomputed", "classifier-card", "speculative"]),
  model: z.string().min(1), judgeModel: z.string().min(1),
  stt: z.string(), prompt: z.enum(["full", "reduced", "minimal"]),
  maxOutputTokens: z.number().int().positive().max(4000),
  stream: z.boolean(), translation: z.enum(["together", "separate"]),
  cache: z.enum(["provider-auto", "off", "on"]),
  actionResultsEnabled: z.boolean(),
  eotThreshold: z.number().min(0).max(1), eotTimeoutMs: z.number().int().min(500).max(10000),
  replayRate: z.literal(1),
}).strict();
export type Recipe = z.infer<typeof RecipeSchema>;
export const BASELINE: Recipe = RecipeSchema.parse({
  id: "a-live-flux-terra", architecture: "stt-brain", model: "gpt-5.6-terra",
  judgeModel: "gpt-4.1-mini", stt: "flux-general-en", prompt: "full",
  maxOutputTokens: 250, stream: false, translation: "together", cache: "provider-auto",
  eotThreshold: 0.7, eotTimeoutMs: 3000, replayRate: 1,
  actionResultsEnabled: process.env.HINT_ACTION_RESULTS_ENABLED === "true",
});
/** Multi-factor architectures are not mislabeled as one-factor experiments. */
export const ARCHITECTURES = [
  { id: "b-openai-realtime", architecture: "audio-direct", phase: 2, adapter: "not_implemented" },
  { id: "b-gemini-live", architecture: "audio-direct", phase: 2, adapter: "not_implemented" },
  { id: "c-hint-first", architecture: "hint-first", phase: 3, adapter: "not_implemented" },
  { id: "d-precomputed", architecture: "precomputed", phase: 3, adapter: "not_implemented" },
  { id: "e-classifier-card", architecture: "classifier-card", phase: 3, adapter: "not_implemented" },
  { id: "f-speculative", architecture: "speculative", phase: 3, adapter: "not_implemented" },
] as const;
export function changedFactors(a: Recipe, b: Recipe) {
  return (Object.keys(a) as (keyof Recipe)[]).filter(k => !["id", "judgeModel"].includes(k) && a[k] !== b[k]);
}
export function assertOneFactor(a: Recipe, b: Recipe) {
  if (a.judgeModel !== b.judgeModel) throw Error("JUDGE_MUST_BE_FROZEN");
  const fields = changedFactors(a, b);
  if (fields.length !== 1) throw Error("EXACTLY_ONE_FACTOR_REQUIRED");
  return fields[0];
}
export function canonicalModel(id: string) { return id.replace(/-\d{4}-\d{2}-\d{2}$/, ""); }
export function assertIndependent(author: string, judge: string) {
  if (canonicalModel(author) === canonicalModel(judge)) throw Error("JUDGE_NOT_INDEPENDENT");
}
export function assertAdapter(r: Recipe) {
  RecipeSchema.parse(r); assertIndependent(r.model, r.judgeModel);
  if (r.architecture !== "stt-brain" || r.prompt !== "full" || r.stream || r.translation !== "together" ||
      r.cache !== "provider-auto" || r.stt !== "flux-general-en" || r.model !== "gpt-5.6-terra" ||
      r.judgeModel !== "gpt-4.1-mini") throw Error("ADAPTER_NOT_IMPLEMENTED_NO_SUBSTITUTION");
}
export type Segment = { startMs: number; endMs: number };
export function providerAudioMs(value:unknown): number|null {
  if((typeof value!=="number" && typeof value!=="string") || value==="")return null;
  const n=Number(value);return Number.isFinite(n)&&n>=0?n*1000:null;
}
export function speechEnd(segments: Segment[], startMs: number, endMs: number): number | null {
  if (![startMs, endMs].every(Number.isFinite) || startMs < 0 || endMs <= startMs) return null;
  // Audio windows, never transcript position/receipt order. Crossing a VAD
  // boundary is ambiguous: refuse rather than manufacture an early speech end.
  const intersect = segments.filter(s => s.endMs > startMs && s.startMs < endMs);
  // A physical speech segment can start before Flux's rolling window while
  // its END still belongs to that window. Only crossing its END is ambiguous.
  if (!intersect.length || intersect.some(s => s.endMs > endMs + 64)) return null;
  return Math.max(...intersect.map(s => s.endMs));
}
export function percentile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a,b) => a-b);
  return s[Math.max(0, Math.ceil(q * s.length) - 1)];
}
export const money = {
  sourceDate: "2026-11-02",
  deepgram: { perMinuteMicro: 7700, source: "https://deepgram.com/pricing" },
  brain: { input: 2, cached: 0.2, output: 12, source: "https://developers.openai.com/api/docs/models/gpt-5.6-terra" },
  judge: { input: 0.4, cached: 0.1, output: 1.6, source: "https://developers.openai.com/api/docs/models/gpt-4.1-mini" },
};
export function tokenCost(usage: any, rate: typeof money.brain) {
  const input = usage?.prompt_tokens, output = usage?.completion_tokens;
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  if (![input, output, cached].every(v => Number.isInteger(v) && v >= 0) || cached > input)
    throw Error("MISSING_OR_INVALID_USAGE");
  return Math.ceil((input-cached)*rate.input + cached*rate.cached + output*rate.output);
}
export const FACTOR_PLAN = [
  "prompt: full/reduced/minimal", "maxOutputTokens: 250/one-line",
  "stream: off/on", "translation: together/separate", "model: Terra/Luna/Gemini Flash",
  "eotThreshold", "eotTimeoutMs", "stt: Flux/Nova/OpenAI",
  "cache: provider auto; no fabricated hard-off switch or nonce disguised as same prompt",
];
