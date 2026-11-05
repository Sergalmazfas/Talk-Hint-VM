import { secretaryPlanFromInstruction } from "../../shared/callPlan";

export type VmTurn = { role: "agent" | "user"; content: string };
/** Announcement evidence, not a guess based on a long pause or a person's request. */
export function voicemailAnnouncement(text: string) {
  return /(?:your call has been forwarded|(?:at|after) the (?:tone|beep)|(?:person|subscriber) (?:you(?:'re| are) trying to reach|you have called).*(?:not available|unavailable)|please (?:record|leave) (?:your |a )?(?:message|name)|(?:mailbox|voice ?mail).*(?:unavailable|message)|после (?:звукового )?сигнала|абонент.*(?:недоступен|сообщени))/i.test(text);
}
export function voicemailTurn(turns: VmTurn[]) {
  const last = [...turns].reverse().find(t => t.role === "user");
  return !!last && voicemailAnnouncement(last.content);
}
export function voicemailPolicy(instruction: string): string {
  const mode = voicemailChoice(instruction);
  return "VOICEMAIL (not IVR): wait until the machine announcement ends and the beep, or silence after it. " +
    "Do not talk over an announcement. If a human returns, resume the ordinary checklist. " +
    (mode === "skip" ? "Owner chose skip: no speech or task details; the server ends without waiting for the IVR or a model." :
      mode === "leave" ? "Owner chose leave: ONE message containing only authorized SAY items permitted by disclosurePolicy, no ASK questions; replace questions with a brief promise that the confirmed owner will follow up if a receipt or answers are needed." :
        "No owner voicemail decision: ONE short callback request to the confirmed owner, NO task details or facts.") +
    " Before speaking, call prepare_call_end(reason=follow_up, farewell=the ENTIRE exact single message including goodbye). Speak that message ONCE after the tool returns; no separate introduction, filler or second goodbye." +
    " ASK items are not applicable to voicemail, not unanswered. Message delivery is not proof of receipt, agreement, resolution or payment.";
}
export function voicemailChoice(instruction: string): "leave" | "skip" | undefined {
  try {
    const raw = JSON.parse(instruction.slice(instruction.indexOf("\n") + 1));
    const plan = secretaryPlanFromInstruction(instruction, raw.targetPhone);
    if (plan?.voicemail) return plan.voicemail;
    // Old connectors put an explicit skip prohibition into sayAsk, not voicemail.
    // Never infer permission to disclose/leave a message from checklist text.
    const restrictions = [...(plan?.sayAsk ?? []), ...(plan?.disclosurePolicy.forbidden ?? [])].join("\n");
    if (/(?:voicemail\s*(?:=|:)?\s*skip|skip\s+(?:the\s+)?voicemail|(?:do not|don't|never)\s+leave\s+(?:a\s+)?(?:voicemail|message)|не\s+оставля(?:ть|й|йте)\s+(?:голосов[а-яё ]*|сообщени[а-яё]*)|автоответчик[^\n]{0,50}(?:не оставля|пропуст))/i.test(restrictions)) return "skip";
  } catch { /* Legacy/no decision: no disclosure by default. */ }
}
export function voicemailMessageLeft(instruction: string, turns: Array<{ role?: string; speaker?: string; text?: string }>) {
  if (voicemailChoice(instruction) === "skip") return false;
  let announcement = -1, speech = -1;
  turns.forEach((t, i) => {
    if (/^(guest|user|caller|human)$/i.test(t.role ?? t.speaker ?? "")) {
      if (voicemailAnnouncement(t.text ?? "")) announcement = i;
      else if ((t.text ?? "").trim()) announcement = -1; // human returned, not voicemail
    } else if (/^(secretary|agent|assistant|katya|катя)$/i.test(t.role ?? t.speaker ?? "") && t.text?.trim()) speech = i;
  });
  return announcement >= 0 && speech > announcement;
}
export function voicemailWasSkipped(instruction: string, turns: Array<{ role?: string; speaker?: string; text?: string }>) {
  const last = [...turns].reverse().find(t => /^(guest|user|caller|human)$/i.test(t.role ?? t.speaker ?? ""));
  return voicemailChoice(instruction) === "skip" && !!last && voicemailAnnouncement(last.text ?? "");
}
