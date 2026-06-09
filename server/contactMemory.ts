// Pure helpers for the Contact Memory feature, extracted so they can be unit
// tested without pulling in the websocket server's heavy dependency graph
// (Deepgram, the pg pool, the ./index server bootstrap, etc.).
//
// Three rules live here, each easy to regress:
//   1. formatContactMemory  — render a saved row into the CONTACT_CONTEXT block.
//   2. deriveOtherPartyPhone — pick the OTHER party's phone from a call record
//      (outgoing -> toNumber, incoming -> fromNumber), skipping "client:"
//      identities and anything that is not an E.164 (+) number.
//   3. buildContextSections  — assemble the USER_CONTEXT + CONTACT_CONTEXT prompt
//      blocks in the correct order (USER_CONTEXT first, CONTACT_CONTEXT after).

export interface ContactMemoryFields {
  summary?: string | null;
  notes?: string | null;
  importance?: string | null;
  lastCallAt?: Date | string | null;
}

// Render a saved contact_memory row into the CONTACT_CONTEXT prompt block text.
export function formatContactMemory(mem: ContactMemoryFields): string {
  const parts: string[] = [];
  if (mem.lastCallAt) parts.push(`Last call: ${new Date(mem.lastCallAt).toISOString().slice(0, 10)}`);
  if (mem.importance && mem.importance.trim()) parts.push(`Importance: ${mem.importance.trim()}`);
  if (mem.summary && mem.summary.trim()) parts.push(`Summary: ${mem.summary.trim()}`);
  if (mem.notes && mem.notes.trim()) parts.push(`Notes: ${mem.notes.trim()}`);
  return parts.join("\n");
}

export interface CallDirectionFields {
  direction?: string | null;
  toNumber?: string | null;
  fromNumber?: string | null;
}

// The other party's phone comes from the call record: for outbound it's the
// dialed number (toNumber), for inbound it's the caller (fromNumber) — never the
// user's own Twilio number, and never a "client:" identity. Returns null when
// there is no usable E.164 (+) number.
export function deriveOtherPartyPhone(call: CallDirectionFields): string | null {
  const phone = call.direction === "outgoing" ? call.toNumber : call.fromNumber;
  if (!phone || phone.startsWith("client:") || !phone.startsWith("+")) {
    return null;
  }
  return phone;
}

// USER_CONTEXT prompt block (about the TalkHint user being assisted).
export function buildUserContextSection(userContext: string): string {
  return userContext && userContext.trim()
    ? `\n\nUSER_CONTEXT (about the user you are assisting — use it to adapt your suggestions to their profession, business, goals, and tone; never read it aloud or expose it to the guest):\n${userContext.trim()}\n`
    : "";
}

// CONTACT_CONTEXT prompt block (history about THIS specific caller).
export function buildContactContextSection(contactContext: string): string {
  return contactContext && contactContext.trim()
    ? `\n\nCONTACT_CONTEXT (history about THIS specific caller from prior calls — what they wanted, what was agreed, notes, and how important they are; use it for continuity and to reference past agreements; never read it aloud or expose it to the guest):\n${contactContext.trim()}\n`
    : "";
}

// Assemble the two context blocks in their canonical order: USER_CONTEXT first,
// then CONTACT_CONTEXT immediately after it.
export function buildContextSections(userContext: string, contactContext: string): string {
  return buildUserContextSection(userContext) + buildContactContextSection(contactContext);
}

// ---------------------------------------------------------------------------
// Post-call summarization: turn a finished transcript into durable contact
// memory. The model call and the storage write are injected (see
// SummarizeAndSaveDeps) so the orchestration can be unit tested without a live
// OpenAI/Gemini call or a Postgres connection.
// ---------------------------------------------------------------------------

export const CONTACT_SUMMARY_SYSTEM_PROMPT = `You summarize a finished phone call into durable memory about the OTHER party (the contact), for use as context on future calls. Be concise and factual. Do not invent facts not present in the transcript.

Return JSON only, no markdown:
{"summary":"1-3 sentences: who the contact is and what this call was about / what they wanted",
 "notes":"key facts, preferences, and any agreements or next steps (short)",
 "importance":"low|medium|high"}`;

// Flatten a transcript into the "Speaker: text" block fed to the model, capped
// at 6000 chars to bound prompt size.
export function buildTranscriptConvo(transcript: { speaker: string; text: string }[]): string {
  return transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n").slice(0, 6000);
}

export function buildContactSummaryUserPrompt(convo: string): string {
  return `Call transcript (Owner = the TalkHint user, Guest = the contact):\n${convo}`;
}

export interface ParsedContactSummary {
  summary: string;
  notes: string;
  importance: string;
}

// Pure parse + normalize of the model's summary output. Returns null when the
// output has no JSON object, can't be parsed as JSON, or yields neither a
// summary nor notes. `importance` is lower-cased/trimmed and constrained to
// low|medium|high, defaulting to "medium" for anything else.
export function parseContactSummary(raw: string): ParsedContactSummary | null {
  const match = raw?.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const notes = typeof parsed.notes === "string" ? parsed.notes.trim() : "";
  const importanceRaw =
    typeof parsed.importance === "string" ? parsed.importance.toLowerCase().trim() : "";
  const importance = ["low", "medium", "high"].includes(importanceRaw) ? importanceRaw : "medium";

  if (!summary && !notes) return null;

  return { summary, notes, importance };
}

export interface ContactMemorySaveInput {
  userId: string;
  phoneNumber: string;
  summary: string | null;
  notes: string | null;
  importance: string;
  lastCallAt: Date;
}

export interface SummarizeAndSaveDeps {
  // Run the summarization model. Receives the system + user prompts and returns
  // the raw model text. Implementations encapsulate provider routing/fallback.
  generate: (systemPrompt: string, userPrompt: string) => Promise<string>;
  // Persist the normalized memory row.
  save: (input: ContactMemorySaveInput) => Promise<unknown>;
  // Optional structured logging hook (no-op when omitted).
  log?: (message: string) => void;
  // Optional clock injection for deterministic tests.
  now?: () => Date;
}

// After a call ends, summarize the transcript and upsert the contact's memory.
// Designed to run detached from call teardown — it never throws out of the
// generate/parse/save path. Skips work when the transcript is empty, when the
// model output is unusable, or when the parsed summary has no content.
export async function summarizeAndSaveContactMemory(
  userId: string,
  phoneNumber: string,
  transcript: { speaker: string; text: string }[],
  deps: SummarizeAndSaveDeps,
): Promise<void> {
  const convo = buildTranscriptConvo(transcript);
  if (!convo.trim()) return;

  let raw = "";
  try {
    raw = await deps.generate(CONTACT_SUMMARY_SYSTEM_PROMPT, buildContactSummaryUserPrompt(convo));
  } catch (err: any) {
    deps.log?.(`[ContactMemory] summarization failed: ${err?.message ?? err}`);
    return;
  }

  const parsed = parseContactSummary(raw);
  if (!parsed) {
    deps.log?.(`[ContactMemory] no usable summary in model output for ${phoneNumber}`);
    return;
  }

  try {
    const saved = await deps.save({
      userId,
      phoneNumber,
      summary: parsed.summary || null,
      notes: parsed.notes || null,
      importance: parsed.importance,
      lastCallAt: (deps.now ?? (() => new Date()))(),
    });
    if (saved) {
      deps.log?.(`[ContactMemory] saved memory for ${phoneNumber} (importance=${parsed.importance})`);
    }
  } catch (err: any) {
    deps.log?.(`[ContactMemory] save failed: ${err?.message ?? err}`);
  }
}
