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
  name?: string | null;
  summary?: string | null;
  notes?: string | null;
  importance?: string | null;
  lastCallAt?: Date | string | null;
}

// Render a saved contact_memory row into the CONTACT_CONTEXT prompt block text.
export function formatContactMemory(mem: ContactMemoryFields): string {
  const parts: string[] = [];
  if (mem.name && mem.name.trim()) parts.push(`Name: ${mem.name.trim()}`);
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

// STATIC_CARDS prompt block (the user's reusable project/company knowledge
// cards). `staticCards` is the pre-rendered, size-capped card text produced by
// formatStaticCards(). Empty string when the user has no cards.
// User-confirmed preparation from a tutor practice session. The block itself
// (already formatted upstream) flags uncertain facts explicitly.
export function buildTutorMemorySection(tutorMemory: string): string {
  return tutorMemory && tutorMemory.trim()
    ? `\n\n${tutorMemory.trim()}\n`
    : "";
}

export function buildStaticCardsSection(staticCards: string): string {
  return staticCards && staticCards.trim()
    ? `\n\nSTATIC_CARDS (the user's own reusable facts about their projects and business/services — use them to answer questions like "have you done X?" or "what do you charge?" with confidence; never read them aloud verbatim or expose this block to the guest):\n${staticCards.trim()}\n`
    : "";
}

// ---------------------------------------------------------------------------
// Context provider seam.
//
// The live-hint prompt is assembled from an ORDERED list of context providers
// rather than hard-coded concatenation. Each provider turns its input into a
// prompt section; the chain renders them in the canonical order:
//
//   USER_CONTEXT -> CONTACT_CONTEXT -> STATIC_CARDS -> (anti-loop rules)
//
// A future "Searchable Knowledge" provider (OpenAI File Search / pgvector /
// Pinecone, etc.) for large documents/catalogs is a SEPARATE, later Enterprise
// module. It slots in here as one more provider AFTER STATIC_CARDS and BEFORE
// the anti-loop rules — append it to the array below without touching the hint
// generator. Static Cards stay the lightweight, always-on layer; Searchable
// Knowledge must NOT be implemented here.
// ---------------------------------------------------------------------------

export interface LiveHintContextInputs {
  userContext?: string;
  contactContext?: string;
  staticCards?: string;
  // Pre-formatted, user-CONFIRMED Call Memory from a tutor practice session
  // (see server/tutorStorage.ts formatCallMemoryBlock). Only ever set for the
  // one call it was confirmed for; empty otherwise.
  tutorMemory?: string;
}

interface ContextProvider {
  name: string;
  render: (inputs: LiveHintContextInputs) => string;
}

// Canonical provider order. Future: append a SEARCHABLE_KNOWLEDGE provider after
// STATIC_CARDS (Enterprise module, out of scope here).
const CONTEXT_PROVIDERS: ContextProvider[] = [
  { name: "USER_CONTEXT", render: (i) => buildUserContextSection(i.userContext ?? "") },
  { name: "CONTACT_CONTEXT", render: (i) => buildContactContextSection(i.contactContext ?? "") },
  { name: "STATIC_CARDS", render: (i) => buildStaticCardsSection(i.staticCards ?? "") },
  { name: "TUTOR_MEMORY", render: (i) => buildTutorMemorySection(i.tutorMemory ?? "") },
];

// Assemble all context provider blocks in their canonical order.
export function buildContextProviderChain(inputs: LiveHintContextInputs): string {
  return CONTEXT_PROVIDERS.map((p) => p.render(inputs)).join("");
}

// Backwards-compatible 2-arg assembler (USER_CONTEXT then CONTACT_CONTEXT).
// Prefer buildContextProviderChain for new code so STATIC_CARDS (and future
// providers) are included.
export function buildContextSections(userContext: string, contactContext: string): string {
  return buildContextProviderChain({ userContext, contactContext });
}

// ---------------------------------------------------------------------------
// Static Cards rendering.
//
// Render the user's knowledge cards into a compact, SIZE-CAPPED block grouped
// by type. Cards must arrive already sorted by priority (sortOrder asc, then
// most-recently-updated). The highest-priority cards are included first; once
// the character budget is exhausted the remaining cards are dropped whole —
// never a half-card and never a mid-line break — so card volume can't blow the
// live-hint latency/cost budget.
// ---------------------------------------------------------------------------

// Hard character cap for the rendered STATIC_CARDS block (excluding the prompt
// header). Keeps the injected block small to protect hint latency and cost.
export const MAX_STATIC_CARDS_LENGTH = 1200;

export interface KnowledgeCardLike {
  cardType: string;
  title: string;
  body: string;
}

const CARD_GROUP_LABELS: Record<string, string> = {
  project: "Projects:",
  company: "Company / Services:",
};

// Collapse whitespace/newlines so each card renders as a single tidy line.
function oneLine(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

// Render a set of accepted card lines, grouped by type with section headers, in
// the canonical order (projects first, then company, then any unknown types).
function renderStaticCardGroups(accepted: { cardType: string; line: string }[]): string {
  if (accepted.length === 0) return "";
  const order = ["project", "company"];
  const groups = new Map<string, string[]>();
  for (const item of accepted) {
    if (!groups.has(item.cardType)) groups.set(item.cardType, []);
    groups.get(item.cardType)!.push(item.line);
  }
  const sortedTypes = Array.from(groups.keys()).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
  });
  const sections: string[] = [];
  for (const type of sortedTypes) {
    const label = CARD_GROUP_LABELS[type] ?? `${type}:`;
    sections.push(`${label}\n${groups.get(type)!.join("\n")}`);
  }
  return sections.join("\n\n");
}

