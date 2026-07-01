import { randomUUID } from "crypto";
import type { DialogueEntry, DialogueEntryType } from "@shared/schema";
import { DIALOGUE_ENTRY_TYPES } from "@shared/schema";
import type { GoalType } from "@shared/goalTypes";
import { SLOT_KEYS } from "@shared/goalTypes";
import { LANGUAGE_NAMES } from "@shared/prompts";

// Auto-generation of a per-user, per-goal dialogue library. Takes the user's
// goal + goal type (= domain) + personal context + knowledge cards and produces
// a full library of ready-to-read question→answer lines in ONE structured pass.
// The generated library is the PRIMARY hint source at call time; on a miss the
// runtime falls through to the existing live LLM hint path (unchanged).

// Per-domain generation guidance. The goal TYPE is the domain, so each type
// gets tailored coverage instructions (recruitment/sales/medical-style framing
// falls under the closest goal type below).
const DOMAIN_GUIDANCE: Record<GoalType, string> = {
  booking:
    "Domain: scheduling/booking appointments (e.g. salon, clinic, dispatch, services). Cover greeting, discovering what/when the guest wants, typical questions about availability, hours, location, price, common objections (too expensive, no time, wants to think), clarifying date/time/name/phone, and confirming/closing the booking.",
  pricing:
    "Domain: quoting prices and explaining cost. Cover greeting, discovering scope/needs, typical questions about price, packages, discounts, what's included, objections (too expensive, competitor is cheaper, not sure it's worth it), clarifying the exact service/quantity, and closing with a clear quote.",
  support:
    "Domain: customer support / troubleshooting. Cover greeting, discovering the problem, typical questions about the issue, steps tried, warranty/policy, objections (frustrated, wants refund, been waiting), clarifying details to reproduce/resolve, and closing with a resolution or next step.",
  info:
    "Domain: providing information / answering questions. Cover greeting, discovering what the guest wants to know, typical factual questions, objections/hesitations, clarifying the specific question, and closing by confirming the answer was helpful.",
  negotiation:
    "Domain: negotiating terms/price (e.g. sales, deals, rates). Cover greeting, discovering the guest's position and needs, typical questions about terms, objections (price too high, needs approval, comparing offers) with strong rebuttals, clarifying the sticking points, and closing the deal.",
  other:
    "Domain: general business phone conversation. Cover greeting, discovering the guest's need, typical questions, common objections with rebuttals, clarifying details, and a polite closing.",
};

function buildSystemPrompt(goalType: GoalType, language: string): string {
  const langName = LANGUAGE_NAMES[language] || "Russian";
  return `You build a "dialogue library" for a real-time phone-call assistant. The assistant helps an English-speaking agent (the USER) during live calls: when the guest says something, the assistant shows a ready-to-read reply the user can speak.

${DOMAIN_GUIDANCE[goalType]}

Produce a LARGE library of 80 to 100 entries covering the whole call, distributed across these types:
- "opening": how the user opens/greets (a few entries).
- "discovery": questions the user asks to understand the guest's need.
- "typical": the guest's most common questions, each with the user's ready answer.
- "objection": common guest objections/pushback, each with a strong rebuttal.
- "clarifying": short questions the user asks to nail down missing details.
- "closing": how the user wraps up and confirms next steps.

Each entry MUST be a JSON object with EXACTLY these fields:
- "type": one of ${DIALOGUE_ENTRY_TYPES.map((t) => `"${t}"`).join(", ")}.
- "trigger": the guest's line (question/objection) that this entry answers. For "opening"/"discovery"/"clarifying"/"closing" where the USER speaks first, put a short label of the moment (e.g. "call starts", "need date").
- "variants": an array of 2 to 4 short paraphrases of the trigger (different wordings the guest might use) to improve matching. Empty array is allowed for user-initiated moments.
- "answer": the ready-to-read reply for the USER to speak, in English. Natural, concise (1-2 sentences), specific — use the personal facts provided when relevant.
- "translation": the "answer" translated into ${langName}.
- "slot": the piece of info this line targets, one of ${SLOT_KEYS.map((s) => `"${s}"`).join(", ")}, or null if none.

Rules:
- Personalize answers with the user's real facts (services, prices, projects) when given. Do NOT invent specific prices or facts that aren't provided — keep those answers general.
- Keep every answer something a person can actually say out loud on a call.
- Output ONLY a JSON object of the form {"entries": [ ... ]} with no prose, no markdown, no code fences.`;
}

function buildUserPrompt(goalText: string, userContext: string, cards: string): string {
  const parts: string[] = [];
  parts.push(`GOAL OF THE CALL: ${goalText || "(not specified)"}`);
  if (userContext && userContext.trim()) {
    parts.push(`\nABOUT THE USER (personal context):\n${userContext.trim()}`);
  }
  if (cards && cards.trim()) {
    parts.push(`\nUSER'S KNOWLEDGE CARDS (projects / company / services):\n${cards.trim()}`);
  }
  parts.push(`\nGenerate the full dialogue library now.`);
  return parts.join("\n");
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.DIALOGUE_LIBRARY_MODEL || "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 8000,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`OpenAI dialogue-library error: ${response.status} ${errText.slice(0, 200)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

function isEntryType(v: any): v is DialogueEntryType {
  return typeof v === "string" && (DIALOGUE_ENTRY_TYPES as readonly string[]).includes(v);
}

// Parse the model's JSON reply into clean, id-stamped DialogueEntry objects.
// Anything malformed is dropped rather than throwing, so a partial reply still
// yields a usable library.
export function parseDialogueEntries(raw: string): DialogueEntry[] {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
  const list: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : [];
  const slotSet = new Set<string>(SLOT_KEYS as string[]);
  const out: DialogueEntry[] = [];
  list.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const type: DialogueEntryType = isEntryType(item.type) ? item.type : "typical";
    const trigger = typeof item.trigger === "string" ? item.trigger.trim() : "";
    const answer = typeof item.answer === "string" ? item.answer.trim() : "";
    if (!answer) return;
    const variants = Array.isArray(item.variants)
      ? item.variants.filter((v: any) => typeof v === "string" && v.trim()).map((v: string) => v.trim())
      : [];
    const translation = typeof item.translation === "string" ? item.translation.trim() : "";
    const slot = typeof item.slot === "string" && slotSet.has(item.slot) ? item.slot : null;
    out.push({
      id: randomUUID(),
      type,
      trigger,
      variants,
      answer,
      translation,
      slot,
      sortOrder: i,
    });
  });
  return out;
}

export interface GenerateDialogueLibraryInput {
  goalText: string;
  goalType: GoalType;
  userContext?: string;
  cards?: string;
  language?: string;
}

// Generate the full dialogue library in one structured pass. Returns the parsed
// entries (already id-stamped and ordered). Throws only on an OpenAI transport
// error; a parseable-but-empty reply yields an empty array (caller decides).
export async function generateDialogueLibrary(input: GenerateDialogueLibraryInput): Promise<DialogueEntry[]> {
  const language = input.language || "ru";
  const systemPrompt = buildSystemPrompt(input.goalType, language);
  const userPrompt = buildUserPrompt(input.goalText, input.userContext || "", input.cards || "");
  const raw = await callOpenAI(systemPrompt, userPrompt);
  return parseDialogueEntries(raw);
}
