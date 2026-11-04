/** Deterministic preparation only: preserve facts, never invent an answer. */
export function splitCallChecklist(items: readonly string[]): string[] {
  return items.flatMap(item => item.split(new RegExp(String.raw`(?:\r?\n)+|(?<=[!?])\s+|(?<=\.)\s+(?=\p{Lu})`, "gu")))
    // Keep the literal prefix too: "- 150" can be a negative amount, not a bullet.
    .map(item => item.trim()).filter(Boolean);
}
export type ChecklistItemKind = "say" | "ask" | "prohibition" | "unknown";
/** Labels only; never rewrite an owner's item or infer an answer. Ambiguity stays open. */
export function checklistItemKind(item: string): ChecklistItemKind {
  const text = item.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "").replace(/^(?:please|пожалуйста)[,\s]+/i, "");
  if (/^(?:do not|don't|never|no payment|skip voicemail|не\s+(?:бронируй|бронировать|плати|платить|оплачивай|оплачивать|заказывай|заказывать|оставляй|оставлять)|пропусти.*(?:автоответчик|голосов)|запрещено)(?=\s|[,.!;:]|$)/i.test(text))
    return "prohibition";
  const say = /^(?:say|tell|explain|inform|notify|relay|greet|introduce|thank)(?=\s|[,:.!?]|$)|^(?:скажи|сказать|сообщи(?:ть)?|объясни(?:ть)?|передай|передать|уведоми(?:ть)?|поздоровайся|поздороваться|представься|представиться|поблагодари(?:ть)?)(?=\s|[,:.!?]|$)/i;
  const ask = /^(?:ask|confirm|check|clarify|inquire|find out)(?=\s|[,:.!?]|$)|^(?:узнай|узнать|спроси(?:ть)?|уточни(?:ть)?|выясни(?:ть)?|подтверди(?:ть)?|проверь|проверить)(?=\s|[,:.!?]|$)/i;
  // A structurally supplied mixed item remains ONE item, but cannot be closed
  // using just one side of it. Preparation must clarify it, not silently split it.
  const askLater = /(?:[.!?;,]\s+|\s+(?:and|then|и|затем)\s+)(?:ask|confirm|check|clarify|find out|спроси(?:ть)?|уточни(?:ть)?|узнай|узнать|подтверди(?:ть)?)(?=\s|[,:.!?]|$)/i;
  const sayLater = /(?:[.!?;,]\s+|\s+(?:and|then|и|затем)\s+)(?:tell|explain|say|inform|сообщи(?:ть)?|скажи|сказать|объясни(?:ть)?)(?=\s|[,:.!?]|$)/i;
  if (say.test(text)) return askLater.test(text) ? "unknown" : "say";
  if (ask.test(text)) return sayLater.test(text) ? "unknown" : "ask";
  if (/\?\s*$/.test(text)) return "ask";
  return "unknown";
}
export const SECRETARY_CHECKLIST_POLICY = `During the human conversation, follow the authorized checklist; keep a private per-item answer/closed state.
Preserve every structurally supplied sayAsk item as ONE complete thought, in its original order; do not split at commas/semicolons or merge items.
Distinguish SAY from ASK. A SAY item closes only after YOU have actually spoken its full authorized meaning; the guest saying it is not completion.
PROHIBITION is a separate item type: do not perform the forbidden action; it closes only when the full observed call contains no violation. Never ask the guest to perform it or speak it as an instruction.
An ASK item closes only after the GUEST answers (including an explicit unknown); merely asking it is not completion.
Mixed/unclear items remain unverified rather than being declared complete from only one part.
Ask ONE question per turn (at most two short closely related questions). Never ask an answered item again.
An explicit "I don't know" closes that item as unknown, not as success. Recheck a number only when evidence contradicts it.
Use Thank you/Got it at most once per three substantive secretary turns. When all items are closed, prepare_call_end and say its ONE supplied thank-you/farewell phrase: no recap or "Is that right?".
Checklist completion permits the existing end preparation, not immediate hangup. New speech cancels preparation.
Never end during IVR, hold, transfer or silence. Facts, permissions, safety and required introduction are unchanged.`;