export function formatStaticCards(
  cards: KnowledgeCardLike[],
  maxLength: number = MAX_STATIC_CARDS_LENGTH,
): string {
  if (!Array.isArray(cards) || cards.length === 0) return "";

  // Accept cards in the given (priority) order while the *fully rendered* block
  // — including group headers and separators — stays within the character
  // budget. A card is never split; the first card that would overflow stops the
  // scan so lower-priority cards can never jump ahead of a higher-priority one.
  const accepted: { cardType: string; line: string }[] = [];
  let lastRendered = "";
  for (const card of cards) {
    const title = oneLine(card.title);
    if (!title) continue; // a card with no title carries no usable fact
    const body = oneLine(card.body);
    const line = body ? `- ${title} — ${body}` : `- ${title}`;
    const candidate = [...accepted, { cardType: card.cardType, line }];
    const rendered = renderStaticCardGroups(candidate);
    if (rendered.length > maxLength) break; // respect priority: stop at first overflow
    accepted.push({ cardType: card.cardType, line });
    lastRendered = rendered;
  }

  return lastRendered;
}

// ---------------------------------------------------------------------------
// Post-call summarization: turn a finished transcript into durable contact
// memory. The model call and the storage write are injected (see
// SummarizeAndSaveDeps) so the orchestration can be unit tested without a live
// OpenAI/Gemini call or a Postgres connection.
// ---------------------------------------------------------------------------

export const CONTACT_SUMMARY_SYSTEM_PROMPT = `You summarize a finished phone call into durable memory about the OTHER party (the contact), for use as context on future calls. Be concise and factual. Do not invent facts not present in the transcript.

Return JSON only, no markdown:
{"name":"the contact's own name if they clearly state it during the call (e.g. \\"this is John\\"), otherwise empty string. Never guess.",
 "summary":"1-3 sentences: who the contact is and what this call was about / what they wanted",
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
  name: string;
  summary: string;
  notes: string;
  importance: string;
}

// Pure parse + normalize of the model's summary output. Returns null when the
// output has no JSON object, can't be parsed as JSON, or yields neither a
// summary nor notes. `name` is the contact's own name when the model extracted
// one (empty string otherwise). `importance` is lower-cased/trimmed and
// constrained to low|medium|high, defaulting to "medium" for anything else.
// Extracts the first balanced, parseable JSON object from model output.
// Handles markdown code fences, prose before/after the JSON, and multiple
// brace blocks (the old greedy first-{ … last-} regex broke whenever the model
// added any trailing text containing a brace, or wrapped output in prose).
export function extractJsonObject(raw: string): any | null {
  if (!raw) return null;
  const text = raw.replace(/```(?:json)?/gi, "");
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            break; // this candidate is not valid JSON; try the next "{"
          }
        }
      }
    }
  }
  return null;
}

// PII-safe categorization of WHY parseContactSummary returned null. Returns a
// short enum-like string and never any content from the model output itself.
export function classifySummaryParseFailure(raw: string): string {
  if (!raw || !raw.trim()) return "empty_output";
  if (!raw.includes("{")) return "no_json_object"; // prose/refusal, no JSON at all
  const obj = extractJsonObject(raw);
  if (obj === null || typeof obj !== "object") return "unparseable_json";
  return "empty_summary_fields"; // valid JSON but neither summary nor notes
}

export function parseContactSummary(raw: string): ParsedContactSummary | null {
  const parsed = extractJsonObject(raw);
  if (parsed === null || typeof parsed !== "object") return null;

  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const notes = typeof parsed.notes === "string" ? parsed.notes.trim() : "";
  const importanceRaw =
    typeof parsed.importance === "string" ? parsed.importance.toLowerCase().trim() : "";
  const importance = ["low", "medium", "high"].includes(importanceRaw) ? importanceRaw : "medium";

  if (!summary && !notes) return null;

  return { name, summary, notes, importance };
}

export interface ContactMemorySaveInput {
  userId: string;
  phoneNumber: string;
  // Set whenever the model extracted the contact's own name. The upsert applies
  // it atomically via COALESCE — it only fills a missing name and never
  // overwrites one the user (or an earlier call) already set, so there is no
  // read-then-write race here.
  name?: string | null;
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
    // Keep the failure diagnosable WITHOUT leaking transcript-derived content
    // into logs: only safe metadata — output length and a failure category.
    deps.log?.(
      `[ContactMemory] no usable summary in model output for ${phoneNumber} (raw ${raw?.length ?? 0} chars, reason=${classifySummaryParseFailure(raw)})`,
    );
    return;
  }

  // Pass the model-extracted name straight to the upsert. The upsert fills it
  // atomically (COALESCE) — it only writes the name when the contact has none
  // yet and never overwrites a name the user (or an earlier call) already set,
  // so there is no read-then-write race to guard here.
  const nameToSave: string | undefined = parsed.name ? parsed.name : undefined;

  try {
    const input: ContactMemorySaveInput = {
      userId,
      phoneNumber,
      summary: parsed.summary || null,
      notes: parsed.notes || null,
      importance: parsed.importance,
      lastCallAt: (deps.now ?? (() => new Date()))(),
    };
    if (nameToSave !== undefined) input.name = nameToSave;
    const saved = await deps.save(input);
    if (saved) {
      const namePart = nameToSave ? ` name="${nameToSave}"` : "";
      deps.log?.(`[ContactMemory] saved memory for ${phoneNumber} (importance=${parsed.importance})${namePart}`);
    }
  } catch (err: any) {
    deps.log?.(`[ContactMemory] save failed: ${err?.message ?? err}`);
  }
}
