// Provider routing + fallback for AI generation, extracted so it can be unit
// tested without pulling in the websocket server's heavy dependency graph
// (Deepgram, the pg pool, the ./index server bootstrap, etc.) or making a live
// API call. This mirrors the Task #69 extraction of the summarization
// orchestration into contactMemory.ts.
//
// The one rule that lives here is the gemini-first / OpenAI-fallback decision
// that keeps live calls working when one provider degrades:
//   - gemini-* model + good output            -> use Gemini's output
//   - gemini-* model + empty/unparseable/error -> fall back to OpenAI
//   - non-gemini model                          -> use OpenAI directly
//
// The Gemini and OpenAI calls are injected (see RouteGenerateDeps) so callers
// (and tests) decide how the providers are actually reached.

// A usable model reply must contain a JSON object; Gemini sometimes returns an
// empty string or prose, which we treat as a failure and fall back on.
export function looksLikeModelJson(raw: string | null | undefined): boolean {
  return !!raw && /\{[\s\S]*\}/.test(raw);
}

export interface RouteGenerateDeps {
  // The active model. gemini-* routes to Gemini first; anything else to OpenAI.
  model: string;
  // OpenAI model used as the automatic fallback when Gemini fails.
  fallbackModel: string;
  // Call Google Gemini with (model, systemPrompt, userPrompt) -> raw text.
  withGemini: (model: string, systemPrompt: string, userPrompt: string) => Promise<string>;
  // Call OpenAI with (model, systemPrompt, userPrompt) -> raw text.
  withOpenAI: (model: string, systemPrompt: string, userPrompt: string) => Promise<string>;
  // Override how a model name is classified as a Gemini model (defaults to the
  // "gemini" name prefix, matching the runtime allowlist).
  isGeminiModel?: (model: string) => boolean;
  // Optional hook invoked when the Gemini path fails and we fall back to OpenAI.
  // Receives the error (or empty/unparseable sentinel) that triggered fallback.
  onFallback?: (err: unknown) => void;
}

// Run AI generation with provider routing + fallback, returning the raw model
// text. For gemini-* models it tries Gemini first and falls back to OpenAI on
// any error or empty/unparseable output; every other model goes straight to
// OpenAI. Behavior-preserving extraction of the inline routing previously in
// server/websocket.ts.
export async function routeGenerate(
  systemPrompt: string,
  userPrompt: string,
  deps: RouteGenerateDeps,
): Promise<string> {
  const isGemini = deps.isGeminiModel ?? ((m: string) => m.startsWith("gemini"));

  if (isGemini(deps.model)) {
    try {
      const raw = await deps.withGemini(deps.model, systemPrompt, userPrompt);
      if (!looksLikeModelJson(raw)) throw new Error("empty or unparseable");
      return raw;
    } catch (err) {
      deps.onFallback?.(err);
      return deps.withOpenAI(deps.fallbackModel, systemPrompt, userPrompt);
    }
  }

  return deps.withOpenAI(deps.model, systemPrompt, userPrompt);
}
