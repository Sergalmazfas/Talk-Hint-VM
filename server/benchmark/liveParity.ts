/** Lab-only adapter. Imports pure builders, never the live websocket/server. */
import { createHash } from "node:crypto";
import { buildLiveSystemPrompt, buildLiveUserPrompt } from "../../shared/prompts";
import { withActionResults } from "../hintActionResults";
import { buildOpenAIChatBody } from "../hintProvider";
import { normalizeSuggestion } from "../hintShape";
import type { BrainEnvelopeOutput, ReferenceTurn } from "./types";

export const LIVE_PARITY_VERSION = "live-hint-parity-v1";
export const hashText = (text: string) => createHash("sha256").update(text).digest("hex");

export interface LivePromptContext {
  goal: string;
  language: string;
  conversationContext: string;
  contextSections: string;
  strategyMemory: string;
  translateEnabled: boolean;
  actionResultsEnabled?: boolean;
}

export function buildLiveBenchmarkRequest(model: string, guestText: string, context: LivePromptContext) {
  const system = withActionResults(buildLiveSystemPrompt(context), context.actionResultsEnabled);
  const user = buildLiveUserPrompt(guestText);
  const body = buildOpenAIChatBody(model, system, user, 250);
  return {
    system, user, body,
    systemHash: hashText(system),
    userHash: hashText(user),
    requestHash: hashText(JSON.stringify(body)),
    promptVersion: LIVE_PARITY_VERSION,
  };
}

/** The wire reply remains LIVE JSON; this is only a legacy judge/check adapter. */
export function parseLiveBenchmarkReply(raw: string, translateEnabled: boolean): BrainEnvelopeOutput | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: any;
  try { parsed = JSON.parse(match[0]); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || typeof parsed.translation !== "string") return null;
  // Do not silently accept the old, different benchmark response schema.
  if ("should_suggest" in parsed) return null;
  if (parsed.suggestion != null && typeof parsed.suggestion !== "object") return null;
  const suggestion = normalizeSuggestion(parsed.suggestion, { translateEnabled });
  if (parsed.suggestion != null && !suggestion) return null;
  return {
    should_suggest: !!suggestion?.en,
    suggested_reply: suggestion?.en,
    translation: translateEnabled ? parsed.translation : "",
  };
}

export interface FixtureTimingInput {
  id: string;
  goal?: string | null;
  audioBase64?: string | null;
  referenceTurns: unknown;
}

/** No synthetic boundaries, receipt-order alignment or invented price. */
export function inspectTimedCorpus(fixtures: FixtureTimingInput[], minimum = 10) {
  const problems: string[] = [];
  const distinct = new Set(fixtures.map(f => f.id));
  if (distinct.size !== fixtures.length) problems.push("DUPLICATE_FIXTURES");
  if (fixtures.length < minimum || fixtures.length > 20) problems.push("REQUIRE_10_TO_20_RECORDINGS");
  for (const f of fixtures) {
    if (!f.audioBase64) problems.push(`${f.id}:NO_AUDIO`);
    if (!f.goal?.trim()) problems.push(`${f.id}:NO_GOAL`);
    const turns = Array.isArray(f.referenceTurns) ? f.referenceTurns as ReferenceTurn[] : [];
    const guests = turns.filter(t => t.role === "guest");
    if (!guests.length) problems.push(`${f.id}:NO_GUEST_TURNS`);
    for (const role of ["guest", "owner"]) {
      let previousEnd = -1;
      for (const t of turns.filter(t => t.role === role)) {
        if (!Number.isFinite(t.tStartMs) || !Number.isFinite(t.tEndMs) ||
            t.tStartMs! < 0 || t.tEndMs! <= t.tStartMs! || t.tStartMs! < previousEnd) {
          problems.push(`${f.id}:${role}:MISSING_OR_INVALID_SPEECH_BOUNDARIES`);
          break;
        }
        previousEnd = t.tEndMs!;
      }
    }
  }
  return { valid: problems.length === 0, recordings: distinct.size, problems };
}

export function benchmarkValidity(input: {
  requested: number; successful: number; errors: number; schemaInvalid: number;
  judged?: number; independentJudge?: boolean;
}) {
  const reasons: string[] = [];
  if (input.requested === 0 || input.successful === 0) reasons.push("ZERO_HINTS");
  if (input.errors > 0) reasons.push("API_OR_TRANSPORT_ERROR");
  if (input.schemaInvalid > 0) reasons.push("INVALID_OUTPUT");
  if (input.judged !== undefined && input.judged !== input.successful) reasons.push("INCOMPLETE_QUALITY_CHECK");
  if (input.independentJudge === false) reasons.push("NO_INDEPENDENT_JUDGE");
  return { status: reasons.length ? "invalid" as const : "valid" as const,
    excludedFromComparison: reasons.length > 0, reasons };
}

/** All timestamps share the same replay monotonic clock. Nothing is estimated. */
export function measuredStages(t: {
  speechEnd: number | null; sttFinal: number | null;
  firstHintWord: number | null; fullHint: number | null;
}) {
  const valid = Object.values(t).every(n => typeof n === "number" && Number.isFinite(n)) &&
    t.speechEnd! <= t.sttFinal! && t.sttFinal! <= t.firstHintWord! && t.firstHintWord! <= t.fullHint!;
  return { ...t, valid,
    firstWordMs: valid ? t.firstHintWord! - t.speechEnd! : null,
    fullHintMs: valid ? t.fullHint! - t.speechEnd! : null };
}
