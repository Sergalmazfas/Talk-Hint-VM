import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "./index";
import { isFarewellUtterance } from "./farewellFilter";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { TALKHINT_GOLDEN_PROMPT, PREP_PROMPT, LANGUAGE_NAMES, MODE_PROMPTS, getModePrompt, getFullPrompt, LIVE_ANTI_LOOP_RULES, LIVE_GROUNDING_RULES, GOAL_PRIORITY_RULES, STRATEGY_MEMORY_RULES, buildLiveSystemPrompt, buildAskRefinePrompt } from "@shared/prompts";
import { FastLayerManager, FastPhraseResult, FAST_THRESHOLD_MS, FAST_COOLDOWN_MS } from "./fastLayer";
import { getOrCreateEngine, removeEngine, GoalEngine } from "./goalEngine";
import { UtteranceGate } from "./utteranceGate";
import { getSessionUserId } from "./auth";
import { isValidSpikeToken, handleTranslatorSpikeStream } from "./translation/spike";
import { handleIOSTranslatorStream } from "./translation/iosTranslator";
import { handleTranslatorTwilioStream, subscribeTranslatorFeed } from "./translation/twilioBridge";
import { storage } from "./storage";
import { db } from "./db";
import { pendingCalls } from "@shared/schema";
import type { DialogueEntry, DialogueLibrary } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { GoalState, SlotMap, GoalType } from "../shared/goalTypes";
import { formatContactMemory, deriveOtherPartyPhone, buildContextSections, buildContextProviderChain, formatStaticCards, summarizeAndSaveContactMemory as runSummarizeAndSaveContactMemory } from "./contactMemory";
import { claimActiveCallMemory, formatCallMemoryBlock } from "./tutorStorage";
import { deliverCallToAirAtoma } from "./airatomaRetryWorker";
import { renderTranscriptText } from "./airatomaWebhook";
import { routeGenerate, buildOpenAIChatBody } from "./hintProvider";
import { resolveSpeakerRole, streamRidesCallerLeg } from "./speakerRoles";
import {
  DISABLED_PIPELINE,
  isCandidateStt,
  createOpenAiRealtimeStt,
  LiveLatencyRecorder,
  type CandidatePipelineConfig,
} from "./candidatePipeline";
import {
  registerLatencyRecorder,
  unregisterLatencyRecorder,
  recordSuggestionAck,
  SUGGESTION_ACK_GRACE_MS,
} from "./latencyAck";
import { normalizeText, textSimilarity, matchDialogueLibrary as matchDialogueLibraryPure, isOwnerOnlyQuestion } from "./dialogueMatch";
import { resolveWaitState, shouldResetWaitTracking, isQuestionOrActionRequest } from "./waitState";
import { HintCarryover } from "./hintCarryover";
import { prepareMessage, clearPrepareState, clearOpeningDedup, PrepareUnavailableError } from "./prepare";
import { handlePrepareConfirmGoal } from "./prepareConfirm";
import { SuggestionDedupGuard } from "./hintDedup";
import { normalizeSuggestion, type NormalizedSuggestion } from "./hintShape";
import { StrategyMemoryTracker } from "./strategyMemory";

// μ-law to linear PCM16 conversion table (8kHz μ-law to 16-bit PCM)
const MULAW_DECODE_TABLE = new Int16Array(256);
(function initMulawTable() {
  for (let i = 0; i < 256; i++) {
    const mulaw = ~i;
    const sign = mulaw & 0x80;
    const exponent = (mulaw >> 4) & 0x07;
    const mantissa = mulaw & 0x0f;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    MULAW_DECODE_TABLE[i] = sign ? -sample : sample;
  }
})();

// Convert μ-law buffer to PCM16 and upsample 8kHz to 24kHz (3x)
function mulawToPcm16(mulawBase64: string): string {
  const mulawBytes = Buffer.from(mulawBase64, "base64");
  // Upsample 8kHz to 24kHz (3x replication for simplicity)
  const pcm16Buffer = Buffer.alloc(mulawBytes.length * 2 * 3);
  
  for (let i = 0; i < mulawBytes.length; i++) {
    const sample = MULAW_DECODE_TABLE[mulawBytes[i]];
    // Replicate each sample 3 times for 8kHz -> 24kHz
    for (let j = 0; j < 3; j++) {
      const offset = (i * 3 + j) * 2;
      pcm16Buffer.writeInt16LE(sample, offset);
    }
  }
  
  return pcm16Buffer.toString("base64");
}

interface TwilioMediaMessage {
  event: string;
  sequenceNumber?: string;
  streamSid?: string;
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  start?: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    customParameters: Record<string, string>;
  };
  stop?: {
    accountSid: string;
    callSid: string;
  };
}

const MODES: Record<string, { name: string; description: string }> = {
  universal: { name: "Universal Assistant", description: "General purpose real-time assistant" },
  massage: { name: "Massage Salon Assistant", description: "Helps massage therapists communicate with clients" },
  dispatcher: { name: "Dispatcher Assistant", description: "Helps dispatchers handle calls efficiently" },
};

// Re-export prompts from centralized location
export { TALKHINT_GOLDEN_PROMPT, PREP_PROMPT, LANGUAGE_NAMES } from "@shared/prompts";

// Analyze sentiment of text
async function analyzeSentiment(text: string): Promise<{ sentiment: 'positive' | 'neutral' | 'negative'; score: number }> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Analyze the emotional tone/sentiment of the text. Return JSON only:
{"sentiment": "positive" | "neutral" | "negative", "score": 0.0 to 1.0}
Score: 1.0 = very strong emotion, 0.0 = neutral. Be concise.`
          },
          { role: "user", content: text }
        ],
        temperature: 0.3,
        max_tokens: 50,
      }),
    });

    if (!response.ok) return { sentiment: 'neutral', score: 0.5 };
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        sentiment: parsed.sentiment || 'neutral',
        score: typeof parsed.score === 'number' ? parsed.score : 0.5
      };
    }
    return { sentiment: 'neutral', score: 0.5 };
  } catch (err) {
    return { sentiment: 'neutral', score: 0.5 };
  }
}

// Translate guest speech and generate suggestion
const PREAMBLE_PATTERNS = [
  /^(i understand|i see|i hear you|i get it|that makes sense)[,.]?\s*/i,
  /^(of course|certainly|absolutely|sure)[,.]?\s*/i,
  /^(great|perfect|wonderful|excellent|awesome)[,!.]?\s*/i,
  /^(let me|allow me|let's)[^.!?]*[,.]?\s*/i,
  /^(okay|ok|alright)[,.]?\s*/i,
];
function stripPreamble(text: string): string {
  let result = text.trim();
  for (const pattern of PREAMBLE_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result.trim();
}

// Model used for live hint generation (translation + suggestion).
// Override the default without a code change via the HINT_MODEL env var.
// Step 1 (live-latency work): OpenAI is now the PRIMARY live-hint provider.
// Gemini is no longer the default primary because in production it failed on
// 50-71% of turns and — with no timeout — caused 5-15s stalls. Gemini stays
// available (user-selectable / as a fallback) but is hard-capped at 700ms
// (GEMINI_TIMEOUT_MS) so it can never stall a live call again.
// LIVE BRAIN switch (benchmark-driven): default is now gpt-5.6-terra — the
// exact profile that ran in the BRAIN benchmark (reasoning_effort="none",
// max_completion_tokens, no temperature — see generateWithOpenAI). Everything
// else (prompt, STT, wire-format, timeouts, telemetry) is unchanged.
// Rollback: set HINT_MODEL=gpt-4.1-mini (env) or set_model from the UI —
// gpt-4.1-mini stays in the allowlist and remains the automatic fallback model.
const HINT_MODEL = process.env.HINT_MODEL || "gpt-5.6-terra";
// Models the user is allowed to pick from the settings UI.
// gemini-* models are routed to Google Gemini; everything else to OpenAI.
const ALLOWED_HINT_MODELS = [
  "gpt-5.6-terra",
  "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o-mini", "gpt-4o",
  "gemini-2.5-flash-lite", "gemini-2.5-flash",
];
// Active model — global (single-user app), changeable at runtime via set_model.
let currentModel = ALLOWED_HINT_MODELS.includes(HINT_MODEL) ? HINT_MODEL : "gpt-4.1-mini";

// Google Gemini key. The secret was added as GEMINI_API_KAY (typo) — accept either name.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KAY || "";

// Hard cap on any Gemini call. Gemini has NO other timeout, so before this a
// degraded/hung Gemini could block a live turn for 11-15s (seen in prod). With
// OpenAI now primary, Gemini is only reached when a user explicitly selects it
// (or as a fallback); either way it must abort fast and let the caller recover.
const GEMINI_TIMEOUT_MS = 700;

// Call Google Gemini (generateContent REST). Used when currentModel is a gemini-* model.
// thinkingBudget=0 disables "thinking" so short hints stay fast and don't burn the token budget.
async function generateWithGemini(model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY (or GEMINI_API_KAY) is not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 250,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    // AbortController fires a DOMException/AbortError; normalize to a clear
    // timeout error so routeGenerate's fallback path treats it like any failure.
    if (controller.signal.aborted) {
      throw new Error(`Gemini timeout after ${GEMINI_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Gemini API error: ${response.status} ${errText.slice(0, 200)}`);
  }
  const data: any = await response.json();
  const parts = data.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.map((p: any) => p.text || "").join("") : "";
}

// OpenAI model used as the automatic fallback when the Gemini provider fails
// (error, timeout, or empty/unparseable output) so live calls never lose hints.
const OPENAI_FALLBACK_MODEL = "gpt-4.1-mini";

// Counters to spot Gemini degradation: how often the Gemini hint path was tried
// vs. how often it failed and fell back to OpenAI. Exposed via getHintFallbackStats()
// (surfaced on GET /api/health) and logged on every fallback as a running rate.
let geminiHintAttempts = 0;
let geminiHintFallbacks = 0;

export function getHintFallbackStats() {
  const rate = geminiHintAttempts > 0 ? geminiHintFallbacks / geminiHintAttempts : 0;
  return {
    geminiAttempts: geminiHintAttempts,
    geminiFallbacks: geminiHintFallbacks,
    fallbackRatePct: Math.round(rate * 1000) / 10, // percent, 1 decimal place
  };
}

async function generateWithOpenAI(model: string, systemPrompt: string, userPrompt: string, maxTokens: number = 80): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(buildOpenAIChatBody(model, systemPrompt, userPrompt, maxTokens)),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`GPT API error: ${response.status} ${errText.slice(0, 200)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function translateAndSuggest(text: string, goal: string, language: string = "ru", conversationContext: string = "", forceSuggestion: boolean = true, userContext: string = "", contactContext: string = "", staticCards: string = "", translateEnabled: boolean = true, tutorMemory: string = "", modelOverride?: string, strategyMemory: string = ""): Promise<{
  translation: string;
  explanation?: string;
  suggestion?: NormalizedSuggestion;
  sentiment?: { sentiment: 'positive' | 'neutral' | 'negative'; score: number };
  providerUsed?: string;
}> {
  // Candidate Pipeline v1 (Task #207): a per-call model override (candidate
  // Brain) takes precedence over the global UI-selected model — production
  // calls (no override) are unchanged.
  const activeModel = modelOverride || currentModel;
  // Don't wait for sentiment - return it separately via callback
  // This makes suggestions appear FASTER
  try {
    const contextSections = buildContextProviderChain({ userContext, contactContext, staticCards, tutorMemory });

    // Translation can be disabled per-user: when off we ask the model NOT to
    // translate (no guest translation, English-only suggestion) so no extra
    // translation tokens are spent and the UI shows the original language only.
    // Prompt assembly lives in buildLiveSystemPrompt (shared/prompts.ts) so it
    // can be unit-tested directly against the real string.
    const systemPrompt = buildLiveSystemPrompt({
      goal,
      language,
      conversationContext,
      contextSections,
      translateEnabled,
      strategyMemory,
    });

    const userPrompt = `Guest said: "${text}"

Remember: Your suggestion must ADVANCE the user's goal. If guest said "let me check" or similar - just acknowledge once, don't push with new questions.`;

    // Parse a model's JSON reply into our hint shape (or null if unparseable).
    const parseHint = (raw: string) => {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      let parsed: any;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return null;
      }
      const sentimentRaw = typeof parsed.sentiment === "string" ? parsed.sentiment.toLowerCase().trim() : "";
      const validSentiment = ["positive", "neutral", "negative"].includes(sentimentRaw)
        ? (sentimentRaw as "positive" | "neutral" | "negative")
        : (sentimentRaw === "urgent" || sentimentRaw === "confused")
          ? "negative"
          : undefined;
      // Adaptive hint types (v2.1): validate type/options/native_helper, apply
      // the translate gate, and compose the old-client compatibility en/
      // translation for CHOICE — all pure string work (no extra model call).
      // Legacy replies (no type) keep the exact pre-v2.1 shape/behavior.
      const suggestion = normalizeSuggestion(parsed.suggestion, { translateEnabled, stripPreamble }) ?? undefined;
      return {
        translation: parsed.translation || "",
        explanation: parsed.explanation || undefined,
        suggestion,
        sentiment: validSentiment ? { sentiment: validSentiment, score: 1 } : undefined,
      };
    };

    const hasSuggestion = (r: ReturnType<typeof parseHint>) =>
      !!(r && r.suggestion && typeof r.suggestion.en === "string" && r.suggestion.en.trim().length > 0);

    const isGemini = activeModel.startsWith("gemini");
    // Count every Gemini attempt so getHintFallbackStats() can report a rate.
    if (isGemini) geminiHintAttempts++;
    let fellBack = false;

    // Provider routing + fallback lives in routeGenerate (tested in
    // server/__tests__/hintProvider.test.ts): gemini models try Gemini first and
    // fall back to OpenAI on any error / empty / unparseable output; everything
    // else goes straight to OpenAI. The onFallback hook records the fallback for
    // the /api/health stats and logs the running rate.
    const content = await routeGenerate(systemPrompt, userPrompt, {
      model: activeModel,
      fallbackModel: OPENAI_FALLBACK_MODEL,
      withGemini: generateWithGemini,
      // The combined translation+suggestion JSON needs more room than the
      // default 80-token cap or the reply gets truncated mid-JSON and parseHint
      // silently drops the suggestion (root cause of "one hint then nothing"
      // after OpenAI became primary — Gemini used 250 tokens). 250 matches
      // Gemini; it's a cap, not spend, so short turns still finish early.
      // Also covers the Gemini->OpenAI fallback inside routeGenerate.
      withOpenAI: (m: string, s: string, u: string) => generateWithOpenAI(m, s, u, 250),
      onFallback: (gemErr: any) => {
        geminiHintFallbacks++;
        fellBack = true;
        const pct = Math.round((geminiHintFallbacks / geminiHintAttempts) * 100);
        log(`Gemini (${activeModel}) failed: ${gemErr?.message ?? gemErr} — falling back to OpenAI ${OPENAI_FALLBACK_MODEL} [fallbacks ${geminiHintFallbacks}/${geminiHintAttempts} = ${pct}%]`, "openai");
      },
    });
    let result = parseHint(content);

    // Which provider actually produced this hint — returned to the caller so the
    // guest-utterance handler can log provider_used alongside the split
    // translation/suggestion latencies. openai:<model> normally; gemini:* only
    // when a user picks Gemini; openai:<fallback> when a Gemini attempt failed.
    const providerUsed = fellBack
      ? `openai:${OPENAI_FALLBACK_MODEL} (fallback from ${activeModel})`
      : isGemini
        ? `gemini:${activeModel}`
        : `openai:${activeModel}`;

    // Gemini sometimes returns a valid translation but silently drops the
    // suggestion. On a turn that should have a hint (not a reaction/farewell)
    // that means a dead turn for the user, so treat a missing suggestion as a
    // fallback trigger and ask OpenAI for a proper hint.
    if (isGemini && !fellBack && forceSuggestion && !hasSuggestion(result)) {
      geminiHintFallbacks++;
      const pct = Math.round((geminiHintFallbacks / geminiHintAttempts) * 100);
      log(`Gemini (${activeModel}) returned no suggestion — falling back to OpenAI ${OPENAI_FALLBACK_MODEL} [fallbacks ${geminiHintFallbacks}/${geminiHintAttempts} = ${pct}%]`, "openai");
      try {
        const fbResult = parseHint(await generateWithOpenAI(OPENAI_FALLBACK_MODEL, systemPrompt, userPrompt, 250));
        if (hasSuggestion(fbResult)) {
          // Keep Gemini's translation if OpenAI didn't supply its own.
          result = { ...fbResult!, translation: fbResult!.translation || result?.translation || "" };
        }
      } catch (fbErr: any) {
        log(`OpenAI suggestion fallback failed: ${fbErr.message}`, "openai");
      }
    }

    // Translation disabled: enforce empties even if the model ignored the prompt,
    // so the guest transcript and the hint are never shown translated. The
    // suggestion's own translated fields (translation, option translations,
    // native_helper) are already force-emptied inside normalizeSuggestion.
    if (!translateEnabled && result) {
      result = { ...result, translation: "" };
    }

    const finalResult = result ?? { translation: "" };
    return { ...finalResult, providerUsed };
  } catch (err: any) {
    log(`Translation error: ${err.message}`, "openai");
    return { translation: "", providerUsed: "error" };
  }
}

// Live-call "Ask" refine: the owner typed a mid-call instruction; produce ONE
// replacement hint grounded in the live conversation + the current hint. This
// is a SUGGESTION path — LIVE_GROUNDING_RULES are inside buildAskRefinePrompt
// (shared/prompts.ts, unit-tested). Latency matters (the user is on the phone),
// so this always uses an OpenAI model directly: the per-call Brain override or
// the global model when they are OpenAI, else the fast fallback model.
export async function refineHintFromAsk(instruction: string, opts: {
  goal: string;
  language: string;
  conversationContext: string;
  currentHint: string;
  userContext: string;
  contactContext: string;
  staticCards: string;
  tutorMemory: string;
  translateEnabled: boolean;
  strategyMemory: string;
  modelOverride?: string;
}): Promise<{ en: string; translation: string } | null> {
  try {
    const contextSections = buildContextProviderChain({
      userContext: opts.userContext,
      contactContext: opts.contactContext,
      staticCards: opts.staticCards,
      tutorMemory: opts.tutorMemory,
    });
    const systemPrompt = buildAskRefinePrompt({
      goal: opts.goal,
      language: opts.language,
      conversationContext: opts.conversationContext,
      currentHint: opts.currentHint,
      contextSections,
      translateEnabled: opts.translateEnabled,
      strategyMemory: opts.strategyMemory,
    });
    const nonGemini = (m?: string) => (m && !m.startsWith("gemini") ? m : undefined);
    const model = nonGemini(opts.modelOverride) ?? nonGemini(currentModel) ?? OPENAI_FALLBACK_MODEL;
    const raw = await generateWithOpenAI(model, systemPrompt, instruction, 150);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const en = typeof parsed.en === "string" ? parsed.en.trim() : "";
    if (!en) return null;
    // Translation-OFF gate (user requirement: OFF must gate EVERY suggestion path).
    const translation =
      opts.translateEnabled && typeof parsed.translation === "string" ? parsed.translation.trim() : "";
    return { en, translation };
  } catch (err: any) {
    log(`[AskRefine] failed: ${err?.message}`, "server");
    return null;
  }
}

// Fast, translation-only call for the live caption. Split out from
// translateAndSuggest so the guest's translated caption can be shown WITHOUT
// waiting for the (slower) suggestion generation. It uses the SAME provider
// routing (routeGenerate) and a JSON contract so the OpenAI/Gemini fallback
// behaves identically to the suggestion path. This is intentionally a minimal,
// isolated translator prompt — it is NOT the hint/objection prompt (unchanged).
async function translateGuestText(text: string, language: string, modelOverride?: string): Promise<{ translation: string; providerUsed: string }> {
  const activeModel = modelOverride || currentModel;
  const langName = language === "es" ? "Spanish" : "Russian";
  const systemPrompt = `You are a translator. Translate the user's message into ${langName}. Respond with ONLY this JSON and nothing else: {"translation":"<the ${langName} translation>"}`;
  const isGemini = activeModel.startsWith("gemini");
  let fellBack = false;
  try {
    const raw = await routeGenerate(systemPrompt, text, {
      model: activeModel,
      fallbackModel: OPENAI_FALLBACK_MODEL,
      withGemini: generateWithGemini,
      withOpenAI: generateWithOpenAI,
      onFallback: () => { fellBack = true; },
    });
    let translation = "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { translation = String(JSON.parse(m[0]).translation ?? "").trim(); } catch { translation = ""; }
    }
    if (!translation) translation = raw.trim(); // tolerate a plain-text reply
    const providerUsed = fellBack
      ? `openai:${OPENAI_FALLBACK_MODEL} (fallback from ${activeModel})`
      : isGemini
        ? `gemini:${activeModel}`
        : `openai:${activeModel}`;
    return { translation, providerUsed };
  } catch (err: any) {
    log(`Guest translation error: ${err.message}`, "openai");
    return { translation: "", providerUsed: "error" };
  }
}

