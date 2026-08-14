// BRAIN availability checks — REAL minimal probes against the OpenAI API.
// A candidate is AVAILABLE only if it passes a real structured-output call AND
// a streaming variant returns at least one delta. Rejected model ids come back
// UNAVAILABLE with the exact API error string. NO silent model substitution.
//
// ZERO imports from the production call path.

import { BRAIN_CANDIDATES } from "./candidates";
import type { AvailabilityResult, BrainCandidate } from "./types";
import {
  ENVELOPE_JSON_SCHEMA,
  chatOnce,
  chatStream,
  parseEnvelope,
  type FetchLike,
} from "./openaiClient";

const PROBE_TIMEOUT_MS = 12_000;

const PROBE_SYSTEM =
  "You are a JSON generator for a health check. Reply with the required JSON only.";
const PROBE_USER =
  'Return {"should_suggest": true, "suggested_reply": "ok", "translation": null, ' +
  '"current_topic": null, "goal_status": null, "strategy": "answer"}.';

export interface AvailabilityDeps {
  fetchImpl?: FetchLike;
  nowMs?: () => number;
}

// Some reasoning params are model-version dependent. If a probe fails ONLY
// because the reasoning param was rejected, retry once without it and, if that
// succeeds, treat the candidate as AVAILABLE with a note (never substitute).
function looksLikeReasoningParamError(errText: string | undefined): boolean {
  if (!errText) return false;
  const lc = errText.toLowerCase();
  return (
    (lc.includes("reasoning_effort") || lc.includes("reasoning")) &&
    (lc.includes("unsupported") ||
      lc.includes("not supported") ||
      lc.includes("unknown") ||
      lc.includes("unrecognized") ||
      lc.includes("invalid") ||
      lc.includes("does not support"))
  );
}

export async function checkBrainCandidate(
  candidate: BrainCandidate,
  deps: AvailabilityDeps = {},
): Promise<AvailabilityResult> {
  const nowMs = deps.nowMs || (() => Date.now());
  const checkedAt = new Date(nowMs()).toISOString();

  if (!process.env.OPENAI_API_KEY) {
    return {
      candidateId: candidate.id,
      status: "UNAVAILABLE",
      checkedAt,
      detail: "no credentials configured (OPENAI_API_KEY missing)",
    };
  }

  const reasoningEffort =
    candidate.reasoningEffort === "none" || candidate.reasoningEffort === "low"
      ? candidate.reasoningEffort
      : undefined;

  const startedAt = nowMs();
  const notes: string[] = [];

  // Step 1: non-streaming structured-output probe.
  let structured = await chatOnce({
    model: candidate.model,
    system: PROBE_SYSTEM,
    user: PROBE_USER,
    maxTokens: 64,
    responseFormat: { type: "json_schema", json_schema: ENVELOPE_JSON_SCHEMA },
    reasoningEffort,
    timeoutMs: PROBE_TIMEOUT_MS,
    fetchImpl: deps.fetchImpl,
    nowMs,
  });

  let usedReasoning = !!reasoningEffort;
  if (!structured.ok && reasoningEffort && looksLikeReasoningParamError(structured.errorText)) {
    // The model rejected ONLY the reasoning param — retry without it.
    notes.push(
      `reasoning_effort="${reasoningEffort}" rejected by model; probed without it`,
    );
    usedReasoning = false;
    structured = await chatOnce({
      model: candidate.model,
      system: PROBE_SYSTEM,
      user: PROBE_USER,
      maxTokens: 64,
      responseFormat: { type: "json_schema", json_schema: ENVELOPE_JSON_SCHEMA },
      timeoutMs: PROBE_TIMEOUT_MS,
      fetchImpl: deps.fetchImpl,
      nowMs,
    });
  }

  if (!structured.ok) {
    return {
      candidateId: candidate.id,
      status: "UNAVAILABLE",
      checkedAt,
      detail: `structured probe failed: HTTP ${structured.status} ${structured.errorText || ""}`.trim(),
      latencyMs: nowMs() - startedAt,
    };
  }

  const parsed = parseEnvelope(structured.content);
  if (!parsed) {
    return {
      candidateId: candidate.id,
      status: "UNAVAILABLE",
      checkedAt,
      detail: `structured probe returned invalid JSON (per schema): ${structured.content.slice(0, 200)}`,
      latencyMs: nowMs() - startedAt,
    };
  }

  // Step 2: streaming probe — must yield at least one delta.
  const stream = await chatStream({
    model: candidate.model,
    system: PROBE_SYSTEM,
    user: PROBE_USER,
    maxTokens: 64,
    responseFormat: { type: "json_schema", json_schema: ENVELOPE_JSON_SCHEMA },
    reasoningEffort: usedReasoning ? reasoningEffort : undefined,
    timeoutMs: PROBE_TIMEOUT_MS,
    fetchImpl: deps.fetchImpl,
    nowMs,
  });

  if (!stream.ok) {
    return {
      candidateId: candidate.id,
      status: "UNAVAILABLE",
      checkedAt,
      detail: `streaming probe failed: HTTP ${stream.status} ${stream.errorText || ""}`.trim(),
      latencyMs: nowMs() - startedAt,
    };
  }
  if (stream.firstTokenMs === null) {
    return {
      candidateId: candidate.id,
      status: "UNAVAILABLE",
      checkedAt,
      detail: "streaming probe produced no content deltas",
      latencyMs: nowMs() - startedAt,
    };
  }

  const detail = [
    "structured + streaming OK",
    `firstToken=${stream.firstTokenMs}ms`,
    usedReasoning ? `reasoning_effort=${reasoningEffort}` : "no reasoning param",
    ...notes,
  ].join("; ");

  return {
    candidateId: candidate.id,
    status: "AVAILABLE",
    checkedAt,
    detail,
    latencyMs: nowMs() - startedAt,
  };
}

// Check every BRAIN candidate in the Mandatory Candidate Matrix.
export async function checkBrainAvailability(
  deps: AvailabilityDeps = {},
): Promise<AvailabilityResult[]> {
  const results: AvailabilityResult[] = [];
  for (const candidate of BRAIN_CANDIDATES) {
    results.push(await checkBrainCandidate(candidate, deps));
  }
  return results;
}
