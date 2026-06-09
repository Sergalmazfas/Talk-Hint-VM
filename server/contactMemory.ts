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