// After a call ends, summarize the transcript and upsert the contact's memory.
// Runs detached from call teardown — never block the websocket close path on it.
async function summarizeAndSaveContactMemory(
  userId: string,
  phoneNumber: string,
  transcript: { speaker: string; text: string }[]
): Promise<void> {
  await runSummarizeAndSaveContactMemory(userId, phoneNumber, transcript, {
    // Provider routing mirrors translateAndSuggest: gemini models try Gemini
    // first and fall back to OpenAI on empty/unparseable output; everything else
    // goes straight to OpenAI. The decision lives in routeGenerate (tested in
    // server/__tests__/hintProvider.test.ts).
    generate: (systemPrompt, userPrompt) =>
      routeGenerate(systemPrompt, userPrompt, {
        model: currentModel,
        fallbackModel: OPENAI_FALLBACK_MODEL,
        withGemini: generateWithGemini,
        // Contact summaries can run to ~300 tokens of JSON; the default 80-token
        // cap truncated long-call responses mid-object (unparseable_json).
        withOpenAI: (model, sp, up) => generateWithOpenAI(model, sp, up, 400),
      }),
    // The upsert fills the auto-extracted name atomically (COALESCE) — it only
    // writes a missing name and never overwrites a user-set one, so no separate
    // read-then-write name gate is needed here (avoids the race window).
    save: (input) => storage.upsertContactMemory(input),
    log: (message) => log(message, "websocket"),
  });
}

// Use getModePrompt from shared/prompts.ts instead of local PROMPTS
function getRealtimePrompt(mode: string = "universal"): string {
  return getModePrompt(mode);
}

let currentMode = "universal";
let currentLanguage = "ru"; // Default to Russian, can be "ru" or "es"
const uiClients = new Set<WebSocket>();
// Each /ui (and /honor-stream) socket is bound to the user it authenticated as,
// so live transcripts/hints are delivered only to that user — never broadcast
// to every connected client.
const uiClientUsers = new Map<WebSocket, string>();
// callSid -> owning userId. Populated when a call is accepted so the Twilio
// media stream can route its transcripts/suggestions to the right user.
const callOwners = new Map<string, string>();

/** Records which user owns a call (called from the /api/call/accept route). */
export function setCallOwner(callSid: string, userId: string) {
  callOwners.set(callSid, userId);
}

/** Forgets a call's owner (call ended / rejected). */
export function clearCallOwner(callSid: string) {
  callOwners.delete(callSid);
}

// Suggestion delivery-ack routing lives in server/latencyAck.ts: it keeps its
// OWN ownership snapshot so acks keep landing through the post-close grace
// window even after clearCallOwner() wipes the callOwners entry.

// Filter JSON from text - never show raw JSON to users
function filterJsonFromText(text: string): string {
  if (!text) return text;
  
  // Remove JSON blocks like {...} or [{...}]
  let filtered = text.replace(/\{[\s\S]*?\}/g, '').replace(/\[[\s\S]*?\]/g, '');
  
  // Clean up leftover formatting
  filtered = filtered.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  filtered = filtered.trim();
  
  // If nothing left after filtering, extract useful fields from original
  if (!filtered && text.includes('{')) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Extract common fields
        const parts: string[] = [];
        if (parsed.suggestion) parts.push(parsed.suggestion);
        if (parsed.en || parsed.english) parts.push(parsed.en || parsed.english);
        if (parsed.translation || parsed.ru) parts.push(parsed.translation || parsed.ru);
        if (parsed.text) parts.push(parsed.text);
        filtered = parts.join('\n\n') || "Готово";
      }
    } catch {}
  }
  
  return filtered || text;
}

// Delivers a message only to the connected /ui sockets belonging to `userId`.
// Fails closed: if the owning user is unknown, the message is dropped rather
// than leaked to other users' clients.
function sendToUser(userId: string | undefined, message: object) {
  if (!userId) {
    log(`[sendToUser] No owner for ${(message as any).type} - dropping (fail-closed)`, "server");
    return;
  }
  const data = JSON.stringify(message);
  let sent = 0;
  uiClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && uiClientUsers.get(client) === userId) {
      client.send(data);
      sent++;
    }
  });
  log(`[sendToUser] ${(message as any).type} -> ${sent} client(s) for user ${userId}`, "server");
}

// No audio conversion needed - OpenAI accepts mulaw (pcmu) directly from Twilio

class GPTRealtimeHandler {
  private apiKey: string;
  private mode: string;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private sessionId: string | null = null;
  private onTranscript: (data: { role: string; text: string }) => void;
  private onResponse: (data: { type: string; text: string }) => void;
  private onAudio: (data: string) => void;
  private onError: (error: any) => void;

  constructor(options: {
    apiKey?: string;
    mode?: string;
    onTranscript?: (data: { role: string; text: string }) => void;
    onResponse?: (data: { type: string; text: string }) => void;
    onAudio?: (data: string) => void;
    onError?: (error: any) => void;
  }) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || "";
    this.mode = options.mode || "universal";
    this.onTranscript = options.onTranscript || (() => {});
    this.onResponse = options.onResponse || (() => {});
    this.onAudio = options.onAudio || (() => {});
    this.onError = options.onError || (() => {});
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";

      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });

      this.ws.on("open", () => {
        log("Connected to OpenAI Realtime API", "openai");
        this.isConnected = true;
        this.initSession();
        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        this.handleMessage(JSON.parse(data.toString()));
      });

      this.ws.on("error", (err: Error) => {
        log(`OpenAI WebSocket error: ${err.message}`, "openai");
        this.onError(err);
        reject(err);
      });

      this.ws.on("close", () => {
        log("OpenAI WebSocket closed", "openai");
        this.isConnected = false;
      });
    });
  }

  private initSession() {
    // FROZEN: Always use base prompt (TALKHINT_GOLDEN_PROMPT)
    // Custom prompts (activePromptId from phone_numbers) are NOT used for Basic plan
    // This is intentional - all users get the same base AI assistant behavior
    // LIVE_GROUNDING_RULES: the realtime path bypasses buildLiveSystemPrompt,
    // so the grounding layer (never invent user facts / real-world state,
    // state precedence) must be injected here explicitly too.
    const fullInstructions = `${TALKHINT_GOLDEN_PROMPT}\n\n${LIVE_GROUNDING_RULES}\n\n${GOAL_PRIORITY_RULES}\n\n${STRATEGY_MEMORY_RULES}\n\n${getRealtimePrompt(this.mode)}`;
    
    this.send({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: fullInstructions,
        voice: "alloy",
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.3,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
      },
    });
  }

  private send(message: object) {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private audioChunkCount = 0;
  private totalAudioSent = 0;
  
  sendAudio(base64Audio: string) {
    if (!this.isConnected || !this.ws) {
      return; // Not connected yet
    }
    
    // Send μ-law audio directly to OpenAI (native g711_ulaw support)
    this.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64Audio }));
    this.audioChunkCount++;
    this.totalAudioSent++;
    
    // Log first audio and periodically
    if (this.totalAudioSent === 1) {
      log(`First audio chunk sent to OpenAI (g711_ulaw, ${base64Audio.length} bytes)`, "openai");
    }
  }
  
  commitAudio() {
    // With server_vad, OpenAI automatically detects speech end
    // Manual commit not needed
    if (this.totalAudioSent > 0) {
      log(`Total audio chunks sent: ${this.totalAudioSent}`, "openai");
    }
  }

  private handleMessage(message: any) {
    // Log all OpenAI messages for debugging (including content for transcript events)
    if (message.type) {
      if (message.type.includes("transcript")) {
        log(`OpenAI event: ${message.type} - ${JSON.stringify(message).slice(0, 200)}`, "openai");
      } else if (!message.type.includes("audio.delta")) {
        log(`OpenAI event: ${message.type}`, "openai");
      }
    }
    
    switch (message.type) {
      case "session.created":
        this.sessionId = message.session?.id;
        log(`Session created: ${this.sessionId}`, "openai");
        break;
      case "session.updated":
        log(`Session updated successfully`, "openai");
        break;
      case "input_audio_buffer.speech_started":
        log(`Speech detected`, "openai");
        break;
      case "input_audio_buffer.speech_stopped":
        log(`Speech ended`, "openai");
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (message.transcript) {
          log(`Guest: ${message.transcript}`, "transcript");
          this.onTranscript({ role: "guest", text: message.transcript });
        }
        break;
      case "response.audio_transcript.delta":
        if (message.delta) {
          this.onResponse({ type: "transcript_delta", text: message.delta });
        }
        break;
      case "response.audio_transcript.done":
        if (message.transcript) {
          log(`Assistant: ${message.transcript}`, "transcript");
          this.onTranscript({ role: "assistant", text: message.transcript });
        }
        break;
      case "response.audio.delta":
        if (message.delta) {
          this.onAudio(message.delta);
        }
        break;
      case "conversation.item.input_audio_transcription.failed":
        log(`Transcription failed: ${JSON.stringify(message.error)}`, "openai");
        break;
      case "error":
        log(`OpenAI API Error: ${JSON.stringify(message.error)}`, "openai");
        this.onError(message.error);
        break;
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const parsedUrl = new URL(request.url || "", `http://${request.headers.host}`);
    const pathname = parsedUrl.pathname;

    if (!["/twilio-stream", "/media", "/translator-twilio-stream", "/translator-feed", "/honor-stream", "/ui", "/translator", "/translator-spike-stream"].includes(pathname)) {
      socket.destroy();
      return;
    }

    // Dev-only Translator Realtime Spike stand. Uses its own per-boot page
    // token (not a user session); hard-rejected in production.
    if (pathname === "/translator-spike-stream") {
      if (!isValidSpikeToken(parsedUrl.searchParams.get("token"))) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request, pathname);
      });
      return;
    }

    // Client-facing channels (the iOS in-call screen and the browser UI) carry
    // live call transcripts and AI hints, so they MUST authenticate as a user.
    // The Twilio media channels (/twilio-stream, /media) are machine-to-machine
    // from Twilio and are not user-authenticated here.
    const requiresAuth = pathname === "/ui" || pathname === "/honor-stream" || pathname === "/translator" || pathname === "/translator-feed";
    if (requiresAuth) {
      const token = parsedUrl.searchParams.get("token");
      if (!token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      getSessionUserId(token)
        .then((userId) => {
          if (!userId) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request, pathname, userId);
          });
        })
        .catch(() => {
          socket.destroy();
        });
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, pathname);
    });
  });

  wss.on("connection", (ws: WebSocket, request: any, pathname: string, userId?: string) => {
    if (pathname === "/ui") {
      handleUIConnection(ws, userId);
    } else if (pathname === "/honor-stream") {
      handleHonorStream(ws, userId);
    } else if (pathname === "/translator") {
      if (userId) handleIOSTranslatorStream(ws, userId);
    } else if (pathname === "/translator-feed") {
      // Read-only owner-scoped call telemetry; unlike /translator this never
      // starts a provider session and unlike /ui it cannot receive hints.
      if (userId) subscribeTranslatorFeed(userId, ws);
    } else if (pathname === "/translator-spike-stream") {
      handleTranslatorSpikeStream(ws);
    } else if (pathname === "/translator-twilio-stream") {
      // Deliberately separate from handleTwilioStream (Hint/Deepgram).
      handleTranslatorTwilioStream(ws);
    } else if (pathname === "/twilio-stream" || pathname === "/media") {
      log(`Twilio Media Stream connected via ${pathname}`, "twilio");
      handleTwilioStream(ws);
    }
  });

  // Per-user active call goal. Keyed by authenticated user id so one user's
  // goal can never ground another user's live-call hints (the old single
  // closure-scoped variable leaked goals across users/calls). Cleared when the
  // user's Twilio stream ends — a new call always starts without the old goal.
  const goalsByUser = new Map<string, string>();
  function getUserGoal(userId?: string): string {
    return (userId && goalsByUser.get(userId)) || "";
  }
  function setUserGoal(userId: string | undefined, goal: string) {
    if (!userId) return;
    if (goal) goalsByUser.set(userId, goal);
    else goalsByUser.delete(userId);
  }

  // Bridge from the /ui ask_ai handler into a user's ACTIVE Twilio call
  // closure. The per-call state (conversation log, current hint, contexts,
  // toggles) lives inside handleTwilioStream; a live call registers a bridge
  // here (keyed by owner user id) so Ask can refine the current hint with
  // real call context. Removed on stream close — no active call, no bridge.
  type LiveAskBridge = {
    snapshot: () => {
      conversationContext: string;
      currentHint: string;
      userContext: string;
      contactContext: string;
      staticCards: string;
      tutorMemory: string;
      translateEnabled: boolean;
      strategyMemory: string;
      modelOverride?: string;
    };
    pushHint: (en: string, translation: string) => void;
  };
  const liveAskBridges = new Map<string, LiveAskBridge>();

  /// Classifies a message the user typed into the live-call assistant input:
  /// is it a NEW/CHANGED goal for the call (an outcome the user wants), or a
  /// regular question/request for a phrase? Returns the concise new goal text
  /// when it is a goal update, otherwise null. Fail-safe: any error or timeout
  /// means "not a goal update" so the normal ask-AI path always still works.
  async function detectGoalUpdate(question: string, existingGoal: string): Promise<string | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || !question.trim()) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You classify a message the user typed to their live phone-call assistant.
