/** Deterministic preparation only: preserve facts, never invent an answer. */
export function splitCallChecklist(items: readonly string[]): string[] {
  return items.flatMap(item => item.split(new RegExp(String.raw`(?:\r?\n)+|(?<=[!?;])\s+|(?<=\.)\s+(?=\p{Lu})|,\s+(?=(?:and\s+)?(?:brands?|price|total|availability|earliest|when|whether|what|which|how|марк[ауи]|цен[ауые]|наличи[ея]|когда|сколько|стоимост[ьи])(?=[\s:,.!?;]|$))|\s+and\s+(?=(?:ask|confirm|find out)\b)`, "giu")))
    // Keep the literal prefix too: "- 150" can be a negative amount, not a bullet.
    .map(item => item.trim()).filter(Boolean);
}
export const SECRETARY_CHECKLIST_POLICY = `During the human conversation, follow the authorized checklist; keep a private per-item answer/closed state.
Ask ONE question per turn (at most two short closely related questions). Never ask an answered item again.
An explicit "I don't know" closes that item as unknown, not as success. Recheck a number only when evidence contradicts it.
Use Thank you/Got it at most once per three substantive secretary turns. When all items are closed, prepare_call_end and say its ONE supplied thank-you/farewell phrase: no recap or "Is that right?".
Checklist completion permits the existing end preparation, not immediate hangup. New speech cancels preparation.
Never end during IVR, hold, transfer or silence. Facts, permissions, safety and required introduction are unchanged.`;
