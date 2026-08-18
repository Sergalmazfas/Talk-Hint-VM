// Semantic review judge for the Translator Realtime Spike (spec Section 2).
//
// Classifies each source transcript → translated output pair as:
//   FAITHFUL             — translation preserves meaning, adds nothing;
//   ADDED_CONTENT        — translation contains meaning/fact/intent absent
//                          from the source;
//   UNSOLICITED_RESPONSE — the translator started answering/reacting as a
//                          conversation participant;
//   UNCERTAIN            — cannot reliably judge from available data.
//
// Fail-closed: any turn the judge did not return, or returned with an
// unknown label, is reported as UNCERTAIN — never silently dropped and
// never optimistically counted as FAITHFUL.

import { tlog as log } from "./logger";

export type TurnClassification =
  | "FAITHFUL"
  | "ADDED_CONTENT"
  | "UNSOLICITED_RESPONSE"
  | "UNCERTAIN";

export interface ReviewInputTurn {
  turnIndex: number;
  source: string;
  translation: string;
}

export interface ReviewResult {
  turnIndex: number;
  classification: TurnClassification;
  reason: string;
}

const VALID: TurnClassification[] = [
  "FAITHFUL",
  "ADDED_CONTENT",
  "UNSOLICITED_RESPONSE",
  "UNCERTAIN",
];

export function buildSemanticReviewPrompt(): string {
  return [
    `You are a strict bilingual translation auditor for a live voice interpreter.`,
    `For each numbered turn you get the recognized SOURCE transcript and the interpreter's TRANSLATION output.`,
    `Classify EVERY turn with exactly one label:`,
    ``,
    `FAITHFUL — the translation preserves the source meaning and adds no new content. Minor wording/register differences are fine.`,
    `ADDED_CONTENT — the translation contains a meaning, fact, or intention that is NOT present in the source (invented details, extra sentences, changed intent).`,
    `UNSOLICITED_RESPONSE — the output answers, accepts, declines, congratulates, or otherwise REACTS to the source as a conversation participant instead of translating it (e.g. source is an invitation and the output contains "Sure, I'm coming").`,
    `UNCERTAIN — the source transcript is too garbled/fragmentary to judge faithfully. Do NOT guess.`,
    ``,
    `Rules:`,
    `- Judge only added/changed MEANING, not style.`,
    `- A translated question must remain a question; an answer to it is UNSOLICITED_RESPONSE.`,
    `- If the source is a meaningless fragment (e.g. "bu"), use UNCERTAIN.`,
    `- Respond with ONLY a JSON object: {"results":[{"turnIndex":<n>,"classification":"<label>","reason":"<short reason>"}, ...]} covering every turn.`,
  ].join("\n");
}

export function formatTurnsForReview(turns: ReviewInputTurn[]): string {
  return turns
    .map(
      (t) =>
        `Turn ${t.turnIndex}:\nSOURCE: ${t.source || "(empty)"}\nTRANSLATION: ${t.translation || "(empty)"}`,
    )
    .join("\n\n");
}

/** Fail-closed parse: every input turn gets a result; unknown → UNCERTAIN. */
export function parseSemanticReview(raw: string, inputs: ReviewInputTurn[]): ReviewResult[] {
  let byIndex = new Map<number, { classification?: string; reason?: string }>();
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      for (const r of Array.isArray(parsed.results) ? parsed.results : []) {
        if (typeof r?.turnIndex === "number") byIndex.set(r.turnIndex, r);
      }
    }
  } catch {
    byIndex = new Map();
  }
  return inputs.map((t) => {
    const r = byIndex.get(t.turnIndex);
    const cls = VALID.includes(r?.classification as TurnClassification)
      ? (r!.classification as TurnClassification)
      : "UNCERTAIN";
    return {
      turnIndex: t.turnIndex,
      classification: cls,
      reason:
        r && VALID.includes(r.classification as TurnClassification)
          ? String(r.reason || "")
          : "judge did not return a valid classification for this turn",
    };
  });
}

const JUDGE_MODEL = process.env.TRANSLATOR_REVIEW_MODEL || "gpt-4o";

export async function runSemanticReview(inputs: ReviewInputTurn[]): Promise<ReviewResult[]> {
  if (inputs.length === 0) return [];
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSemanticReviewPrompt() },
        { role: "user", content: formatTurnsForReview(inputs) },
      ],
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`semantic review API error: ${response.status} ${errText.slice(0, 200)}`);
  }
  const data: any = await response.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const results = parseSemanticReview(raw, inputs);
  log(`[TranslatorReview] judged ${results.length} turns with ${JUDGE_MODEL}`, "translator");
  return results;
}