Current call goal: ${existingGoal ? `"${existingGoal}"` : "(none)"}
Decide: is the user declaring a NEW or CHANGED goal for this call (an outcome they now want from the call, e.g. "Теперь хочу попросить вернуть эти $350"), or is it a regular question / request for a phrase / clarification?
Reply ONLY with JSON: {"goal_update": true|false, "goal": "<the new goal, concise, in the user's own language, empty string if not a goal update>"}`,
            },
            { role: "user", content: question },
          ],
          response_format: { type: "json_object" },
          max_tokens: 120,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await response.json() as any;
      const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
      if (parsed.goal_update === true && typeof parsed.goal === "string" && parsed.goal.trim()) {
        return parsed.goal.trim();
      }
      return null;
    } catch {
      return null;
    }
  }

  async function handleAIQuestion(ws: WebSocket, question: string, goal: string) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      ws.send(JSON.stringify({ type: "ai_response", text: "API ключ не настроен", error: true }));
      return;
    }

    try {
      const langName = LANGUAGE_NAMES[currentLanguage] || "Russian";
      const goalLockInstructions = goal ? `
GOAL FOCUS: The user has set a clear goal: "${goal}"
- Prefer phrases and help that move toward this goal
- BUT the GOAL PRIORITY RULES above rank higher: the user's latest explicit intent and the current topic always come first — if the user deliberately shifted to another topic, help with THAT topic
- If user asks for a phrase, give ONE clear phrase that advances the current topic (or the goal, when it is the current topic)` : '';
      
      const systemPrompt = `${TALKHINT_GOLDEN_PROMPT}

${LIVE_GROUNDING_RULES}

${GOAL_PRIORITY_RULES}

${STRATEGY_MEMORY_RULES}

The user's goal for this call: ${goal || "Not specified"}
The user's native language: ${langName}
${goalLockInstructions}

