import { voicemailAnnouncement } from "./voicemail";
import { humanOpening, machineOpening } from "./opening";
import { menuChoices } from "./ivr";
export type NoHumanReason = "voicemail_skip" | "no_human_20s" | "no_speech_45s";
/** Per telephone connection, not per app session. ASR repetition is not progress. */
export class PhoneLineGuard {
  private timer?: ReturnType<typeof setTimeout>;
  private vmTimer?: ReturnType<typeof setTimeout>;
  private finished = false;
  private menus = new Set<string>();
  private heardSpeech = false;
  private attemptedMenu = false;
  voicemail = false;
  constructor(private skip: boolean, private end: (reason: NoHumanReason) => void) {
    this.arm("no_speech_45s", 45_000);
  }
  progress(menu: string) {
    if (!this.heardSpeech || !menu || this.menus.has(menu)) return;
    this.attemptedMenu = true;
    this.menus.add(menu);
    this.arm();
  }
  private arm(reason: NoHumanReason = "no_human_20s", ms = 20_000) {
    if (this.finished) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish(reason), ms);
    this.timer.unref();
  }
  observe(text: string, human: boolean, final = false) {
    if (this.finished) return;
    if (!text.trim()) return; // Empty transcript / ringing is not first speech.
    if (!this.heardSpeech) { this.heardSpeech = true; this.arm(); }
    // A recognized menu must get its first navigation attempt before the
    // no-human countdown. The existing overall telephone limit still applies.
    if (!this.attemptedMenu && menuChoices(text).length) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (voicemailAnnouncement(text)) {
      if (!this.voicemail && !this.timer) this.arm();
      this.voicemail = true;
      if (this.skip && !this.vmTimer) {
        this.vmTimer = setTimeout(() => this.finish("voicemail_skip"), 1500);
        this.vmTimer.unref();
      }
    } else if (human && !machineOpening(text) && (final || humanOpening(text))) {
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
