// PREPARE stage (Task #183): pre-call preparation chat.
//
// Provider policy v1 (fixed by the owner):
// - ONE brain: OpenAI GPT-5.6 Sol via /v1/responses. No silent fallback —
//   if Sol is unavailable the user gets an honest error, never another model.
// - One conversation state per user for all turns until the goal is confirmed.
// - Voice input uses OpenAI gpt-4o-transcribe (accuracy-first, batch) — see
//   /api/prepare/stt in routes.ts. Deepgram stays live-call only.

export const PREPARE_MODEL = "gpt-5.6-sol";

// Fixed system prompt (owner-approved wording; do not tweak casually).
export const PREPARE_SYSTEM_PROMPT = `You are TalkHint Call Preparation Assistant.

Your job is to understand what the user wants to accomplish in an upcoming phone conversation.

The user may speak in Russian, English, Spanish, or mix languages in the same message. Understand the meaning without requiring a language mode.

Respond primarily in the user's native/current language. Use English when proposing phrases the user may say during the call.

STATE MACHINE — follow strictly:
USER_PROBLEM -> AI_ALIGNMENT -> USER_CONFIRMATION/CLARIFICATION -> PROPOSED_GOAL -> (user confirms) -> OPENING_PHRASE.

After the user's first substantive description you MUST NOT propose a goal yet, even if the situation seems completely clear. Your first reply is ALWAYS an alignment turn: a short, natural message in the user's language where you restate in your own words how you understood the situation, and either ask the ONE most useful question or offer a priority between options. This is not a questionnaire: at most 1-2 alignment/clarification turns in the entire preparation.

Starting from the user's second message, proposing the goal is allowed but not required: if the user's answer created a new substantial uncertainty, you may make one second (and final) alignment turn before proposing the goal.

Never invent facts.

Internally distinguish: confirmed facts, problem, desired outcome, constraints, fallback options, unknowns.

When enough information is available, propose a concise call goal in 2-4 sentences.

The goal must state the concrete desired OUTCOME the user is trying to achieve (what should happen with the money / the case), never a vague topic or process like "find out the status of the request" or "clarify the timeline". Good example: "Get the payments already made counted toward the mandatory August payment; if that is impossible, find out why and secure a refund or another solution that keeps the payment plan intact."

The goal is not active until the user explicitly confirms it.

After confirmation, produce one short, natural opening phrase in American English and its translation into the user's language.

Keep the conversation concise and practical. Your purpose is to prepare the user for the call, not to teach English or conduct the live call.`;

// Output contract appended to every request so replies are machine-readable.
const REPLY_FORMAT_RULES = `

OUTPUT FORMAT — reply ONLY with a single JSON object, no markdown fences:
{"reply": "<your conversational message to the user, in their language>",
 "proposed_goal": "<the concise 2-4 sentence call goal WHEN you are proposing one for confirmation, otherwise empty string>"}
Put clarifying questions inside "reply". Only fill "proposed_goal" when you are ready to propose the goal; the same goal text must NOT be duplicated inside "reply".`;

const OPENING_FORMAT_RULES = `

The user just CONFIRMED the call goal. Now produce the opening phrase.
OUTPUT FORMAT — reply ONLY with a single JSON object, no markdown fences:
{"opening_phrase_en": "<one short, natural opening phrase in American English>",
 "translation": "<its translation into the user's language>"}`;

export interface PrepareTurn {
  role: "user" | "assistant";
  content: string;
}

export interface PrepareReply {
  reply: string;
  proposedGoal: string | null;
}

export interface OpeningPhrase {
  phraseEn: string;
  translation: string;
}

// Honest, user-facing failure. The message is safe to show verbatim.
export class PrepareUnavailableError extends Error {}

// One conversation per user, kept until the goal is confirmed (then cleared).
const prepareStates = new Map<string, PrepareTurn[]>();
// Epoch per user: bumped on every reset so in-flight requests can detect that
// their conversation was cleared and must not commit stale history.
const prepareEpochs = new Map<string, number>();
// Per-user serialization: PREPARE turns must commit in order (double-send,
// second tab). Each op chains onto the previous one.
const prepareQueues = new Map<string, Promise<unknown>>();

export function getPrepareHistory(userId: string): PrepareTurn[] {
  let s = prepareStates.get(userId);
  if (!s) { s = []; prepareStates.set(userId, s); }
  return s;
}

export function clearPrepareState(userId: string | undefined) {
  if (!userId) return;
  prepareStates.delete(userId);
  prepareEpochs.set(userId, (prepareEpochs.get(userId) ?? 0) + 1);
}

function runSerialized<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = prepareQueues.get(userId) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run regardless of the previous op's outcome
  prepareQueues.set(userId, next.catch(() => {}));
  return next;
}

const MAX_TURNS = 40; // safety bound; PREPARE dialogs are short by design

