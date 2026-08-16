// ---------------------------------------------------------------------------
// Hint usage analysis (Task: "which hints does the owner actually speak?").
//
// Matches each DELIVERED hint (sent suggestion with its English text) against
// the Owner utterances that follow it, using normalization + token/bigram
// overlap. Produces a per-call metric persisted into calls.metadata.hintUsage
// at call finalization, shown in the call diagnostics next to the latency
// stages. This is the primary quality metric for the Brain model.
//
// Honest by construction:
//  - a hint with no recorded text (old calls / pre-text telemetry) is counted
//    as "unknown", never guessed;
//  - only owner turns AFTER the hint was sent (and before the next sent hint,
//    within a bounded window) are candidates — the owner cannot have used a
//    hint before receiving it.
// ---------------------------------------------------------------------------

export interface UsageHint {
  utteranceId: number;
  text?: string;
  sentAt?: number;
  outcome: "sent" | "dropped";
}

export interface OwnerTurn {
  text: string;
  ts: number; // epoch ms when the owner finished the utterance
}

export type HintUsageVerdict = "full" | "partial" | "ignored" | "unknown";

export interface HintUsageEntry {
  utteranceId: number;
  verdict: HintUsageVerdict;
  score: number; // best token-overlap score in [0..1]; 0 for unknown
  /** The owner utterance that best matched (truncated), absent when ignored/unknown. */
  matchedOwnerText?: string;
}

export interface HintUsageSummary {
  delivered: number; // hints actually sent to the UI
  usedFull: number;
  usedPartial: number;
  ignored: number;
  unknown: number; // sent hints with no recorded text — cannot be matched
  /** (full + partial) / (delivered - unknown), % — null when nothing measurable. */
  usageRatePct: number | null;
  entries: HintUsageEntry[];
}

// Thresholds for the share of hint tokens found in an owner turn.
export const USAGE_FULL_THRESHOLD = 0.75;
export const USAGE_PARTIAL_THRESHOLD = 0.35;
// An owner turn later than this after the hint is never attributed to it.
export const USAGE_MATCH_WINDOW_MS = 120_000;

/** Lowercase, strip punctuation/diacritics noise, collapse whitespace, tokenize. */
export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u00c0-\u024f\u0400-\u04ff\s']/g, " ") // keep latin (+accents) & cyrillic letters, digits
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

/**
 * Score how much of the HINT the owner turn covers, in [0..1].
 * Blend of unigram coverage (order-insensitive) and bigram coverage (phrase
 * fidelity), weighted toward unigrams so paraphrase-with-same-words still
 * counts as partial. Direction matters: coverage is of hint tokens, so a long
 * owner monologue containing the hint verbatim still scores 1.0.
 */
export function usageScore(hintText: string, ownerText: string): number {
  const h = normalizeTokens(hintText);
  if (h.length === 0) return 0;
  const o = new Set(normalizeTokens(ownerText));
  const uniCovered = h.filter((t) => o.has(t)).length / h.length;
  const hb = bigrams(h);
  if (hb.length === 0) return uniCovered;
  const ob = new Set(bigrams(normalizeTokens(ownerText)));
  const biCovered = hb.filter((b) => ob.has(b)).length / hb.length;
  return 0.6 * uniCovered + 0.4 * biCovered;
}

export function computeHintUsage(hints: UsageHint[], ownerTurns: OwnerTurn[]): HintUsageSummary {
  const sent = hints
    .filter((h) => h.outcome === "sent" && h.sentAt != null)
    .sort((a, b) => a.sentAt! - b.sentAt!);
  const turns = [...ownerTurns].sort((a, b) => a.ts - b.ts);

  const entries: HintUsageEntry[] = [];
  let usedFull = 0, usedPartial = 0, ignored = 0, unknown = 0;

  for (let i = 0; i < sent.length; i++) {
    const hint = sent[i];
    if (!hint.text || normalizeTokens(hint.text).length === 0) {
      unknown++;
      entries.push({ utteranceId: hint.utteranceId, verdict: "unknown", score: 0 });
      continue;
    }
    // Attribution window: after this hint was sent, before the next sent hint
    // (an owner line spoken after a NEWER hint belongs to that hint), bounded.
    const windowStart = hint.sentAt!;
    const nextSentAt = i + 1 < sent.length ? sent[i + 1].sentAt! : Infinity;
    const windowEnd = Math.min(nextSentAt, windowStart + USAGE_MATCH_WINDOW_MS);

    let best = 0;
    let bestText: string | undefined;
    for (const turn of turns) {
      if (turn.ts < windowStart) continue;
      if (turn.ts >= windowEnd) break;
      const s = usageScore(hint.text, turn.text);
      if (s > best) {
        best = s;
        bestText = turn.text;
      }
    }

    let verdict: HintUsageVerdict;
    if (best >= USAGE_FULL_THRESHOLD) { verdict = "full"; usedFull++; }
    else if (best >= USAGE_PARTIAL_THRESHOLD) { verdict = "partial"; usedPartial++; }
    else { verdict = "ignored"; ignored++; }

    entries.push({
      utteranceId: hint.utteranceId,
      verdict,
      score: Math.round(best * 100) / 100,
      ...(verdict !== "ignored" && bestText ? { matchedOwnerText: bestText.slice(0, 200) } : {}),
    });
  }

  const measurable = sent.length - unknown;
  return {
    delivered: sent.length,
    usedFull,
    usedPartial,
    ignored,
    unknown,
    usageRatePct: measurable > 0 ? Math.round(((usedFull + usedPartial) / measurable) * 100) : null,
    entries: entries.slice(0, 200), // metadata stays bounded, same cap as hintLatency
  };
}
