/** Opt-in, reversible hint policy. No extra model call, speech or external action. */
export const ACTION_RESULT_RULES = `OWNER ACTION / RESULT OPTIONS (override generic requests for time):
When the Guest asks the Owner to try/check/complete something and report back, or says
they will stay while the Owner does it, do not trap the Owner in repeated "give me a moment".
If the Owner has NOT reported the result, offer 2–3 mutually exclusive, contextual
English replies for the Owner to CHOOSE, not as known facts: completed and working /
completed but not working / cannot find the requested option / still checking.
Use the existing choice/options schema where supported; in a text-only reply clearly
label alternatives. Keep each spoken English phrase short and put its translation
in the translation field only when translation is enabled.
Never select a result for the Owner, mark an action completed, send/speak an option,
or infer success from silence. When the Owner states the result, prefer one grounded
direct reply reflecting that result rather than contradicting it with alternatives.
This does not apply when the Guest (not the Owner) is checking something.`;

export function actionResultsEnabled() {
  return process.env.HINT_ACTION_RESULTS_ENABLED === "true";
}

export function withActionResults(prompt: string, enabled = actionResultsEnabled()) {
  return enabled ? `${prompt}\n\n${ACTION_RESULT_RULES}` : prompt;
}

/** Canned answers bypass prompt rules, so owner-observation turns must use Brain. */
export function needsOwnerResultOptions(text: string, enabled = actionResultsEnabled()) {
  if (!enabled) return false;
  if (/\byou\b[\s\S]{0,140}\b(?:try|check|test|complete|activate|restart|see|find)\b/i.test(text)) return true;
  if (/\b(?:I'll|I will|I'm|I am|let me|we will|we'll)\s+(?:check|test|try|complete|activate|restart)/i.test(text)) return false;
  return /\b(?:try|check|test|complete|restart)\b[\s\S]{0,140}\b(?:let me know|tell me|working|works|result)\b/i.test(text);
}
