import type { EngineStream, SpokenTurn } from "../secretary/conversationEngine";

/** Only injected by the dev-C rehearsal binding. Never a telephone/default prompt. */
export const DEV_C_MANNERS = `
DEV-C REHEARSAL MANNERS, subordinate to identity, safety, plan and IVR rules:
The microphone is the seller. Reply only to a completed phrase addressed to Katya.
Do not complete the seller's sentence or speak fragments such as "New,", "New tires," or "Okay. What".
When the seller talks to a colleague, stay silent; do not mine that conversation for questions to you.
The transport says ONE "Sure, take your time"/"Конечно, жду" on an explicit wait, then owns silence/timers.
Answer "you there", "hello", "are you there", "ты здесь", "вы здесь", "слышишь", "здесь?",
and Katya/Kate/Катя/Кать/Катюш; a short return plus verified 1.2s silence also releases waiting.
For a missing owner fact, acknowledge the omission ONCE, then ask a useful clarifying question.
If the seller actually offered two options, say once "He didn't mention — could you give me the price for both options?"
(RU: "Он не уточнил — подскажите цену обоих вариантов?"). Do not invent options or an owner fact.
Use the actual owner name instead of a gendered pronoun when needed; never infer gender.
Do not keep repeating "I don't know" or the omission acknowledgement; use the transcript to remember it.
Answer a seller's question directly, never start that answer with "Got it".
Close with ONE thank-you/farewell, not a second Thank you or a recap. Do not repeat a farewell already spoken.
`;
const providerTextSeen = new WeakSet<AbortSignal>();
export const devProviderHasText = (signal: AbortSignal) => providerTextSeen.has(signal);

export function devQuestion(turns: SpokenTurn[]) {
  const last = turns.filter(t => t.role === "user").at(-1)?.content.trim() ?? "";
  return /\?/.test(last) || /^(?:what|which|how|when|where|why|do|did|can|could|are|is)\b|^(?:сколько|како[йе]|когда|где|почему|вы|ты)(?=\s|$)/i.test(last);
}
export function devColleagueSpeech(text: string) {
  const s = text.trim().toLowerCase();
  return /^(?:tell|ask)\s+(?:kate|katya)\b|^(?:i (?:told|asked)|я (?:сказал|спросил))\b/i.test(s) ||
    new RegExp("^(?!(?:катя|кать|катюш(?:а)?|katya|kate|hello|hi|hey|привет|здравствуйте|да|ну|хорошо)[,:])(?:hey\\s+)?[\\p{L}-]+[,!:]\\s*(?:check|look|bring|give|tell|ask|посмотри|проверь|принеси|дай|скажи|спроси)(?:\\s|$)", "u").test(s);
}
const unknown = /\b(?:i (?:don't|do not) know|he didn't mention|she didn't mention)\b|(?:он|она) не (?:уточнил[аи]?|сказал[аи]?)/i;
const gratitudeOnly = /^(?:thank you(?: very much)?(?: for (?:your (?:time|help)|checking|waiting))?|thanks(?: a lot)?|спасибо(?: большое)?)[.! ]*$/i;
const farewellOnly = /^(?:goodbye|bye(?: bye)?|до свидания|всего доброго)[.! ]*$/i;

/** Preserve numbers/facts; remove only disallowed filler, duplicate thanks and unfinished tails. */
export function cleanDevReply(text: string, question: boolean, heard: string[]): string {
  let value = text.trim();
  if (question) value = value.replace(/^got it[.!,:;\s—-]*/i, "");
  if (heard.some(t => unknown.test(t)))
    value = value.replace(/^(?:I (?:don't|do not) know|(?:He|She) didn't mention|(?:Он|Она) не уточнил[аи]?)(?:\s*[.!—,:;-]\s*|$)/i, "");
  // Decimal dots are not sentence boundaries: never turn $207.57 into $207.
  const parts = (value.match(/.+?(?:[.!?]+(?=\s|$)|$)/g) ?? []).filter(Boolean);
  const unfinished = (s: string) => /[,;:—-]\s*$/.test(s) ||
    /^(?:okay[.! ]*)?(?:what|which|and|but)\s*$/i.test(s.trim());
  if (parts.length && unfinished(parts.at(-1)!)) {
    parts.pop();
    while (parts.length && /^(?:okay|got it)[.! ]*$/i.test(parts.at(-1)!.trim())) parts.pop();
  }
  const alreadyClosed = heard.some(t => /\b(?:goodbye|bye)\b|до свидания|всего доброго/i.test(t));
  let thanked = false, closed = false;
  const kept = parts.filter(part => {
    if (farewellOnly.test(part.trim())) {
      if (alreadyClosed || closed) return false;
      closed = true; return true;
    }
    if (!gratitudeOnly.test(part.trim())) return true;
    if (alreadyClosed || thanked) return false;
    thanked = true; return true;
  });
  value = kept.join("").trim();
  return value;
}

/** Buffer a bounded reply to completion, never speak an abandoned generation's prefix.
 * This adds model-completion wait before speech in this Dev experiment; no speed claim.
 * Actual usage chunks pass through unchanged; no automatic retry or extra paid request.
 */
export function devMannersStream(stream: EngineStream): EngineStream {
  return async function* (request) {
    let text = "";
    const heard = request.input.filter(t => t.role === "assistant").map(t => typeof t.content === "string" ? t.content : "");
    const users: SpokenTurn[] = request.input.filter(t => t.role === "user").map(t => ({
      role: "user", content: typeof t.content === "string" ? t.content : "",
    }));
    for await (const chunk of stream(request)) {
      if (request.signal.aborted) return;
      if (chunk.type === "text") {
        if (chunk.text.trim()) providerTextSeen.add(request.signal);
        text += chunk.text;
        if (text.length > 16000) throw Error("DEV_REHEARSAL_REPLY_TOO_LONG");
      } else if (chunk.type === "complete") {
        const reply = cleanDevReply(text, devQuestion(users), heard);
        if (reply) yield { type: "text" as const, text: reply };
        yield chunk;
      } else yield chunk;
    }
  };
}
