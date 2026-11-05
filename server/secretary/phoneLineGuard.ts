import { voicemailAnnouncement } from "./voicemail";
import { machineOpening } from "./opening";
export type NoHumanReason = "voicemail_skip" | "no_human_20s";
/** Per telephone connection, not per app session. ASR repetition is not progress. */
export class PhoneLineGuard {
  private timer?: ReturnType<typeof setTimeout>;
  private vmTimer?: ReturnType<typeof setTimeout>;
  private finished = false;
  private menus = new Set<string>();
  voicemail = false;
  constructor(private skip: boolean, private end: (reason: NoHumanReason) => void) {
    this.arm();
  }
  progress(menu: string) {
    if (!menu || this.menus.has(menu)) return;
    this.menus.add(menu);
    this.arm();
  }
  private arm() {
    if (this.finished) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish("no_human_20s"), 20_000);
    this.timer.unref();
  }
  observe(text: string, human: boolean, final = false) {
    if (this.finished) return;
    if (voicemailAnnouncement(text)) {
      if (!this.voicemail && !this.timer) this.arm();
      this.voicemail = true;
      if (this.skip && !this.vmTimer) {
        this.vmTimer = setTimeout(() => this.finish("voicemail_skip"), 1500);
        this.vmTimer.unref();
      }
    } else if (human && !machineOpening(text) && !/^(?:the person|thank you|your call|you have reached)\b/i.test(text) &&
        (final || /\b(?:hello|hi|this is|speaking|how (?:can|may) I help|good morning|good afternoon)\b|здравствуйте|слушаю/i.test(text))) {
      this.voicemail = false;
      if (this.timer) clearTimeout(this.timer);
      if (this.vmTimer) clearTimeout(this.vmTimer);
      this.timer = undefined; this.vmTimer = undefined;
    }
  }
  private finish(reason: NoHumanReason) {
    if (this.finished) return;
    this.close(); this.end(reason);
  }
  close() {
    this.finished = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.vmTimer) clearTimeout(this.vmTimer);
  }
}
