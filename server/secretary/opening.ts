import { voicemailAnnouncement } from "./voicemail";
type Turn = { role: "agent" | "user"; content: string };
export const machineOpening = (text: string) =>
  /(?:thank you |thanks )?for calling|press\s+(?:\d|one|two|three|four)|para espa[ñn]ol|your call is important|calls? may be recorded|please (?:hold|wait)|благодарим за звонок|нажмите|звонок.*запис|оставайтесь на линии/i.test(text);
const humanOpening = (text: string) =>
  /\bthis is\s+[a-z]+|\b(?:speaking|how (?:can|may) I help|hello|hi there|good morning|good afternoon)\b|здравствуйте|добрый день|слушаю/i.test(text);

/** Session-local gate. A bare "Thank you" cannot turn an announcement into a human.
 * No acoustic claims are inferred from text. Voicemail retains its existing policy. */
export class PhoneOpeningGate {
  live = false;
  heardSpeech = false;
  probed = false;
  private machine = false;
  permit(turns: Turn[]): boolean {
    if (this.live) return true;
    const guest = turns.filter(t => t.role === "user" && t.content.trim());
    this.heardSpeech ||= guest.length > 0;
    const last = guest.at(-1)?.content ?? "";
    if (!last) return false;
    if (voicemailAnnouncement(last)) return true;
    if (machineOpening(last)) { this.machine = true; return false; }
    if (/^(?:thank(?: you)?|thanks|спасибо)[.! ]*$/i.test(last.trim())) {
      this.machine = true; return false;
    }
    if (humanOpening(last) || !this.machine && !/^(?:thank you|thanks|спасибо)[.! ]*$/i.test(last.trim())) {
      this.live = true; return true;
    }
    return false;
  }
  probe(): string | undefined {
    if (this.heardSpeech || this.probed || this.live) return;
    this.probed = true;
    return "Hi, hello?";
  }
}
export const PHONE_OPENING_POLICY = `Opening: wait for the other party's first speech. Never speak over a recorded announcement or IVR.
"Thank you for calling", "press", "para español", "your call is important" and "calls may be recorded" are recordings, NOT human greetings.
Listen and navigate IVR using the existing tools; wait for a live person. A bare "Thank you" is not proof of a person.
When a human greets you (e.g. "Flying J, this is Denise"), give the trusted introduction ONCE; never repeat it.
The transport handles an initial silence probe; do not generate another introduction or "are you still there?" while waiting for a human.`;

/** Retell word clocks are seconds relative to connection. Never substitute model
 * token clocks for sound or claim no overlap when the clocks are missing. */
export function openingTiming(
  turns: { speaker: string; text: string }[], playback: unknown,
) {
  const guests = turns.map((t, index) => ({ ...t, index })).filter(t => t.speaker === "guest").slice(0, 2);
  const fragmented = guests.length === 2 && /^thank you[.! ]*$/i.test(guests[0].text.trim()) &&
    machineOpening(guests.map(t => t.text).join(" "));
  const recordingTurns = guests.filter(t => machineOpening(t.text) || fragmented).map(t => t.index);
  const clocks = Array.isArray(playback) && playback.length === turns.length && playback.every((p, i) =>
    p?.index === i && (p.role === "agent" ? "secretary" : p.role === "user" ? "guest" : "unknown") === turns[i].speaker &&
    typeof p.start === "number" && typeof p.end === "number" &&
    Number.isFinite(p.start) && Number.isFinite(p.end) && p.start >= 0 && p.end >= p.start) ? playback : null;
  const first = clocks ? [...clocks].sort((a, b) => a.start - b.start)[0] : null;
  return {
    source: clocks ? "provider_word_clocks" : "transcript_order_only",
    firstSpeaker: first ? (first.role === "agent" ? "secretary" : "guest") :
      turns.find(t => t.speaker !== "unknown")?.speaker ?? "unknown",
    recordingTurns,
    spokeOverRecording: clocks && recordingTurns.length ? clocks.some(a => a.role === "agent" &&
      recordingTurns.some(i => a.start < clocks[i].end && a.end > clocks[i].start)) : null,
    clockLimit: "Provider word clocks, not independently listened audio. Missing or mismatched clocks = not measured.",
  };
}
