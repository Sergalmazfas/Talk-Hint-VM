import { normalizeSuggestion } from "../server/hintShape";
import { stripHintWrapper } from "../server/hintText";
export function normalizeCandidate(value: any, legacy = false) {
  if (legacy) {
    if (value.should_suggest === false) return { type: "none", cards: [], guestTranslation: "", source: value };
    const text = typeof value.suggested_reply === "string" ? value.suggested_reply : "";
    return { type: "legacy", cards: text ? [{ en: text, translation: value.translation ?? "", label: "" }] : [],
      guestTranslation: "", source: value };
  }
  if (!value || typeof value !== "object" || !("suggestion" in value)) throw Error("Missing suggestion contract");
  if (value.suggestion === null || value.should_suggest === false)
    return { type: "none", cards: [], guestTranslation: value.translation ?? "", source: value };
  const s = normalizeSuggestion(value.suggestion, { translateEnabled: true, stripPreamble: stripHintWrapper });
  if (!s) throw Error("Unusable suggestion");
  const cards = s.type === "choice" && s.options?.length
    ? s.options.map(o => ({ en: o.en, translation: o.translation, label: o.label }))
    : [{ en: s.en, translation: s.translation, label: "", nativeHelper: s.nativeHelper ?? "" }];
  return { type: s.type ?? "direct", cards, guestTranslation: value.translation ?? "", source: value };
}
export const words = (s: string) => (s.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? []).length;
export function codeMetrics(n: ReturnType<typeof normalizeCandidate>) {
  return { cardCount: n.cards.length, cardWords: n.cards.map(c => words(c.en)),
    totalEnglishWords: n.cards.reduce((a, c) => a + words(c.en), 0),
    maxCardEnglishWords: Math.max(0, ...n.cards.map(c => words(c.en))) };
}
export function parseJson(s: string) {
  try { return JSON.parse(s); } catch {
    const start = s.indexOf("{"), end = s.lastIndexOf("}");
    if (start < 0 || end <= start) throw Error("No JSON object");
    return JSON.parse(s.slice(start, end + 1));
  }
}
export function validateJudge(j: any, normalized: any, reference: any): string[] {
  const problems: string[] = [];
  for (const k of ["goal", "goalFactsUse"])
    if (!["yes", "partial", "no", "unknown", ...(k === "goalFactsUse" ? ["not_needed"] : [])].includes(j?.[k]))
      problems.push(`invalid ${k}`);
  for (const k of ["inventedFacts", "speakingForOwner"])
    if (![true, false, "unknown"].includes(j?.[k])) problems.push(`invalid ${k}`);
  for (const k of ["goalScore", "usefulnessScore"])
    if (!(j?.[k] === null || (typeof j?.[k] === "number" && j[k] >= 0 && j[k] <= 10))) problems.push(`invalid ${k}`);
  if (!Array.isArray(j?.claims) || typeof j?.reason !== "string") return [...problems, "missing claims/reason"];
  const sources = new Set(["GOAL", ...reference.ownerEvidence.map((x: any) => x.id)]);
  for (const c of j.claims) {
    const match = /^cards\[(\d+)\]\.(en|translation|nativeHelper)$/.exec(c.path ?? "");
    if (!match || !c.quote || !(normalized.cards[Number(match[1])]?.[match[2]] ?? "").includes(c.quote))
      problems.push("claim wrong field or nonexistent quotation");
    if (!["supported", "unsupported", "contradicted", "ambiguous", "conditional"].includes(c.status))
      problems.push("invalid claim status");
    if (c.sourceId != null && !sources.has(c.sourceId)) problems.push("unknown evidence id");
    if (c.status === "supported" && !c.sourceId) problems.push("support without evidence");
  }
  if ((j.inventedFacts === true || j.speakingForOwner === true) &&
      !j.claims.some((c: any) => ["unsupported", "contradicted"].includes(c.status)))
    problems.push("violation without cited owner-card evidence");
  if (j.inventedFacts === false && j.claims.some((c: any) => ["unsupported", "contradicted"].includes(c.status)))
    problems.push("false clean verdict contradicts its own unsupported claim");
  // Known failure from the prior Mini trial: negative action is still a fact.
  const quotedMeanings = reference.ownerEvidence.map((e: any) => e.meaning).join("\n");
  const restartAmbiguous = !/explicitly.*(?:reboot|restart)|reboot.*explicitly/i.test(quotedMeanings);
  if (normalized.type !== "choice" && restartAmbiguous &&
      normalized.cards.some((c: any) => /\bI (?:have(?:n't| not)|haven't|did(?:n't| not)) (?:reboot|restart)/i.test(c.en)) &&
      j.inventedFacts === false) problems.push("source audit: unsupported negative reboot overlooked");
  return problems;
}