The user is asking you a question during an active phone call.
Respond with a SHORT, helpful answer.
If they need a phrase to say, give them the English phrase AND its translation to ${langName}.
NEVER output JSON - only plain text with the phrase and translation.`;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: question }
          ],
          max_tokens: 200
        })
      });

      const data = await response.json() as any;
      let text = data.choices?.[0]?.message?.content || "Не удалось получить ответ";
      
      // Filter out JSON from response - never show raw JSON to user
      text = filterJsonFromText(text);
      
      ws.send(JSON.stringify({ type: "ai_response", text }));
      log(`AI response sent: ${text.substring(0, 50)}...`, "server");
    } catch (err: any) {
      log(`AI question error: ${err.message}`, "server");
      ws.send(JSON.stringify({ type: "ai_response", text: "Ошибка при обработке вопроса", error: true }));
    }
  }
  
  function handleUIConnection(ws: WebSocket, userId?: string) {
    log(`UI client connected (user ${userId})`, "server");
    uiClients.add(ws);
    if (userId) uiClientUsers.set(ws, userId);

    ws.send(JSON.stringify({ type: "connected", timestamp: Date.now(), goal: getUserGoal(userId), model: currentModel }));

    ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "set_mode") {
          currentMode = message.mode;
          log(`Mode changed to: ${currentMode}`, "server");
          ws.send(JSON.stringify({ type: "mode_changed", mode: currentMode }));
        } else if (message.type === "update_goal" || message.type === "set_goal") {
          const newGoal = message.goal || "";
          setUserGoal(userId, newGoal);
          log(`Goal set (user ${userId}): ${newGoal.substring(0, 50)}...`, "server");
          // Broadcast to ALL of this user's sockets (web + iOS may mirror the
          // same call) so every feed renders the same compact goal event.
          if (userId) sendToUser(userId, { type: "goal_set", goal: newGoal });
          else ws.send(JSON.stringify({ type: "goal_set", goal: newGoal }));
        } else if (message.type === "set_language") {
          const lang = message.language;
          if (lang === "ru" || lang === "es") {
            currentLanguage = lang;
            log(`Language changed to: ${currentLanguage}`, "server");
            ws.send(JSON.stringify({ type: "language_changed", language: currentLanguage }));
          }
        } else if (message.type === "set_model") {
          const model = message.model;
          if (ALLOWED_HINT_MODELS.includes(model)) {
            currentModel = model;
            log(`Hint model changed to: ${currentModel}`, "server");
            ws.send(JSON.stringify({ type: "model_changed", model: currentModel }));
          } else {
            log(`Rejected unknown hint model: ${model}`, "server");
            ws.send(JSON.stringify({ type: "model_changed", model: currentModel }));
          }
        } else if (message.type === "prepare_message") {
          // PREPARE stage (pre-call): one Sol conversation per user. Honest
          // errors, never a silent model substitution (provider policy v1).
          const text = String(message.text || "").trim();
          if (!text) return;
          if (!userId) {
            ws.send(JSON.stringify({ type: "prepare_error", text: "Войдите в аккаунт, чтобы готовить звонок." }));
            return;
          }
          // Optional idempotency key (Task #197): a client resending the same
          // message after a reconnect passes the same clientMessageId; the
          // server returns the original reply instead of a duplicate turn.
          const clientMessageId = typeof message.clientMessageId === "string"
            ? message.clientMessageId.trim().slice(0, 64) : "";
          (async () => {
            try {
              const { reply, proposedGoal } = await prepareMessage(userId, text, clientMessageId || undefined);
              ws.send(JSON.stringify({ type: "prepare_reply", text: reply, proposedGoal, ...(clientMessageId ? { clientMessageId } : {}) }));
            } catch (err: any) {
              const msg = err instanceof PrepareUnavailableError ? err.message : "Ошибка подготовки. Попробуйте ещё раз.";
              log(`prepare_message error: ${err?.message}`, "server");
              ws.send(JSON.stringify({ type: "prepare_error", text: msg, ...(clientMessageId ? { clientMessageId } : {}) }));
            }
          })();
        } else if (message.type === "prepare_confirm_goal") {
          if (!userId) return;
          // Idempotent lost-ack handling lives in handlePrepareConfirmGoal
          // (unit-tested): duplicates replay goal_set + the original opening.
          void handlePrepareConfirmGoal(userId, message.goal, message.clientMessageId, {
            sendFrame: (obj) => ws.send(JSON.stringify(obj)),
            activateGoal: (goal) => {
              // Confirmation activates the goal via the EXISTING goal mechanism —
              // same compact feed event, same Brain visibility during the call.
              setUserGoal(userId, goal);
              log(`Goal confirmed via PREPARE (user ${userId}): ${goal.substring(0, 50)}...`, "server");
              sendToUser(userId, { type: "goal_set", goal });
            },
            log: (msg) => log(msg, "server"),
          });
        } else if (message.type === "suggestion_ack") {
          // Device confirmed rendering a suggestion — final stage of the
          // speech→hint latency chain. Silent no-op when stale/unowned.
          recordSuggestionAck(userId, message.callSid, message.utteranceId);
        } else if (message.type === "prepare_reset") {
          clearPrepareState(userId);
          clearOpeningDedup(userId);
        } else if (message.type === "ask_ai") {
          const question = message.question || "";
          const goal = message.goal || getUserGoal(userId);
          log(`AI question: ${question.substring(0, 50)}...`, "server");
          // The assistant input doubles as a mid-call goal editor: if the user's
          // message declares a new/changed goal, adopt it as the active goal
          // (Brain uses it from now on) and tell the client so it can render a
          // compact "Goal updated" event in the conversation feed. The regular
          // AI answer still follows, grounded in the updated goal.
          (async () => {
            const goalSnapshot = getUserGoal(userId);
            // Goal detection runs in PARALLEL with the hint work below (it used
            // to be awaited first, adding up to 4s before any answer). A detected
            // goal update still lands via CAS and grounds all FUTURE hints.
            const goalPromise = detectGoalUpdate(question, goal).then((updatedGoal) => {
              // Compare-and-set: if the user explicitly set/changed the goal while
              // classification was in flight, the newer explicit value wins — a
              // late classifier result must never overwrite it.
              if (updatedGoal && getUserGoal(userId) === goalSnapshot) {
                setUserGoal(userId, updatedGoal);
                log(`Goal updated via assistant input (user ${userId}): ${updatedGoal.substring(0, 50)}...`, "server");
                if (userId) sendToUser(userId, { type: "goal_updated", goal: updatedGoal });
                else ws.send(JSON.stringify({ type: "goal_updated", goal: updatedGoal }));
                return updatedGoal;
              }
              return null;
            }).catch(() => null);

            // ACTIVE CALL: Ask is NOT a chat — the text is an instruction to the
            // live hint Brain. Refine the current hint with full call context and
            // deliver it as a normal `suggestion` frame (the Hint banner), never
            // as an ai_response feed card.
            const bridge = userId ? liveAskBridges.get(userId) : undefined;
            if (bridge) {
              const t0 = Date.now();
              const snap = bridge.snapshot();
              const refined = await refineHintFromAsk(question, {
                goal,
                language: currentLanguage,
                ...snap,
              });
              if (refined) {
                // Revalidate AFTER the model await: if this call ended or a
                // newer call replaced the bridge while the refine was in
                // flight, the stale hint must never reach the (new) screen.
                if (liveAskBridges.get(userId!) === bridge) {
                  bridge.pushHint(refined.en, refined.translation);
                  log(`[AskRefine] hint refined in ${Date.now() - t0}ms: "${refined.en.substring(0, 60)}"`, "server");
                } else {
                  log(`[AskRefine] call ended/replaced during refine (${Date.now() - t0}ms) — dropping stale hint`, "server");
                }
                return;
              }
              // Refine failed (model error/unparseable): report it VISIBLY as
              // an error card — never silence, and never a normal chat answer
              // during an active call (Ask is a hint instruction, not a chat).
              log(`[AskRefine] no refined hint after ${Date.now() - t0}ms — reporting error to client`, "server");
              ws.send(JSON.stringify({ type: "ai_response", text: "Не удалось обновить подсказку. Попробуйте ещё раз.", error: true }));
              return;
            }
            const updatedGoal = await goalPromise;
            await handleAIQuestion(ws, question, updatedGoal || goal);
          })().catch((err) => log(`ask_ai handling error: ${err?.message}`, "server"));
        }
      } catch (err) {}
    });

    ws.on("close", () => {
      log("UI client disconnected", "server");
      uiClients.delete(ws);
      uiClientUsers.delete(ws);
    });
  }

  function handleHonorStream(ws: WebSocket, userId?: string) {
    log("Browser mic connected", "honor");
    let gptHandler: GPTRealtimeHandler | null = null;
    let sessionId: string | null = null;
    // Route this honor session's transcripts/responses only to its owner.
    const uiBroadcast = (message: object) => sendToUser(userId, message);

    ws.on("message", async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case "start":
            sessionId = message.sessionId || Date.now().toString(36);
            log(`Honor session started: ${sessionId}`, "honor");

            gptHandler = new GPTRealtimeHandler({
              mode: currentMode,
              onTranscript: (transcript) => {
                ws.send(JSON.stringify({ type: "transcript", sessionId, ...transcript }));
                uiBroadcast({ type: "hon_transcript", sessionId, ...transcript });
              },
              onResponse: (response) => {
                const { type: respType, ...rest } = response;
                ws.send(JSON.stringify({ type: "response", sessionId, responseType: respType, ...rest }));
                uiBroadcast({ type: "hon_response", sessionId, responseType: respType, ...rest });
              },
              onAudio: (audio) => {
                ws.send(JSON.stringify({ type: "audio", audio }));
              },
              onError: (error) => {
                ws.send(JSON.stringify({ type: "error", error: error.message || error }));
              },
            });

            await gptHandler.connect();
            ws.send(JSON.stringify({ type: "ready", sessionId }));
            break;

          case "audio":
            if (gptHandler && message.audio) {
              gptHandler.sendAudio(message.audio);
            }
            break;

          case "stop":
            log(`Honor session ended: ${sessionId}`, "honor");
            if (gptHandler) {
              gptHandler.commitAudio(); // Flush remaining audio
              gptHandler.disconnect();
            }
            ws.send(JSON.stringify({ type: "stopped", sessionId }));
            break;
        }
      } catch (err: any) {
        log(`Honor error: ${err.message}`, "honor");
      }
    });

    ws.on("close", () => {
      if (gptHandler) gptHandler.disconnect();
    });
  }

  function handleTwilioStream(ws: WebSocket) {
    const startTime = new Date().toISOString();
    log(`[TwilioStream] Connected at ${startTime}`, "twilio");
    let streamSid: string | null = null;
    let callSid: string | null = null;
    let streamUserId: string | undefined; // Owner of this call (set on "start" from callOwners)
    let ownerContext = ""; // Owner's "My Context" free-text, loaded once on "start"
    let ownerContextReady: Promise<void> = Promise.resolve(); // resolves once ownerContext is loaded
    let contactContext = ""; // CONTACT_CONTEXT for the other party, loaded once on "start"
    let otherPartyPhone = ""; // The other party's phone (caller for inbound, dialed for outbound)
    let contactContextReady: Promise<void> = Promise.resolve(); // resolves once contactContext is loaded
    let staticCards = ""; // STATIC_CARDS (owner's project/company knowledge cards), loaded once on "start"
    let staticCardsReady: Promise<void> = Promise.resolve(); // resolves once staticCards is loaded
    // Per-user live-call feature toggles (Live Hints + Translation), loaded once on "start".
    // Defaults ON so a load failure never silently disables hints for a paying user.
    let callSettings = { liveHintsEnabled: true, translationEnabled: true };
    // Candidate Pipeline v1 (Task #207): per-user experimental live pipeline.
    // Disabled by default; loaded on "start" alongside callSettings. When
    // enabled it may swap the STT (OpenAI realtime instead of Flux) and/or the
    // Brain model for THIS call only — the global production config is untouched.
    let candidatePipeline: CandidatePipelineConfig = { ...DISABLED_PIPELINE };
    // Effective per-call Brain model override (null = production model).
    let brainModelOverride: string | undefined = undefined;
    // Candidate STT swap outcome for HONEST labeling: "swapped" = candidate STT
    // actually carried the call; "failed" = swap failed, Flux kept the call and
    // the run must NOT be scored as a candidate STT run. Also guards against
    // Flux auto-reconnect resurrecting itself after a successful swap.
    let sttSwapState: "none" | "swapped" | "failed" = "none";
    let sttSwapDelayMs: number | null = null;
    let streamStartAtMs = 0;
    // Set on "stop"/ws close. The candidate STT setup is async (config load +
    // client-secret mint + handshake); if the stream closes first, the swap
    // must abort and finish any sockets it created — otherwise short/rejected
    // calls leak orphaned realtime sessions and mutate state after teardown.
    let streamClosed = false;
    // Hint latency stages for this call (recorded for every call, flushed to
    // calls.metadata on close so candidate vs baseline can be compared).
    const latencyRecorder = new LiveLatencyRecorder();
    let callSettingsReady: Promise<void> = Promise.resolve(); // resolves once callSettings is loaded
    // Auto-built dialogue libraries for the owner — one per GOAL (each row is a
    // distinct goal, with its own goalText + goalType). Consulted FIRST on each
    // guest turn: the active goal picks the library, then the utterance is matched
    // within it. A hit serves a ready-made line (no LLM call); a miss falls
    // through to the existing translateAndSuggest hint path.
    let dialogueLibraries: DialogueLibrary[] = [];
    let dialogueLibrariesReady: Promise<void> = Promise.resolve(); // resolves once libraries are loaded
    // TUTOR_MEMORY: user-CONFIRMED Call Memory from a tutor practice session,
    // atomically CLAIMED (REAL_CALL_READY → COMPLETED in one conditional
    // update) on "start" so concurrent calls can never share one memory and a
    // crash can never make it reusable. Best-effort: failures leave it empty.
    let tutorMemoryBlock = "";
    let tutorMemoryReady: Promise<void> = Promise.resolve();
    let audioFrameCount = 0;
    let isPstnForwarding = false; // PSTN forwarding mode - roles are inverted
    // True when the media stream rides the CALLER's leg (incoming answered call /
    // iOS conference bridge). On that leg inbound = caller (GUEST) and outbound =
    // bridged agent (OWNER) — i.e. mirror of a browser outbound call.
    let streamOnCallerLeg = false;
    // Route this call's transcripts/suggestions only to the owning user's UI clients.
    const uiBroadcast = (message: object) => sendToUser(streamUserId, message);
    let goalEngine: GoalEngine | null = null; // Goal State Engine per call
    let deepgramReady = false; // Flag to track if Deepgram is ready
    const audioBuffer: { track: string; data: Buffer }[] = []; // Buffer for early audio
    
    // Hint throttling - prevents spam of suggestions
    let lastHintTs = 0;                    // Timestamp of last hint shown
    let lastHintUtteranceId = -1;          // Utterance ID of last hint
    let latestGuestUtteranceId = -1;       // Newest Guest turn seen (freshness/stale guard)
    let goalAchievedFlag = false;          // context/UI/analytics only — goal status NEVER gates hint delivery (no stop, no forced closing phrase)
    // Most-recent call goal — captured for the metadata flush at call end.
    // goalText mirrors goalsByUser[streamUserId] (updated whenever goal text
    // changes); goalType mirrors the GoalEngine's last reported goalType.
    let callGoalText = "";
    let callGoalType: GoalType = "other";
    const HINT_COOLDOWN_MS = 1500;         // Block second hint for 1.5 sec
    
    // Anti-loop guards - prevents cycling on same emotions/suggestions
    let lastSuggestionIntent = "";         // Last intent type (enthusiasm/ask_date/etc)
    let lastSuggestionText = "";           // Last suggestion text for duplicate check
    const recentSuggestions: string[] = []; // Last few suggestions for duplicate window
    // Duplicate/self-overlap decision logic (incl. the bounded "guest re-asked
    // a question" exemption) lives in SuggestionDedupGuard (server/hintDedup.ts)
    // so it's a pure, testable unit — see server/__tests__/hintDedup.test.ts.
    const dedupGuard = new SuggestionDedupGuard();
    const RECENT_SUGGESTIONS_MAX = 4;      // How many past suggestions to compare against

    // Dropped-question carryover: when a guest question's hint is lost (stale
    // supersede, cooldown, or model returned no suggestion), remember it so the
    // NEXT guest turn's hint folds the question in instead of losing it forever.
    // Robot callers speak in 3-5s bursts, which used to silently swallow questions.
    const hintCarryover = new HintCarryover();

    // Monotonic counter for ask-refined hints (negative utteranceId namespace).
    let askHintSeq = 0;

    // v2.2 Strategy Memory (Task #236): bounded per-call tracker of the last
    // few hint cycles (suggestion -> actual Owner speech -> Guest reaction).
    // Deterministic string work only — no LLM, no DB, no extra latency. Its
    // render() feeds the RECENT STRATEGY MEMORY block of the live prompt.
    const strategyMemory = new StrategyMemoryTracker();

    // Ask-refine bridge for THIS call (see liveAskBridges): exposes a context
    // snapshot for the ask_ai handler and a push that delivers the refined
    // hint through the normal `suggestion` frame — same banner in the client,
    // and the anti-loop / strategy-memory bookkeeping stays consistent so the
    // next automatic hint knows what the user last saw.
    const askBridge: LiveAskBridge = {
      snapshot: () => ({
        conversationContext: conversationLog.map((m) => `${m.speaker}: ${m.text}`).join("\n"),
        currentHint: lastSuggestionText,
        userContext: ownerContext,
        contactContext,
        staticCards,
        tutorMemory: tutorMemoryBlock,
        translateEnabled: callSettings.translationEnabled,
        strategyMemory: strategyMemory.render(),
        modelOverride: brainModelOverride,
      }),
      pushHint: (en: string, translation: string) => {
        // Distinct negative id namespace: ask-refined hints are NOT part of the
        // speech→hint latency chain, so their device ACKs must never attach to
        // (or overwrite) a real guest utterance's latencyRecorder entry — the
        // recorder has no entry for this id, so the ACK is a silent no-op.
        askHintSeq += 1;
        uiBroadcast({
          type: "suggestion",
          target: "HON",
          eventType: "suggestion",
          source: "ask",
          basedOnSpeaker: "HON",
          en,
          translation,
          utteranceId: -(1000 + askHintSeq),
          callSid,
        });
        lastSuggestionText = en;
        recentSuggestions.push(en);
        if (recentSuggestions.length > RECENT_SUGGESTIONS_MAX) recentSuggestions.shift();
        strategyMemory.recordSuggestion(en);
        // The refined hint is now the newest thing on the user's screen: mark
        // the current guest turn as already hinted (an in-flight automatic
        // hint for the same turn must not immediately overwrite the phrase the
        // user explicitly asked for) and arm the normal cooldown.
        lastHintUtteranceId = Math.max(lastHintUtteranceId, latestGuestUtteranceId);
        lastHintTs = Date.now();
      },
    };
    const registerAskBridge = () => {
      if (streamUserId) liveAskBridges.set(streamUserId, askBridge);
    };

    // Self-overlap guard - don't suggest something the owner (HON) already said.
    // The suggestion is what HON should say next; if HON already voiced essentially
    // the same thing recently, repeating it as a hint is pure noise.
    const recentOwnerUtterances: string[] = []; // Last few HON turns for self-overlap check
    // Full owner-turn history WITH timestamps — feeds hint-usage matching at
    // call finalization (which delivered hints did the owner actually speak).
    const ownerTurnsTimed: { text: string; ts: number }[] = [];
    const RECENT_OWNER_MAX = 3;            // How many past HON turns to compare against

    // Anti-echo (cross-track) - same speech transcribed on BOTH tracks (mic/speaker bleed)
    const recentUtterances: { speaker: "GST" | "HON"; norm: string; ts: number }[] = [];
    const ECHO_WINDOW_MS = 1200;           // Window to treat opposite-track repeat as echo (acoustic bleed is near-instant)
    const ECHO_SIMILARITY = 0.85;          // Similarity threshold to call it an echo (high, to spare legit turn-taking)
    
    // Wait State - when GST says "let me check", block STEER until new content
    let waitingForInfo = false;            // True when GST is checking/looking
    let waitAckShown = false;              // True after showing 1 ACK ("Sure, I'll wait")
    let waitingSlot: string | null = null; // Which slot we're waiting for
    
    // Wait-state enter/exit patterns are shared with TRAINING mode —
    // see WAIT_PATTERNS / EXIT_WAIT_PATTERNS in server/waitState.ts.
    
    // Reaction-only phrases to filter (short emotional reactions with no info)
    const REACTION_ONLY_PATTERNS = [
      /^(that'?s?\s+)?(good|great|amazing|awesome|perfect|wonderful|fantastic|excellent|nice|cool|fine)\.?$/i,
      /^(oh\s+)?(my\s+)?(god|gosh|wow|man|boy)\.?$/i,
      /^(ok(ay)?|right|sure|alright|got\s+it|i\s+see|uh[\s-]?huh)\.?$/i,
      /^(yeah|yep|yup|nope|nah)\.?$/i,
      /^hmm+\.?$/i,
      /^(let'?s?\s+go|let'?s?\s+do\s+(it|this|that))\.?$/i,
      /^i understand(\.)?$/i,
      /^i understand you(\.)?$/i,
      /^understood(\.)?$/i,
    ];
    
    // Farewell / closing phrases - conversation is wrapping up, no steer needed
    // (translation still shown). Detection lives in server/farewellFilter.ts so
    // it is unit-testable; "thanks"-prefixed working lines are NOT farewells.

    // Keywords that indicate meaningful content (don't block)
    const MEANINGFUL_KEYWORDS = /\b(yes|no|when|where|what|how|price|cost|time|date|day|week|month|hour|minute|dollar|euro|available|book|schedule|appointment|cancel|change|confirm|sure|alright|definitely|absolutely|of course|please|thank|sounds good|deal|agreed|perfect|let me|i need|i want|i would|i will|can i|could you)\b/i;
    
    // Intent patterns for repeat detection
    const INTENT_PATTERNS: { pattern: RegExp; intent: string }[] = [
      { pattern: /can'?t wait|excited|amazing|wonderful|great|let'?s go|sounds good/i, intent: "enthusiasm" },
      { pattern: /when|what (day|date|time)/i, intent: "ask_date" },
      { pattern: /what time|which hour/i, intent: "ask_time" },
      { pattern: /how long|duration/i, intent: "ask_duration" },
      { pattern: /where|location|address/i, intent: "ask_location" },
      { pattern: /price|cost|budget|how much/i, intent: "ask_price" },
      { pattern: /confirm|all set|done|complete/i, intent: "closing" }
    ];
    
    function detectIntent(text: string): string {
      for (const { pattern, intent } of INTENT_PATTERNS) {
        if (pattern.test(text)) return intent;
      }
      return "general";
    }
    
    function isReactionOnly(text: string): boolean {
      const trimmed = text.trim();
      const wordCount = trimmed.split(/\s+/).length;
      
      // If has meaningful keywords, not reaction-only
      if (MEANINGFUL_KEYWORDS.test(trimmed)) return false;
      
      // If more than 5 words, likely has content
      if (wordCount > 5) return false;
      
      // Check against reaction patterns
      for (const pattern of REACTION_ONLY_PATTERNS) {
        if (pattern.test(trimmed)) return true;
      }
      
      // Short phrase without info (< 4 words, no keywords)
      if (wordCount <= 3 && !MEANINGFUL_KEYWORDS.test(trimmed)) {
        return true;
      }
      
      return false;
    }
    
    // Library-first matching + goal selection live in ./dialogueMatch (pure,
    // unit-tested). Bind the per-connection library list so the call sites below
    // keep their original signatures.
    const matchDialogueLibrary = (text: string, goalText: string, goalType: string) =>
      matchDialogueLibraryPure(dialogueLibraries, text, goalText, goalType);
    
    // Twilio WS keepalive ping every 15 seconds to prevent proxy/edge idle disconnect
    const twilioKeepaliveInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        // Twilio expects JSON messages, send a heartbeat
        ws.ping();
        log(`[Twilio] keepalive ping sent`, "twilio");
      }
    }, 15000);
    
    // Conversation history for context
    const conversationLog: { speaker: string; text: string; timestamp: number }[] = [];
    // Full transcript for this call (unbounded by the conversationLog window) —
    // used to summarize the call into contact memory on teardown.
    const fullConversation: { speaker: string; text: string }[] = [];

    // Durably persist the running transcript onto the call record so it survives a
    // crash before this socket's close handler runs. The /twilio/status backstop
    // reads it back to recover the AirAtoma delivery. Throttled (one write per
    // window, trailing flush) so a chatty call doesn't hammer the DB; the close
    // handler does a final synchronous-ish flush. Fire-and-forget — never blocks.
    let transcriptPersistTimer: ReturnType<typeof setTimeout> | null = null;
    let transcriptDirty = false;
    let lastTranscriptPersistTs = 0;
    const TRANSCRIPT_PERSIST_MS = 2000;
    function flushTranscript() {
      if (!callSid || !transcriptDirty) return;
      transcriptDirty = false;
      lastTranscriptPersistTs = Date.now();
      const text = renderTranscriptText(fullConversation);
      if (!text) return;
      void storage
        .updateCallTranscriptByCallSid(callSid, text)
        .catch((err) => log(`[Transcript] persist failed: ${err}`, "websocket"));
    }
    function persistTranscriptSoon() {
      transcriptDirty = true;
      // Leading edge: persist the very first turn (and any turn after a quiet
      // window) immediately, so a crash right after the first words still leaves a
      // recoverable transcript. Bursts within the window coalesce into one trailing
      // write so a chatty call doesn't hammer the DB.
      if (!transcriptPersistTimer && Date.now() - lastTranscriptPersistTs >= TRANSCRIPT_PERSIST_MS) {
        flushTranscript();
        return;
      }
      if (transcriptPersistTimer) return;
      transcriptPersistTimer = setTimeout(() => {
        transcriptPersistTimer = null;
        flushTranscript();
      }, TRANSCRIPT_PERSIST_MS);
    }
    
    // Utterance Gate - wait for end of speech before generating hints
    const utteranceGate = new UtteranceGate(async (speaker, text, utteranceId, confidence) => {
      // ===== ANTI-ECHO: drop the same speech echoed onto the opposite track =====
      // On speakerphone the mic captures the remote audio (and vice versa), so the
      // same words get transcribed on BOTH Deepgram tracks. Keep the first, drop the echo.
      const norm = normalizeText(text);
      const nowTs = Date.now();
      // prune old entries
      while (recentUtterances.length && nowTs - recentUtterances[0].ts > ECHO_WINDOW_MS) {
        recentUtterances.shift();
      }
      if (norm) {
        const echo = recentUtterances.find(
          (u) => u.speaker !== speaker && textSimilarity(norm, u.norm) >= ECHO_SIMILARITY
        );
        if (echo) {
          log(`[BLOCKED] reason=echo speaker=${speaker} text="${text.substring(0, 30)}" - mirrored on ${echo.speaker} track`, "websocket");
          return;
        }
        recentUtterances.push({ speaker, norm, ts: nowTs });
      }

      if (speaker === "GST") {
        await handleGuestUtteranceComplete(text, utteranceId, confidence);
      } else {
        handleOwnerUtteranceComplete(text, utteranceId, confidence);
      }
    });
    
    // Handler for complete GST utterance (after debounce)
    async function handleGuestUtteranceComplete(text: string, utteranceId: number, confidence?: number) {
      // EAGER supersede capture (synchronous, before any await): if the previous
      // guest turn is still generating its hint, it is being superseded right
      // now and its suggestion will be dropped as stale. Capture its question
      // immediately so THIS turn folds it in — waiting for the old request to
      // resolve would let this turn consume an empty carryover first (race).
      const { turn: guestTurn, capturedFromUtteranceId } = hintCarryover.beginTurn(text, utteranceId);
      if (capturedFromUtteranceId !== undefined) {
        log(`[Carryover] remembered question from superseded utteranceId=${capturedFromUtteranceId} (hint still generating) for utteranceId=${utteranceId}`, "websocket");
      }
      try {
        await runGuestUtterance(text, utteranceId, guestTurn, confidence);
      } finally {
        // Mark the turn finished (hint delivered OR deliberately blocked) so a
        // later turn does not re-capture it as "superseded".
        hintCarryover.finishTurn(guestTurn);
      }
    }

    async function runGuestUtterance(
      text: string,
      utteranceId: number,
      guestTurn: import("./hintCarryover").GuestTurn,
      confidence?: number
    ) {
      log(`[UtteranceComplete] GST utterance #${utteranceId}: "${text.substring(0, 50)}..."`, "websocket");
      
      const now = Date.now();
      // Latency SLA: handler entry ≈ STT end-of-turn commit (commitTurn fires
      // synchronously). Every guest turn opens a latency entry; it flips to
      // "sent" only if a suggestion actually reaches the /ui websocket.
      latencyRecorder.start(utteranceId, now);
      // Freshness guard: record this as the newest Guest turn BEFORE any await, so a
      // suggestion generated for an older turn can be dropped once a newer turn arrives.
      latestGuestUtteranceId = utteranceId;
      
      // ALWAYS add to conversation log (even if hints are blocked)
      conversationLog.push({
        speaker: "Guest",
        text: text,
        timestamp: now
      });
      if (conversationLog.length > 10) conversationLog.shift();
      fullConversation.push({ speaker: "Guest", text });
      // Strategy Memory: this Guest turn is the REACTION that closes the
      // previous hint cycle (before this turn's own Terra call is built).
      strategyMemory.recordGuestTurn(text);
      persistTranscriptSoon();
      
      // ALWAYS update GoalEngine (even if hints are blocked)
      // The goal type the engine currently believes we're in — picks which
      // dialogue library (if any) to consult for this turn.
      let detectedGoalType: GoalType = "other";
      if (goalEngine) {
        const goalUpdate = goalEngine.updateOnUtterance({
          speaker: "GST",
          text: text,
          ts: now
        });
        
        const state = goalUpdate.state;
        detectedGoalType = state.goalType;
        callGoalType = state.goalType;
        callGoalText = getUserGoal(streamUserId) || callGoalText;
        const missingSlot = state.missingSlots[0] || "none";
        fastLayer.setGoal(state.goalType, missingSlot);
        
        // A new goal replaced the old one — the "original goal resolved"
        // context note no longer applies to the NEW active goal.
        if (goalUpdate.goalChanged) goalAchievedFlag = false;
        
        uiBroadcast({
          type: "goal_state_update",
          target: "HON",
          callId: state.callId,
          goalType: state.goalType,
          currentGoal: state.currentGoal,
          confidence: state.confidence,
          status: state.status,
          slots: state.slots,
          missingSlots: state.missingSlots,
          nextBestAction: state.nextBestAction
        });
        
        if (goalUpdate.goalAchieved) {
          goalAchievedFlag = true; // context/UI/analytics only — NEVER gates hint delivery
          log(`[GoalAchieved] goal marked achieved (informational) — hints continue while the call goes on`, "goal");
          uiBroadcast({
            type: "goal_achieved",
            target: "HON",
            callId: state.callId,
            goalType: state.goalType,
            summary: state.currentGoal,
            achievedReason: state.achievedReason
          });
        }
        
        log(`[GoalEngine] GST update: goal=${state.goalType}, status=${state.status}, missing=${state.missingSlots.join(",")}`, "goal");
      }
      
      // ===== WAIT STATE DETECTION =====
      // Enter/exit/question-lift transitions all live in the shared
      // resolveWaitState helper (server/waitState.ts) — the single source of
      // truth shared with TRAINING mode so the two can never drift apart.
      // (Prod call 08.08: "Just to confirm, you're trying to activate your
      // eSIM…" / "Are you using an iPhone…" were blocked with reason=wait_state;
      // the question check runs LAST so "let me check — are you on an iPhone?"
      // still gets a hint. Pure hold phrases don't match — see waitState.ts.)
      {
        const { waiting: nowWaiting, event: waitEvent } = resolveWaitState(waitingForInfo, text);
        waitingForInfo = nowWaiting;
        // Live-only side effects: the exit-events → reset mapping lives in
        // shouldResetWaitTracking (server/waitState.ts) so it's unit-tested —
        // waitAckShown/waitingSlot reset ONLY on exit, never on enter/still.
        if (shouldResetWaitTracking(waitEvent)) {
          waitAckShown = false; // Reset ACK for next wait
          waitingSlot = null;
        }
        if (waitEvent === "entered" || waitEvent === "still_waiting") {
          log(`[WAIT_STATE] Entered - GST says "${text.substring(0, 40)}"`, "websocket");
        } else if (waitEvent === "exited_answer") {
          log(`[WAIT_STATE] Exited - GST answered "${text.substring(0, 40)}"`, "websocket");
        } else if (waitEvent === "exited_question") {
          log(`[WAIT_STATE] Exited - GST asked a question/request "${text.substring(0, 40)}"`, "websocket");
        }
      }
      
      // ===== ANTI-LOOP GUARD: Reaction-only filter =====
      // For reaction-only phrases: still get translation, but skip suggestion
      const reactionOnly = isReactionOnly(text);
      if (reactionOnly) {
        log(`[REACTION_ONLY] text="${text.substring(0, 30)}" - will translate but skip suggestion`, "websocket");
      }
      // Farewell / closing phrases: conversation is wrapping up, no steer needed.
      // Guard against false positives like "Thanks, what time works best?" - if the
      // utterance asks a question or has an actionable scheduling keyword, it's NOT a farewell.
      const isFarewell = isFarewellUtterance(text);
      if (isFarewell) {
        log(`[FAREWELL] text="${text.substring(0, 30)}" - will translate but skip suggestion`, "websocket");
      }
      
      // ALWAYS get translation for guest transcript
      fastLayer.setLanguage(currentLanguage);
      // fastLayer.onGstUtteranceEnd(); // Fast Layer disabled — silence while GPT thinks is better than an irrelevant filler
      
      // Goal status is context only: when the original goal appears resolved,
      // the model just gets a neutral note — it must keep assisting the CURRENT
      // conversation normally, with no delivery or steering change.
      const contextHistory =
        conversationLog.map(m => `${m.speaker}: ${m.text}`).join("\n") +
        (goalAchievedFlag
          ? "\n[NOTE: The original call goal appears resolved. Continue assisting with the current conversation normally — build suggestions from the latest utterances and current topic.]"
          : "");
      // Ensure the owner's "My Context" has finished loading so EVERY hint —
      // including the first turn — is personalized (load is kicked off on "start").
      await ownerContextReady;
      await contactContextReady;
      await staticCardsReady;
      await callSettingsReady;
      await dialogueLibrariesReady;
      await tutorMemoryReady;

      // Live Hints OFF: skip the model entirely (no GPT/Gemini call), so no
      // translation and no suggestion are produced. The raw transcript is still
      // broadcast (original language only), still persisted, and the post-call
      // summary + AirAtoma CRM delivery still run on close — all independent of
      // this hint path. Deepgram transcription is untouched.
      if (!callSettings.liveHintsEnabled) {
        uiBroadcast({
          type: "guest_transcript",
          text,
          translation: "",
          isFinal: true,
          isComplete: true,
          confidence,
          utteranceId,
          callSid,
        });
        log(`[HintsOff] live hints disabled — skipping model call utteranceId=${utteranceId}`, "websocket");
        return;
      }

      // ===== SPLIT: translation (caption) and suggestion are two independent
      // model calls fired in PARALLEL. The caption is broadcast as soon as the
      // small translation call resolves — it no longer waits for the slower
      // suggestion generation. The suggestion keeps the existing combined prompt
      // + all downstream guards unchanged.
      const translationEnabled = callSettings.translationEnabled;

      // A suggestion is only generated for turns that can actually receive one.
      // Reaction-only / farewell / wait-state turns never emit a model
      // suggestion (they're blocked below or answered with a static phrase),
      // so we skip that call instead of generating and discarding it.
      // NOTE (user requirement): goal status is NEVER a stop condition — the
      // prompter keeps suggesting for as long as the conversation continues,
      // including the very turn the goal is achieved (a normal model hint,
      // never a canned closing phrase).
      const wantSuggestion =
        !reactionOnly && !isFarewell && !waitingForInfo;

      const translationStart = Date.now();
      const translationPromise: Promise<{ translation: string; providerUsed: string }> =
        translationEnabled
          ? translateGuestText(text, currentLanguage, brainModelOverride)
          : Promise.resolve({ translation: "", providerUsed: "translation_off" });

      // ===== LIBRARY-FIRST LOOKUP =====
      // Before spending an LLM call, look for a ready-made line in the owner's
      // dialogue library for the ACTIVE goal (selected by the user's goal text,
      // falling back to the detected goal type). A hit is served through the exact
      // same suggestion path/payload below (no UI change), skipping the model
      // entirely. A miss falls through to translateAndSuggest, unchanged.
      // ===== DROPPED-QUESTION CARRYOVER =====
      // If a previous guest question's hint was dropped (superseded/cooldown/no
      // suggestion), fold it into THIS turn so the hint answers both. Only
      // consumed when this turn can actually produce a suggestion AND is still
      // the newest guest turn — a turn already superseded during the context
      // awaits must NOT consume the question (it stays for the newest turn,
      // which is the one that will actually deliver a hint).
      const { hintText, carried } = wantSuggestion
        ? hintCarryover.buildHintText(guestTurn, utteranceId === latestGuestUtteranceId)
        : { hintText: text, carried: null };
      if (carried) {
        log(`[Carryover] merging dropped question from utteranceId=${carried.utteranceId} (reason=${carried.reason}) into utteranceId=${utteranceId}: "${carried.text.substring(0, 50)}"`, "websocket");
      }

      // Every terminal hint-suppression path below goes through dropHint, so no
      // hint is EVER skipped silently, and a question folded into hintText is
      // never discarded without a decision. Policy per path:
      //  - preserveQuestion=true  → remember the (possibly merged) question so
      //    the next guest turn's hint folds it in (only fires if the text
      //    actually contains a question / action request).
      //  - preserveQuestion=false → deliberate loss-free drop: either the
      //    pending question was never consumed on this turn (wantSuggestion was
      //    false, so it still sits in the carryover for the next turn), it was
      //    already captured eagerly by the superseding turn (stale), or no
      //    future hint can ever use it (goal-achieved hard stop).
      const dropHint = (reason: string, detail: string, preserveQuestion: boolean) => {
        latencyRecorder.dropped(utteranceId, reason);
        log(`[BLOCKED] reason=${reason} utteranceId=${utteranceId}${detail ? ` ${detail}` : ""}`, "websocket");
        if (preserveQuestion && hintCarryover.remember(hintText, utteranceId, reason)) {
          log(`[Carryover] remembered question from utteranceId=${utteranceId} (reason=${reason})`, "websocket");
        }
      };

      // Skip the library on a carryover turn — a canned line matched on the
      // current phrase alone would drop the carried question all over again.
      // Grounding gate: canned library lines bypass the LLM (and thus
      // LIVE_GROUNDING_RULES), so questions only the Owner can answer from
      // direct observation ("Is it working now?", "iPhone or Android?") must
      // NOT be served a pre-authored answer — fall through to the grounded
      // LLM path, which directs the owner to answer instead of asserting.
      const ownerOnly = isOwnerOnlyQuestion(text);
      if (ownerOnly && wantSuggestion && !carried) {
        log(`[Dialogue] SKIP library for owner-only question utteranceId=${utteranceId}: "${text.substring(0, 50)}"`, "websocket");
      }
      const ownerGoal = getUserGoal(streamUserId);
      const libraryHit = (wantSuggestion && !carried && !ownerOnly) ? matchDialogueLibrary(text, ownerGoal, detectedGoalType) : null;
      if (libraryHit) {
        log(`[Dialogue] HIT goal="${libraryHit.library.goalText.substring(0, 30)}" (${libraryHit.library.goalType}) type=${libraryHit.entry.type} trigger="${libraryHit.entry.trigger.substring(0, 30)}" — serving library line, skipping LLM`, "websocket");
      }

      const suggestionStart = Date.now();
      if (wantSuggestion) latencyRecorder.trigger(utteranceId);
      // Fired in parallel with the translation so neither waits for the other.
      // translateAndSuggest never throws (it catches internally), so if this turn
      // is blocked before the suggestion is read, the floating promise is safe.
      // Skipped on a library hit — the ready line is used instead.
      const suggestionPromise = (wantSuggestion && !libraryHit)
        ? translateAndSuggest(hintText, ownerGoal, currentLanguage, contextHistory, true, ownerContext, contactContext, staticCards, translationEnabled, tutorMemoryBlock, brainModelOverride, strategyMemory.render())
        : null;

      // ----- Caption: broadcast as soon as the translation resolves -----
      const tr = await translationPromise;
      const translationMs = Date.now() - translationStart;
      fastLayer.onGptResponseReceived();
      // ALWAYS broadcast the guest transcript (caption), even if the suggestion
      // is later blocked. Payload shape is unchanged (backward-compatible UI).
      uiBroadcast({
        type: "guest_transcript",
        text: text,
        translation: tr.translation,
        isFinal: true,
        isComplete: true,
        confidence,
        utteranceId,
        callSid
      });
      // `now` is captured at handler entry ≈ Deepgram EndOfTurn (commitTurn fires this synchronously).
      log(`[TIMING] reaction end_of_turn->caption=${Date.now() - now}ms translation_latency_ms=${translationMs} provider_used=${tr.providerUsed} utteranceId=${utteranceId}`, "websocket");
      
      // ===== HINT THROTTLING CHECKS (only for suggestions, not transcripts) =====
      
      // (Removed) goal status NEVER gates hint delivery: no hard stop, no
      // forced closing phrase, no wait state. The achieving turn and every
      // turn after it get normal model hints for as long as the call goes on
      // (user requirement — TalkHint is a continuous prompter). A closing
      // suggestion may only come from farewell detection of actual speech.
      
      // Check 2: 1 hint = 1 utterance (same utterance already got a hint).
      // A question merged into hintText was NOT part of that earlier hint, so
      // preserve it for the next turn.
      if (utteranceId === lastHintUtteranceId) {
        dropHint("hint_shown", "- already hinted", true);
        return;
      }
      
      // Check 3: Cooldown after previous hint — preserve a merged/own question.
      const timeSinceLastHint = now - lastHintTs;
      if (lastHintTs > 0 && timeSinceLastHint < HINT_COOLDOWN_MS) {
        dropHint("cooldown", `elapsed=${timeSinceLastHint}ms`, true);
        return;
      }
      
      // ===== END THROTTLING CHECKS =====
      
      // Check: reaction-only filter (skip suggestion, but translation was shown
      // above). wantSuggestion was false → no pending question was consumed on
      // this turn; it stays in the carryover for the next eligible turn.
      if (reactionOnly) {
        dropHint("reaction_only", `text="${text.substring(0, 30)}" - suggestion skipped`, false);
        return;
      }

      // Check: farewell filter (skip suggestion, but translation was shown
      // above). Same as reaction_only: pending question was not consumed and is
      // preserved automatically. (Questions are never classified as farewells.)
      if (isFarewell) {
        dropHint("farewell", `text="${text.substring(0, 30)}" - suggestion skipped`, false);
        return;
      }
      
      // ===== WAIT STATE: Show 1 ACK, then block STEER =====
      if (waitingForInfo) {
        if (!waitAckShown) {
          // Show 1 ACK response
          waitAckShown = true;
          const ackPhrases = {
            ru: { en: "Sure, I'll wait.", translation: "Конечно, подожду." },
            es: { en: "Sure, I'll wait.", translation: "Claro, esperaré." }
          };
          const ack = ackPhrases[currentLanguage as "ru" | "es"] || ackPhrases.ru;
          
          // Latency: this static phrase IS a delivered hint — time it honestly.
          // No trigger/ready model stages (no Brain call): brain and stt→trigger
          // percentiles skip it by construction; total + delivery still count.
          latencyRecorder.ready(utteranceId, "wait_state");
          uiBroadcast({
            type: "suggestion",
            target: "HON",
            eventType: "ack",
            source: "wait_state",
            basedOnSpeaker: "GST",
            en: ack.en,
            translation: callSettings.translationEnabled ? ack.translation : "",
            utteranceId,
            callSid
          });
          latencyRecorder.sent(utteranceId, ack.en);
          lastHintTs = Date.now();
          lastHintUtteranceId = utteranceId;
          log(`[WAIT_STATE] ACK shown - "Sure, I'll wait." - now blocking STEER`, "websocket");
          return;
        } else {
          // ACK already shown, block all further STEER until exit. wantSuggestion
          // was false → the pending question was not consumed and stays queued.
          dropHint("wait_state", "- GST is checking, waiting for answer", false);
          return;
        }
      }
      
      // ----- Suggestion: library line (instant) or the parallel LLM call -----
      // We only reach here after all the "no suggestion" guards above returned.
      // On a library hit we build the suggestion from the ready line (no await,
      // no model call); otherwise we await the LLM suggestion generated above.
      let translated: {
        translation?: string;
        suggestion?: NormalizedSuggestion;
        providerUsed?: string;
      };
      if (libraryHit) {
        translated = {
          suggestion: {
            en: libraryHit.entry.answer,
            translation: translationEnabled ? libraryHit.entry.translation : "",
          },
          providerUsed: "library",
        };
      } else {
        if (!suggestionPromise) {
          // Should be unreachable (guards above cover every !wantSuggestion
          // case); preserve a merged question just in case.
          dropHint("no_suggestion_promise", "- suggestion generation was never started", true);
          return;
        }
        translated = await suggestionPromise;
      }
      const suggestionMs = Date.now() - suggestionStart;
      // First usable hint text is available server-side (library or model).
      if (translated?.suggestion?.en) {
        latencyRecorder.ready(utteranceId, translated.providerUsed === "library" ? "library" : "gpt");
      }
      log(`[HINT] model=${libraryHit ? "library" : (brainModelOverride || currentModel)} provider_used=${translated.providerUsed ?? "unknown"} translation_latency_ms=${translationMs} suggestion_latency_ms=${suggestionMs} total_hint_latency_ms=${Date.now() - now} utteranceId=${utteranceId}`, "websocket");

      // Freshness/stale guard: while this suggestion was generating, the Guest started
      // a newer turn. Drop the now-outdated suggestion and do NOT arm the cooldown, so
      // the newer turn's suggestion is not suppressed.
      if (utteranceId !== latestGuestUtteranceId) {
        // No question preserved here: the superseding turn already captured this
        // turn's question EAGERLY in beginTurn (before it built its own model
        // input). Re-remembering now could resurrect a question that was already
        // merged and answered by that newer turn.
        dropHint("stale", `latestGuestUtteranceId=${latestGuestUtteranceId}`, false);
        return;
      }

      if (translated.suggestion) {
        const suggestionText = translated.suggestion.en;
        
        // ===== ANTI-LOOP GUARD: Repeat intent check =====
        const currentIntent = detectIntent(suggestionText);
        if (currentIntent === lastSuggestionIntent && currentIntent === "enthusiasm") {
          // Preserve a question consumed into hintText — the suppressed
          // suggestion never reached the user, so the question isn't answered.
          dropHint("repeat_intent", `intent=${currentIntent} - skipping enthusiasm loop`, true);
          // Don't show repeated enthusiasm, but record that we tried
          lastSuggestionIntent = currentIntent;
          return;
        }
        
        // ===== ANTI-LOOP GUARDS: duplicate suggestion + self-overlap =====
        // Decision logic (incl. the bounded "guest re-asked a question"
        // exemption for duplicates) lives in SuggestionDedupGuard
        // (server/hintDedup.ts) — pure and unit-tested.
        const dedup = dedupGuard.evaluate({
          suggestionText,
          guestText: text,
          recentSuggestions,
          recentOwnerUtterances,
        });
        if (dedup.action === "drop") {
          if (dedup.reason === "duplicate_suggestion") {
            // The suppressed suggestion may have carried a consumed question —
            // keep it so the next turn's (different) hint can still address it.
            dropHint("duplicate_suggestion", `similarity=${(dedup.similarity * 100).toFixed(0)}% - too similar to a recent hint`, true);
          } else {
            // Preserve a consumed question: HON said something similar to the
            // SUGGESTION, which doesn't mean the guest's question was answered.
            dropHint("self_overlap", `similarity=${(dedup.similarity * 100).toFixed(0)}% - HON already said this`, true);
          }
          return;
        }
        if (dedup.action === "show_exempt") {
          log(`[Suggestion] duplicate exemption: guest re-asked a question (similarity=${(dedup.similarity * 100).toFixed(0)}%) utteranceId=${utteranceId}`, "websocket");
        }

        // (Removed) goal-achieved no longer suppresses hints, including the
        // async race where it happened during generation — the prompter keeps
        // suggesting while the conversation continues (user requirement).
        
        // Record hint shown for throttling
        lastHintTs = Date.now();
        lastHintUtteranceId = utteranceId;
        lastSuggestionIntent = currentIntent;
        lastSuggestionText = suggestionText;
        recentSuggestions.push(suggestionText);
        if (recentSuggestions.length > RECENT_SUGGESTIONS_MAX) recentSuggestions.shift();
        
        log(`[Suggestion] Sending to HON, basedOn=GST, utteranceId=${utteranceId}, intent=${currentIntent}`, "websocket");
        // Adaptive hint types (v2.1): new fields are ADDITIVE and only sent
        // when present. en/translation stay populated for every type (CHOICE
        // gets a server-composed compatibility string), so old clients that
        // only read en/translation keep working and never show an empty card.
        uiBroadcast({
          type: "suggestion",
          target: "HON",
          eventType: "suggestion",
          source: "gpt",
          basedOnSpeaker: "GST",
          en: translated.suggestion.en,
          translation: translated.suggestion.translation,
          ...(translated.suggestion.type ? { suggestionType: translated.suggestion.type } : {}),
          ...(translated.suggestion.options ? { options: translated.suggestion.options } : {}),
          ...(translated.suggestion.nativeHelper ? { nativeHelper: translated.suggestion.nativeHelper } : {}),
          utteranceId,
          callSid
        });
        latencyRecorder.sent(utteranceId, translated.suggestion.en);
        // Strategy Memory: only a hint that actually REACHED the user opens a
        // cycle (drops/stale/dedup above never do — an unseen hint can't shape
        // the owner's behavior). Library hits count too: the user saw them.
        strategyMemory.recordSuggestion(
          translated.suggestion.en,
          translated.suggestion.type,
          translated.suggestion.options,
        );
        // Full reaction time: from end of guest's turn to the suggestion leaving the server.
        log(`[TIMING] reaction end_of_turn->suggestion=${Date.now() - now}ms suggestion_latency_ms=${suggestionMs} utteranceId=${utteranceId}`, "websocket");
      } else {
        // Model produced no suggestion — this used to be a fully SILENT loss
        // (no [BLOCKED] log at all). Log it, and if the (possibly merged) turn
        // held a question, carry it into the next turn's hint.
        dropHint("no_suggestion", `provider_used=${translated.providerUsed ?? "unknown"} - model returned no suggestion`, true);
      }
    }
    
    // Handler for complete HON utterance (after debounce)
    function handleOwnerUtteranceComplete(text: string, utteranceId: number, confidence?: number) {
      log(`[UtteranceComplete] HON utterance #${utteranceId}: "${text.substring(0, 50)}..."`, "websocket");
      
      // Add to conversation log
      conversationLog.push({
        speaker: "Honor",
        text: text,
        timestamp: Date.now()
      });
      if (conversationLog.length > 10) conversationLog.shift();
      fullConversation.push({ speaker: "Owner", text });
      persistTranscriptSoon();

      // Track recent HON turns for the self-overlap guard (don't re-suggest what HON just said)
      recentOwnerUtterances.push(text);
      if (recentOwnerUtterances.length > RECENT_OWNER_MAX) recentOwnerUtterances.shift();
      ownerTurnsTimed.push({ text, ts: Date.now() });
      // Strategy Memory: actual Owner speech — the ONLY thing that can turn a
      // suggestion into something "actually said" (suggestion ≠ fact).
      strategyMemory.recordOwnerTurn(text);
      
      // Update GoalEngine
      if (goalEngine) {
        const goalUpdate = goalEngine.updateOnUtterance({
          speaker: "HON",
          text: text,
          ts: Date.now()
        });
        
        const state = goalUpdate.state;
        callGoalType = state.goalType;
        callGoalText = getUserGoal(streamUserId) || callGoalText;
        
        uiBroadcast({
          type: "goal_state_update",
          target: "HON",
          callId: state.callId,
          goalType: state.goalType,
          currentGoal: state.currentGoal,
          confidence: state.confidence,
          status: state.status,
          slots: state.slots,
          missingSlots: state.missingSlots,
          nextBestAction: state.nextBestAction
        });
        
        // A new goal replaced the old one — the "original goal resolved"
        // context note no longer applies to the NEW active goal.
        if (goalUpdate.goalChanged) goalAchievedFlag = false;
        
        // Owner explicitly abandoned the original goal ("Forget the phone
        // issue, I only want to check my payment now") — stop injecting it
        // into hint prompts as an active goal. The engine already stops all
        // slot steering; clearing currentGoal stops the prompt-side pull.
        if (goalUpdate.goalCancelled) {
          // Cancel-and-replace ("Forget the phone issue, I only want to check
          // my payment now"): keep the NEWLY detected goal in the prompt.
          // Pure cancellation: clear the goal entirely so no prompt path
          // keeps steering toward it.
          setUserGoal(streamUserId, goalUpdate.goalChanged ? state.currentGoal : "");
          log(`[GoalEngine] Owner cancelled the original goal${goalUpdate.goalChanged ? ` — replaced by "${state.currentGoal}"` : " — no longer steering toward it"}`, "goal");
          uiBroadcast({
            type: "goal_cancelled",
            target: "HON",
            callId: state.callId,
            goalType: state.goalType,
            replacedBy: goalUpdate.goalChanged ? state.currentGoal : null
          });
        }
        
        if (goalUpdate.goalAchieved) {
          goalAchievedFlag = true; // informational: UI event only, hints continue
          log(`[GoalAchieved] goal marked achieved (informational, on HON utterance) — hints continue`, "goal");
          uiBroadcast({
            type: "goal_achieved",
            target: "HON",
            callId: state.callId,
            goalType: state.goalType,
            summary: state.currentGoal,
            achievedReason: state.achievedReason
          });
        }
        
        log(`[GoalEngine] HON update: goal=${state.goalType}, status=${state.status}, slots=${JSON.stringify(goalUpdate.newSlots)}`, "goal");
      }
      
      uiBroadcast({ 
        type: "owner_transcript",
        text: text,
        isFinal: true,
        isComplete: true,
        confidence,
        utteranceId,
        callSid
      });
    }
    
    // Fast Layer for quick responses while GPT is thinking
    const fastLayer = new FastLayerManager((phrase: FastPhraseResult, waitTimeMs: number) => {
      // Fast phrases are a live-hint feature (they fill the hint banner while GPT
      // thinks), so suppress them entirely when Live Hints is OFF.
      if (!callSettings.liveHintsEnabled) {
        return;
      }
      log(`[FastLayer] Emitting fast_phrase after ${waitTimeMs}ms: "${phrase.text}" (${phrase.category})`, "fast");
      
      // Notify GoalEngine about fast phrase to prevent steer repetition
      if (goalEngine) {
        goalEngine.onFastPhraseSent(phrase.category, phrase.slot !== "none" ? phrase.slot : undefined);
      }
      
      uiBroadcast({
        type: "fast_phrase",
        text: phrase.text,
        translation: callSettings.translationEnabled ? phrase.translation : "",
        category: phrase.category,
        target: "HON",
        timestamp: Date.now(),
        waitTimeMs,
        goalType: phrase.goalType,
        slot: phrase.slot
      });
    });
    
    // Deepgram connections for each track
    let deepgramInbound: any = null;
    let deepgramOutbound: any = null;
    
    // Create Deepgram client
    const dgApiKey = process.env.DEEPGRAM_API_KEY || "";
    log(`[Deepgram] API Key present: ${dgApiKey ? 'YES (' + dgApiKey.substring(0, 8) + '...)' : 'NO'}`, "deepgram");
    const deepgramClient = createClient(dgApiKey);
    
    // Setup Deepgram live transcription for a track using raw WebSocket
    // With keepalive and reconnect support
    function setupDeepgram(track: string, onReconnect?: () => void) {
      log(`[DG] ${track}: connecting...`, "deepgram");
      
      // Use raw WebSocket for more control.
      // Deepgram Flux (v2): conversational STT with model-native turn detection.
      // It emits TurnInfo events (StartOfTurn/Update/EndOfTurn) instead of
      // is_final/speech_final + VAD, so end-of-turn is decided by meaning/intonation.
      // mulaw @ 8kHz is supported natively (Twilio's format) — no transcoding.
      // eager mode is OFF (no eager_eot_threshold) — EndOfTurn-only pipeline.
      const dgUrl = "wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=mulaw&sample_rate=8000&eot_threshold=0.7&eot_timeout_ms=3000";
      
      let keepaliveInterval: NodeJS.Timeout | null = null;
      let reconnectAttempts = 0;
      const maxReconnectAttempts = 3;
      let isClosedIntentionally = false;
      
      const dgWs = new WebSocket(dgUrl, {
        headers: {
          "Authorization": `Token ${dgApiKey}`
        }
      });
      
      // Wrapper to match SDK interface
      const connection = {
        send: (data: Buffer) => {
          if (dgWs.readyState === WebSocket.OPEN) {
            dgWs.send(data);
          }
        },
        finish: () => {
          if (dgWs.readyState === WebSocket.OPEN) {
            dgWs.close();
          }
        },
        on: (event: string, handler: any) => {
          // Map to raw WebSocket events
        }
      };
      
      dgWs.on("open", () => {
        log(`[DG] ${track}: open`, "deepgram");
        reconnectAttempts = 0;
        // Flux has a server-side watchdog (it injects silence on gaps), so no
        // manual KeepAlive ping is needed — and v2 ignores the v1 KeepAlive msg.
      });
      
      dgWs.on("message", async (data: any) => {
        try {
          const response = JSON.parse(data.toString());
          
          // Flux (v2) speaks in TurnInfo events instead of is_final/VAD.
          if (response.type !== "TurnInfo") {
            // Connected / Metadata / Error etc. — log and ignore.
            if (response.type === "Error" || response.type === "Warning") {
              log(`[DG] ${track}: ${response.type} - ${response.description || response.message || JSON.stringify(response)}`, "deepgram");
            }
            return;
          }
          
          const event: string = response.event; // StartOfTurn | Update | EndOfTurn
          const transcript: string = (response.transcript || "").trim();
          
          // Track mapping (CORRECTED):
          // Twilio Media Streams: inbound = audio INTO Twilio, outbound = audio OUT OF Twilio.
          // Owner-leg stream (browser outbound call): inbound=HON (browser mic), outbound=GST (remote PSTN).
          // Caller-leg stream (incoming answered: browser <Dial><Client> AND iOS conference bridge):
          //   the stream rides the caller's leg, so inbound=GST (caller), outbound=HON (bridged agent).
          //   This is the mirror of the owner-leg case and is what fixes iOS CALLER/YOU being swapped.
          const { isGuestTrack, speakerLabel, speakerCode } =
            resolveSpeakerRole(track, streamOnCallerLeg);
          
          if (event === "StartOfTurn") {
            log(`[DG] ${track}: StartOfTurn speaker=${speakerLabel}`, "deepgram");
            return;
          }
          
          if (!transcript) {
            return;
          }
          
          if (event === "Update") {
            // Interim turn-in-progress text — show live, do not run the pipeline.
            if (isGuestTrack) {
              uiBroadcast({ type: "guest_transcript", text: transcript, isFinal: false, callSid });
            } else {
              uiBroadcast({ type: "owner_transcript", text: transcript, isFinal: false, callSid });
            }
            return;
          }
          
          if (event === "EndOfTurn") {
            const eotConf = response.end_of_turn_confidence;
            log(`[TrackDebug] track=${track}, callerLeg=${streamOnCallerLeg}, isPstn=${isPstnForwarding}, isGuest=${isGuestTrack}, speaker=${speakerLabel} event=EndOfTurn conf=${eotConf}`, "deepgram");
            
            // Show the completed turn text immediately as interim. The canonical
            // FINAL (guest carries translation; owner carries isComplete) is emitted
            // once by handle{Guest,Owner}UtteranceComplete via onGenerate below —
            // marking this isFinal would double-fire the same final to UI consumers.
            if (isGuestTrack) {
              uiBroadcast({ type: "guest_transcript", text: transcript, isFinal: false, callSid });
            } else {
              uiBroadcast({ type: "owner_transcript", text: transcript, isFinal: false, callSid });
            }
            
            // Commit the completed turn → runs translation/hint pipeline via onGenerate.
            utteranceGate.commitTurn(callSid || "unknown", speakerCode as "GST" | "HON", transcript, eotConf);
          }
        } catch (err: any) {
          log(`[Deepgram] Parse error: ${err.message}`, "deepgram");
        }
      });
      
      dgWs.on("error", (err: any) => {
        log(`[DG] ${track}: error - ${err.message}`, "deepgram");
      });
      
      dgWs.on("close", (code: number, reason: Buffer) => {
        const reasonStr = reason?.toString() || "no reason";
        log(`[DG] ${track}: closed code=${code} reason=${reasonStr}`, "deepgram");
        
        // Clear keepalive interval
        if (keepaliveInterval) {
          clearInterval(keepaliveInterval);
          keepaliveInterval = null;
        }
        
        // Auto-reconnect if not intentionally closed
        if (!isClosedIntentionally && reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const backoffMs = Math.pow(2, reconnectAttempts) * 1000;
          log(`[DG] ${track}: reconnect attempt #${reconnectAttempts} backoff=${backoffMs}ms`, "deepgram");
          setTimeout(() => {
            if (onReconnect) {
              onReconnect();
              log(`[DG] ${track}: reconnected`, "deepgram");
            }
          }, backoffMs); // Exponential backoff: 2s, 4s, 8s
        }
      });
      
      return { 
        dgWs, 
        send: (data: Buffer) => {
          if (dgWs.readyState === WebSocket.OPEN) {
            dgWs.send(data);
          }
        }, 
        finish: () => {
          isClosedIntentionally = true;
          if (keepaliveInterval) {
            clearInterval(keepaliveInterval);
            keepaliveInterval = null;
          }
          if (dgWs.readyState === WebSocket.OPEN) {
            dgWs.close();
          }
        }
      };
    }

    // Candidate Pipeline v1 (Task #207): replace the (already-open) Deepgram
    // Flux connections with OpenAI realtime transcription for this call only.
    // Called from the "start" handler once the per-user config is loaded.
    // Fail-closed for the experiment: if the candidate STT cannot be created,
    // the Flux connections are LEFT RUNNING and the pipeline is reported as
    // not swapped (no mixed-STT candidate runs, no silent production change).
    async function swapToCandidateStt(sttId: import("./candidatePipeline").CandidateSttId): Promise<void> {
      const mkTrack = async (track: string) => {
        const { isGuestTrack } = resolveSpeakerRole(track, streamOnCallerLeg);
        return createOpenAiRealtimeStt({
          sttId,
          track,
          log: (m) => log(m, "deepgram"),
          onInterim: (text) => {
            uiBroadcast(
              isGuestTrack
                ? { type: "guest_transcript", text, isFinal: false, callSid }
                : { type: "owner_transcript", text, isFinal: false, callSid }
            );
          },
          onFinal: (transcript) => {
            const { isGuestTrack: g, speakerLabel, speakerCode } = resolveSpeakerRole(track, streamOnCallerLeg);
            log(`[OAI-STT] ${track}: final speaker=${speakerLabel} "${transcript.substring(0, 60)}"`, "deepgram");
            uiBroadcast(
              g
                ? { type: "guest_transcript", text: transcript, isFinal: false, callSid }
                : { type: "owner_transcript", text: transcript, isFinal: false, callSid }
            );
            utteranceGate.commitTurn(callSid || "unknown", speakerCode as "GST" | "HON", transcript, undefined);
          },
        });
      };
      if (streamClosed) return; // stream ended before setup even started
      const [inbound, outbound] = await Promise.all([mkTrack("inbound"), mkTrack("outbound")]);
      // Teardown race: the stream may have closed while we were minting
      // secrets / completing handshakes. Closure wins — finish whatever we
      // created and leave all pipeline state untouched (cleanup already ran).
      if (streamClosed) {
        if (!("error" in inbound)) inbound.finish();
        if (!("error" in outbound)) outbound.finish();
        log(`[CandidatePipeline] stream closed during STT setup — aborting swap, candidate sockets closed`, "twilio");
        return;
      }
      if ("error" in inbound || "error" in outbound) {
        const err = ("error" in inbound && inbound.error) || ("error" in outbound && outbound.error);
        log(`[CandidatePipeline] STT swap FAILED (${err}) — staying on production Flux; call will be labeled sttEffective=failed (not a candidate STT run)`, "twilio");
        if (!("error" in inbound)) inbound.finish();
        if (!("error" in outbound)) outbound.finish();
        sttSwapState = "failed";
        return;
      }
      // Swap atomically: mark swapped FIRST (blocks any Flux reconnect from
      // resurrecting into deepgramInbound/outbound), then close Flux and route
      // media to the candidate.
      sttSwapState = "swapped";
      sttSwapDelayMs = streamStartAtMs > 0 ? Date.now() - streamStartAtMs : null;
      if (deepgramInbound) deepgramInbound.finish();
      if (deepgramOutbound) deepgramOutbound.finish();
      deepgramInbound = inbound;
      deepgramOutbound = outbound;
      deepgramReady = true;
      log(`[CandidatePipeline] STT swapped to ${sttId} for call ${callSid} (lead-in on Flux: ${sttSwapDelayMs ?? "?"}ms)`, "twilio");
    }

    ws.on("message", (data: Buffer) => {
      try {
        const message: TwilioMediaMessage = JSON.parse(data.toString());
        
        if (message.event !== "media") {
          log(`Twilio event: ${message.event}`, "twilio");
        }

        switch (message.event) {
          case "connected":
            log("Twilio Media Stream handshake", "twilio");
            // Pre-initialize Deepgram immediately on connected to capture early audio
            log("[DG] Pre-initializing on connected event", "deepgram");
            
            let inboundReady = false;
            let outboundReady = false;
            
            const checkBothReady = () => {
              if (inboundReady && outboundReady && !deepgramReady) {
                deepgramReady = true;
                log("[DG] Both connections ready, flushing buffer", "deepgram");
                
                // Flush any buffered audio
                if (audioBuffer.length > 0) {
                  const bufferedMs = Math.round(audioBuffer.length * 20);
                  log(`[AUDIO] flush buffered ${bufferedMs}ms (${audioBuffer.length} frames)`, "twilio");
                  for (const frame of audioBuffer) {
                    if (frame.track === "inbound" && deepgramInbound) {
                      deepgramInbound.send(frame.data);
                    } else if (frame.track === "outbound" && deepgramOutbound) {
                      deepgramOutbound.send(frame.data);
                    }
                  }
                  audioBuffer.length = 0;
                }
              }
            };
            
            const setupInboundEarly = () => {
              // After a candidate STT swap, Flux must never resurrect via the
              // auto-reconnect path — it would silently overwrite the candidate
              // connection and contaminate the run with mixed STT output.
              if (sttSwapState === "swapped") return;
              const dg = setupDeepgram("inbound", setupInboundEarly);
              deepgramInbound = dg;
              // Wait for actual WebSocket open
              if (dg.dgWs) {
                dg.dgWs.on("open", () => {
                  inboundReady = true;
                  log("[DG] inbound WebSocket opened", "deepgram");
                  checkBothReady();
                });
              }
            };
            const setupOutboundEarly = () => {
              if (sttSwapState === "swapped") return; // see setupInboundEarly
              const dg = setupDeepgram("outbound", setupOutboundEarly);
              deepgramOutbound = dg;
              // Wait for actual WebSocket open
              if (dg.dgWs) {
                dg.dgWs.on("open", () => {
                  outboundReady = true;
                  log("[DG] outbound WebSocket opened", "deepgram");
                  checkBothReady();
                });
              }
            };
            setupInboundEarly();
            setupOutboundEarly();
            break;

          case "start":
            if (message.start) {
              streamStartAtMs = Date.now();
              streamSid = message.start.streamSid;
              callSid = message.start.callSid;

              // Resolve which user owns this call so its transcripts/hints go
              // only to that user. The call is accepted (setCallOwner) before
              // Twilio opens the media stream, so the map is normally populated;
              // fall back to the pendingCalls table just in case.
              // Load the owner's "My Context" once per call so every hint can be
              // personalized. Best-effort: failures leave ownerContext empty.
              ownerContext = ""; // reset any stale value before (re)loading for this call
              const loadOwnerContext = (uid: string): Promise<void> => {
                return storage.getUserContext(uid)
                  .then((ctx) => {
                    ownerContext = ctx || "";
                    if (ownerContext) {
                      log(`[TwilioStream] Loaded user context for ${uid} (${ownerContext.length} chars)`, "twilio");
                    }
                  })
                  .catch((err) => log(`[TwilioStream] User context load failed: ${err}`, "twilio"));
              };

              streamUserId = callOwners.get(callSid);
              if (streamUserId) {
                // Expose this call's latency recorder for suggestion_ack routing
                // (device-delivery stage of the speech→hint chain). Registered
                // with an ownership snapshot so acks keep working through the
                // post-close grace window; no owner => no registration (acks
                // fail closed, matching uiBroadcast's fail-closed routing).
                registerLatencyRecorder(callSid, streamUserId, latencyRecorder);
                registerAskBridge();
                ownerContextReady = loadOwnerContext(streamUserId);
              } else {
                const sidForLookup = callSid;
                ownerContextReady = db.select({ userId: pendingCalls.userId })
                  .from(pendingCalls)
                  .where(eq(pendingCalls.callSid, sidForLookup))
                  .limit(1)
                  .then((rows) => {
                    const uid = rows[0]?.userId;
                    if (uid) {
                      streamUserId = uid;
                      callOwners.set(sidForLookup, uid);
                      registerLatencyRecorder(sidForLookup, uid, latencyRecorder);
                      registerAskBridge();
                      log(`[TwilioStream] Resolved owner ${uid} for ${sidForLookup} via DB`, "twilio");
                      return loadOwnerContext(uid);
                    } else {
                      log(`[TwilioStream] No owner found for ${sidForLookup}`, "twilio");
                    }
                  })
                  .catch((err) => log(`[TwilioStream] Owner lookup failed: ${err}`, "twilio"));
              }

              // Load this caller's CONTACT_CONTEXT once the owner is known. The
              // other party's phone comes from the call record: for outbound it's
              // the dialed number (toNumber), for inbound it's the caller
              // (fromNumber) — never the user's own Twilio number, and never a
              // "client:" identity. Best-effort; failures leave contactContext empty.
              contactContext = "";   // reset stale values before (re)loading
              otherPartyPhone = "";
              const sidForContact = callSid;
              contactContextReady = ownerContextReady
                .then(async () => {
                  if (!streamUserId || !sidForContact) return;
                  const call = await storage.getCallByCallSid(sidForContact);
                  if (!call) {
                    log(`[ContactMemory] No call record for ${sidForContact}, skipping contact load`, "twilio");
                    return;
                  }
                  const phone = deriveOtherPartyPhone(call);
                  if (!phone) {
                    const raw = call.direction === "outgoing" ? call.toNumber : call.fromNumber;
                    log(`[ContactMemory] No usable other-party phone for ${sidForContact} (got "${raw}")`, "twilio");
                    return;
                  }
                  otherPartyPhone = phone;
                  const mem = await storage.getContactMemory(streamUserId, phone);
                  if (mem) {
                    contactContext = formatContactMemory(mem);
                    log(`[ContactMemory] Loaded memory for ${phone} (${contactContext.length} chars)`, "twilio");
                  } else {
                    log(`[ContactMemory] No prior memory for ${phone}`, "twilio");
                  }
                })
                .catch((err) => log(`[ContactMemory] Contact context load failed: ${err}`, "twilio"));

              // Load the owner's STATIC_CARDS (project/company knowledge cards)
              // once the owner is known. Best-effort: failures leave the block
              // empty. Cards are scoped to the owning user and capped in size by
              // formatStaticCards so card volume can't blow the hint budget.
              staticCards = ""; // reset stale value before (re)loading for this call
              staticCardsReady = ownerContextReady
                .then(async () => {
                  if (!streamUserId) return;
                  const cards = await storage.listKnowledgeCards(streamUserId);
                  staticCards = formatStaticCards(cards);
                  if (staticCards) {
                    log(`[StaticCards] Loaded ${cards.length} card(s) for ${streamUserId} (${staticCards.length} chars)`, "twilio");
                  }
                })
                .catch((err) => log(`[StaticCards] Static cards load failed: ${err}`, "twilio"));

              // Load the owner's auto-built dialogue libraries (one per goal) once
              // the owner is known. Best-effort: a load failure leaves the list
              // empty, so every turn simply falls through to the existing live hint
              // path — libraries only ever ADD a fast path, never block.
              dialogueLibraries = [];
              dialogueLibrariesReady = ownerContextReady
                .then(async () => {
                  if (!streamUserId) return;
                  dialogueLibraries = await storage.listDialogueLibraries(streamUserId);
                  const totalEntries = dialogueLibraries.reduce(
                    (n, lib) => n + (Array.isArray(lib.entries) ? lib.entries.length : 0), 0);
                  if (dialogueLibraries.length) {
                    log(`[Dialogue] Loaded ${dialogueLibraries.length} librar${dialogueLibraries.length === 1 ? "y" : "ies"} (${totalEntries} entries) for ${streamUserId}`, "twilio");
                  }
                })
                .catch((err) => log(`[Dialogue] Library load failed: ${err}`, "twilio"));

              // Claim the owner's confirmed tutor Call Memory (if any) once the
              // owner is known. Only REAL_CALL_READY memories qualify — nothing
              // unconfirmed can ever reach a real call — and the claim itself
              // consumes the row atomically (used_at + COMPLETED). Best-effort.
              tutorMemoryBlock = "";
              const sidForTutorMemory = callSid;
              tutorMemoryReady = ownerContextReady
                .then(async () => {
                  if (!streamUserId) return;
                  const mem = await claimActiveCallMemory(streamUserId, sidForTutorMemory ?? undefined);
                  if (mem) {
                    tutorMemoryBlock = formatCallMemoryBlock(mem);
                    log(`[TutorMemory] Claimed confirmed call memory ${mem.id} for ${streamUserId} (${tutorMemoryBlock.length} chars)`, "twilio");
                  }
                })
                .catch((err) => log(`[TutorMemory] Claim failed: ${err}`, "twilio"));

              // Load the owner's live-call feature toggles (Live Hints + Translation)
              // once the owner is known. Defaults stay ON if the load fails so a
              // transient error never silently kills hints for the whole call.
              callSettings = { liveHintsEnabled: true, translationEnabled: true };
              callSettingsReady = ownerContextReady
                .then(async () => {
                  if (!streamUserId) return;
                  callSettings = await storage.getUserCallSettings(streamUserId);
                  log(`[CallSettings] liveHints=${callSettings.liveHintsEnabled} translation=${callSettings.translationEnabled} for ${streamUserId}`, "twilio");
                })
                .catch((err) => log(`[CallSettings] Load failed (defaults ON): ${err}`, "twilio"));

              // Candidate Pipeline v1 (Task #207): load the per-user experimental
              // pipeline config. Fail-safe: any load error keeps it DISABLED
              // (production pipeline). When an OpenAI candidate STT is selected,
              // the Deepgram connections opened early (on "connected") are torn
              // down and replaced — the few seconds of pre-"start" audio stay
              // with Flux and are intentionally not replayed to the candidate.
              candidatePipeline = { ...DISABLED_PIPELINE };
              const pipelineReady = ownerContextReady
                .then(async () => {
                  if (!streamUserId || streamClosed) return;
                  const cfg = await storage.getCandidatePipeline(streamUserId);
                  if (!cfg.enabled || streamClosed) return;
                  candidatePipeline = cfg;
                  brainModelOverride = cfg.brainModel || undefined;
                  log(`[CandidatePipeline] ENABLED for ${streamUserId}: stt=${cfg.stt ?? "production"} brain=${cfg.brainModel ?? "production"}`, "twilio");
                  if (isCandidateStt(cfg.stt)) {
                    await swapToCandidateStt(cfg.stt);
                  }
                })
                .catch((err) => log(`[CandidatePipeline] Load failed (staying on production): ${err}`, "twilio"));
              callSettingsReady = callSettingsReady.then(() => pipelineReady);

              // Check for PSTN forwarding mode (roles inverted)
              const callType = message.start.customParameters?.callType;
              isPstnForwarding = callType === "pstn_forwarding";
              // Incoming answered calls (browser <Dial><Client> and the iOS
              // <Dial><Conference> bridge) attach the stream to the CALLER's leg,
              // so inbound/outbound are mirrored vs a browser outbound call.
              streamOnCallerLeg = streamRidesCallerLeg(callType);
              
              log(`Stream started: ${callSid}, callType: ${callType || 'browser'}, isPstnForwarding: ${isPstnForwarding}, streamOnCallerLeg: ${streamOnCallerLeg}`, "twilio");
              log(`Tracks: ${message.start.tracks?.join(", ")}`, "twilio");
              
              // Log track roles for debugging
              if (streamOnCallerLeg) {
                log(`[Track Mapping] caller-leg stream: GST=inbound, HON=outbound`, "twilio");
              } else {
                log(`[Track Mapping] owner-leg stream: HON=inbound, GST=outbound`, "twilio");
              }
              
              // Initialize Goal State Engine for this call
              goalEngine = getOrCreateEngine(callSid);
              log(`[GoalEngine] Initialized for call: ${callSid}`, "goal");
              
              // Note: Deepgram already initialized on "connected" event for early capture
              log(`[Deepgram] Deepgram ready: ${deepgramReady}, inbound: ${!!deepgramInbound}, outbound: ${!!deepgramOutbound}`, "deepgram");
            }
            break;

          case "media":
            audioFrameCount++;
            if (message.media?.payload) {
              const track = message.media.track;
              const audioData = Buffer.from(message.media.payload, "base64");
              
              // Track audio frames per track for debugging
              if (audioFrameCount === 1) {
                log(`[Audio] First frame received on track: ${track}`, "twilio");
              }
              
              // Buffer audio if Deepgram not ready yet (should be rare)
              if (!deepgramReady) {
                if (audioBuffer.length < 500) { // Limit buffer size
                  audioBuffer.push({ track, data: audioData });
                }
                if (audioBuffer.length === 1) {
                  log(`[AUDIO] buffering start - DG not ready`, "twilio");
                }
              } else {
                // Send audio to appropriate Deepgram connection
                if (track === "inbound" && deepgramInbound) {
                  deepgramInbound.send(audioData);
                } else if (track === "outbound" && deepgramOutbound) {
                  deepgramOutbound.send(audioData);
                }
              }
              
              // Log periodically with track info
              if (audioFrameCount === 50) {
                log(`[Audio] 50 frames received, stream is active`, "twilio");
              }
              if (audioFrameCount % 500 === 0) {
                log(`Audio frames: ${audioFrameCount}`, "twilio");
              }
            }
            break;

          case "stop":
            log(`Stream ended: ${callSid}, total frames: ${audioFrameCount}`, "twilio");
            // Abort any in-flight candidate STT setup (see swapToCandidateStt).
            streamClosed = true;
            // Close Deepgram connections
            if (deepgramInbound) {
              deepgramInbound.finish();
              deepgramInbound = null;
            }
            if (deepgramOutbound) {
              deepgramOutbound.finish();
              deepgramOutbound = null;
            }
            // Cleanup GoalEngine
            if (callSid) {
              removeEngine(callSid);
            }
            // The goal belongs to THIS call's history — the next call must start
            // without it (clients also clear their local copy on call end).
            // Capture last active goal text before clearing (for metadata flush).
            callGoalText = getUserGoal(streamUserId) || callGoalText;
            setUserGoal(streamUserId, "");
            break;
        }
      } catch (err: any) {
        log(`Twilio error: ${err.message}`, "twilio");
      }
    });

    // Log pong responses from Twilio
    ws.on("pong", () => {
      log(`[Twilio] pong received`, "twilio");
    });
    
    ws.on("close", (code: number, reason: Buffer) => {
      const reasonStr = reason.toString() || "no reason";
      const duration = ((Date.now() - new Date(startTime).getTime()) / 1000).toFixed(1);
      log(`[Twilio] WS closed code=${code} reason="${reasonStr}" duration=${duration}s callSid=${callSid}`, "twilio");
      // Abort any in-flight candidate STT setup (see swapToCandidateStt) —
      // late swaps after teardown would leak realtime sockets and mutate state.
      streamClosed = true;

      // Backstop for the "stop" handler: some teardown paths close the socket
      // without a clean stop event — the goal must still die with the call.
      // Capture last active goal text before the backstop clear (for metadata flush).
      callGoalText = callGoalText || getUserGoal(streamUserId);
      setUserGoal(streamUserId, "");

      // Contact memory: summarize this call and upsert it for (owner, other party).
      // Detached on purpose — summarization makes a model call, so it must NEVER
      // block call teardown. Capture the needed state before cleanup runs below.
      const memUserId = streamUserId;
      const memPhone = otherPartyPhone;
      const memTranscript = fullConversation.slice();
      if (memUserId && memPhone && memTranscript.length > 0) {
        void summarizeAndSaveContactMemory(memUserId, memPhone, memTranscript)
          .catch((err) => log(`[ContactMemory] save failed: ${err}`, "websocket"));
      }

      // Final transcript flush: cancel any pending throttled write and persist the
      // complete transcript now, so the call record (and the /twilio/status backstop)
      // always has the full text even if the last turns landed inside the throttle
      // window.
      if (transcriptPersistTimer) {
        clearTimeout(transcriptPersistTimer);
        transcriptPersistTimer = null;
      }
      if (callSid && memTranscript.length > 0) {
        const finalText = renderTranscriptText(memTranscript);
        if (finalText) {
          void storage
            .updateCallTranscriptByCallSid(callSid, finalText)
            .catch((err) => log(`[Transcript] final persist failed: ${err}`, "websocket"));
        }
      }

      // Latency flush with a bounded ACK grace window: a device may render the
      // final hint right as the call ends, so its suggestion_ack can arrive
      // AFTER this close event. Keep the recorder registered for a short grace
      // period, then unregister (later acks are honestly "not delivered") and
      // snapshot the metadata. Detached + non-throwing — never blocks teardown.
      if (callSid) {
        const flushSid = callSid;
        const flushPipeline = candidatePipeline;
        const flushSttInfo = {
          effective: sttSwapState === "none" ? null : (sttSwapState as "swapped" | "failed"),
          swapDelayMs: sttSwapDelayMs,
        };
        const flushOwnerTurns = ownerTurnsTimed.slice();
        // Snapshot goal state (already cleared from goalsByUser above).
        const flushGoalText = callGoalText;
        const flushGoalType = callGoalType;
        setTimeout(() => {
          unregisterLatencyRecorder(flushSid);
          if (latencyRecorder.count > 0 || flushGoalText) {
            const meta: Record<string, unknown> = {
              ...latencyRecorder.toMetadata(flushPipeline, flushSttInfo, flushOwnerTurns),
            };
            // Persist the active goal so offline analysis can read it directly
            // from the call record rather than relying on a frozen fixture.
            if (flushGoalText) {
              meta.goalText = flushGoalText;
              meta.goalType = flushGoalType;
            }
            void storage
              .mergeCallMetadataByCallSid(flushSid, meta)
              .catch((err) => log(`[CandidatePipeline] latency flush failed: ${err}`, "websocket"));
          }
        }, SUGGESTION_ACK_GRACE_MS);
      }

      // AirAtoma CRM: push the finished call to the external webhook
      // (POST /api/talkhint/webhook). Detached + best-effort — like the contact
      // summarization above it makes a network call, so it must NEVER block call
      // teardown. No-op unless the call owner has set a personal AirAtoma URL.
      // NOTE: we send even when the transcript is empty (sub-5s call or Deepgram
      // caught nothing) — a minimal record (caller name/number + duration) so a
      // short call is never silently dropped. The transcript field is just "".
      const airCallSid = callSid;
      const airDurationSecs = (Date.now() - new Date(startTime).getTime()) / 1000;
      if (memUserId && airCallSid) {
        void (async () => {
          // callerName = the contact's saved name, falling back to their phone.
          let callerName = memPhone || "Unknown";
          if (memPhone) {
            try {
              const mem = await storage.getContactMemory(memUserId, memPhone);
              if (mem?.name && mem.name.trim()) callerName = mem.name.trim();
            } catch {
              // fall back to phone number on lookup failure
            }
          }
          // Per-user destination: send to the call owner's personal AirAtoma URL.
          // No server-wide fallback — if the owner hasn't set one, nothing is sent.
          let targetUrl: string | null = null;
          try {
            const owner = await storage.getUser(memUserId);
            if (owner?.airatomaWebhookUrl && owner.airatomaWebhookUrl.trim()) {
              targetUrl = owner.airatomaWebhookUrl.trim();
            }
          } catch {
            // on lookup failure, leave targetUrl null → delivery is skipped
          }
          await deliverCallToAirAtoma(
            {
              callId: airCallSid,
              transcript: memTranscript,
              callerName,
              durationSecs: airDurationSecs,
              targetUrl,
            },
            (m) => log(m, "websocket"),
          );
        })().catch((err) => log(`[AirAtoma] send failed: ${err}`, "websocket"));
      }

      // Clear keepalive interval
      clearInterval(twilioKeepaliveInterval);
      
      // Cleanup Deepgram connections
      if (deepgramInbound) {
        deepgramInbound.finish();
        deepgramInbound = null;
      }
      if (deepgramOutbound) {
        deepgramOutbound.finish();
        deepgramOutbound = null;
      }
      // Cleanup GoalEngine
      if (callSid) {
        removeEngine(callSid);
        utteranceGate.cleanup(callSid);
        clearCallOwner(callSid);
      }
      // Remove this call's Ask bridge (only if it is still OURS — a newer
      // call for the same user must not lose its bridge to a late close).
      if (streamUserId && liveAskBridges.get(streamUserId) === askBridge) {
        liveAskBridges.delete(streamUserId);
      }
      
      // Reset hint throttling, anti-loop guards, and wait state for next call
      lastHintTs = 0;
      lastHintUtteranceId = -1;
      latestGuestUtteranceId = -1;
      goalAchievedFlag = false;
      lastSuggestionIntent = "";
      lastSuggestionText = "";
      recentOwnerUtterances.length = 0;
      waitingForInfo = false;
      waitAckShown = false;
      waitingSlot = null;
      dedupGuard.reset();
      log(`[Cleanup] Hint throttling, anti-loop guards, wait state reset`, "websocket");
    });
    
    ws.on("error", (err) => {
      log(`[Twilio] WS error: ${err.message}`, "twilio");
    });
  }
  
  return wss;
}