async function callSol(instructions: string, history: PrepareTurn[], timeoutMs = 45_000): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new PrepareUnavailableError("Подготовка недоступна: не настроен ключ OpenAI.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PREPARE_MODEL,
        instructions,
        input: history.map((t) => ({ role: t.role, content: t.content })),
        max_output_tokens: 1200,
      }),
      signal: controller.signal,
    });
  } catch (e: any) {
    throw new PrepareUnavailableError(
      e?.name === "AbortError"
        ? "Модель подготовки (GPT-5.6 Sol) не ответила вовремя. Попробуйте ещё раз."
        : "Не удалось связаться с моделью подготовки (GPT-5.6 Sol). Попробуйте ещё раз.");
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.error(`[Prepare] Sol HTTP ${resp.status}: ${body.slice(0, 300)}`);
    throw new PrepareUnavailableError(`Модель подготовки (GPT-5.6 Sol) сейчас недоступна (HTTP ${resp.status}). Никакая другая модель не подставляется — попробуйте позже.`);
  }
  const data = await resp.json() as any;
  // Responses API: output[] -> message items -> content[] -> output_text parts.
  const text = (data.output ?? [])
    .filter((o: any) => o.type === "message")
    .flatMap((o: any) => o.content ?? [])
    .filter((c: any) => c.type === "output_text")
    .map((c: any) => c.text)
    .join("")
    .trim();
  if (!text) {
    console.error("[Prepare] Sol returned empty output:", JSON.stringify(data).slice(0, 300));
    throw new PrepareUnavailableError("Модель подготовки вернула пустой ответ. Попробуйте ещё раз.");
  }
  return text;
}

function parseJsonLoose(text: string): any {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

/// One PREPARE turn: user's message in, Sol's reply (+ optional proposed goal) out.
/// Serialized per user; commits history atomically only after Sol succeeds and
/// only if the conversation wasn't reset (epoch check) while awaiting.
export function prepareMessage(userId: string, text: string): Promise<PrepareReply> {
  return runSerialized(userId, async () => {
    const epoch = prepareEpochs.get(userId) ?? 0;
    const history = getPrepareHistory(userId);
    const request = [...history, { role: "user", content: text } as PrepareTurn];
    const raw = await callSol(PREPARE_SYSTEM_PROMPT + REPLY_FORMAT_RULES, request);
    if ((prepareEpochs.get(userId) ?? 0) !== epoch) {
      throw new PrepareUnavailableError("Подготовка была сброшена. Начните заново.");
    }
    const parsed = parseJsonLoose(raw);
    const reply = typeof parsed?.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : raw;
    let proposedGoal = typeof parsed?.proposed_goal === "string" && parsed.proposed_goal.trim()
      ? parsed.proposed_goal.trim() : null;
    // DETERMINISTIC GATE (183.1): on the FIRST user turn a goal proposal is
    // forbidden no matter what the model decided — the model's "I already
    // understood everything" cannot be trusted. The first reply must be an
    // alignment exchange; a goal is allowed from the second user turn on
    // (allowed, not required — a second and final alignment turn is fine).
    const isFirstUserTurn = history.filter((t) => t.role === "user").length === 0;
    let storedRaw = raw;
    if (isFirstUserTurn && proposedGoal) {
      console.warn("[Prepare] Suppressed premature goal on first user turn");
      proposedGoal = null;
      // Sanitize what we store so the model doesn't believe it already
      // proposed this goal in a later turn.
      storedRaw = JSON.stringify({ reply, proposed_goal: "" });
    }
    // Atomic commit of both turns; failure above leaves history untouched.
    const live = getPrepareHistory(userId);
    live.push({ role: "user", content: text }, { role: "assistant", content: storedRaw });
    if (live.length > MAX_TURNS) live.splice(0, live.length - MAX_TURNS);
    return { reply, proposedGoal };
  });
}

/// After the user confirms the goal: same Sol, same conversation -> opening phrase.
export function prepareOpeningPhrase(userId: string, confirmedGoal: string): Promise<OpeningPhrase> {
  return runSerialized(userId, async () => {
    const history = getPrepareHistory(userId);
    const request = [...history, { role: "user", content: `I confirm this call goal: "${confirmedGoal}"` } as PrepareTurn];
    const raw = await callSol(PREPARE_SYSTEM_PROMPT + OPENING_FORMAT_RULES, request);
    const parsed = parseJsonLoose(raw);
    if (!parsed || typeof parsed.opening_phrase_en !== "string" || !parsed.opening_phrase_en.trim()) {
      console.error("[Prepare] Unparseable opening phrase:", raw.slice(0, 200));
      // History untouched — the user can retry the confirmation cleanly.
      throw new PrepareUnavailableError("Не удалось получить первую фразу. Попробуйте подтвердить цель ещё раз.");
    }
    // Goal confirmed and opening delivered — preparation is done.
    clearPrepareState(userId);
    return {
      phraseEn: parsed.opening_phrase_en.trim(),
      translation: typeof parsed.translation === "string" ? parsed.translation.trim() : "",
    };
  });
}
