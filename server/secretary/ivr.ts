import { createHash } from "node:crypto";
import type { SpokenTurn } from "./conversationEngine";
import { chooseMenuOption } from "./ivrSelection";

export const IVR_INSTRUCTIONS = `
You have press_digits for IVR MENU NAVIGATION ONLY. Never say you cannot use a keypad.
Listen to the whole menu and wait for its turn to finish; never press during an unfinished menu.
Each new menu is a separate level. Navigate second and later levels using only that current menu.
Choose the closest heard option to the authorized goal. For parking/reservations or reaching a person,
choose general manager or manager when there is no exact option. Do not wait for an exact match.
Never type card, PIN, account, telephone, personal identifiers or other private data.
Use heard_menu as an exact quote of the current menu; menu_complete must be true.
Include a short reason for the selected digit, tied to the authorized task and the heard option.
On a repeated menu without progress say exactly "representative", then use the 0 option.
If uncertain use request_menu_help. Failed or unconfirmed help delivery must not leave a silent wait:
choose a heard manager/operator or repeat-menu option yourself; never wait silently over 3 seconds.
Do not greet, say goodbye, or prepare_call_end to a menu, hold music, transfer or silence.
Use confirm_menu_reached only after hearing a live department answer; quote that answer exactly.
Remembered routes are hints only: validate every step against the current menu, never blindly replay.
Do not claim DTMF was accepted by the destination: a successful tool only confirms command dispatch.
`;

export type MenuStep = { menuHash: string; digits: string };
export type IvrEvent = {
  id: string; at: string; kind: "press" | "observed" | "help" | "reached" | "push_failed";
  heard: string; digits?: string; result: string;
  menuHash?: string; reason?: string; sentAt?: string; afterTurn?: number;
};
export type IvrIO = {
  send: (digits: string, signal?: AbortSignal) => Promise<void>;
  record: (event: IvrEvent) => Promise<void>;
  notify: (menu: string) => Promise<void>;
  remember: (steps: MenuStep[]) => Promise<void>;
};
const words: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", star: "*", pound: "#", hash: "#",
};
const digitToken = "(?:[0-9*#]{1,5}|zero|one|two|three|four|five|six|seven|eight|nine|star|pound|hash)";
const sensitive = /\b(pin|password|passcode|security code|verification code|credit card|debit card|card number|account number|social security|date of birth|zip code|phone number|telephone number|payment)\b/i;
const fingerprint = (text: string) => createHash("sha256").update(text.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex");

/** Only explicit keypad choices become actionable; ordinary conversation is not a menu. */
export function menuChoices(text: string): string[] {
  const result = new Set<string>();
  for (const match of Array.from(text.toLowerCase().matchAll(new RegExp(`(?:\\b(?:press|dial|enter)|нажмите)\\s+(${digitToken})(?![a-z0-9])`, "g"))))
    result.add(words[match[1]] ?? match[1]);
  return Array.from(result);
}

/** Per-call serialized state, not shared with another owner/number/call. */
export class SecretaryIvr {
  private menu = "";
  private hash = "";
  private lastTranscript = "";
  private presses = 0;
  private repeat = false;
  private representativeSpoken = false;
  private pending?: IvrEvent;
  private steps: MenuStep[] = [];
  private sequence = 0;
  private chain = Promise.resolve();
  private active = false;
  private waiting = false;
  private latestGuest = "";
  private helpDelivery = "not_requested";
  private turns: SpokenTurn[] = [];
  private boundary: SpokenTurn[] = [];
  private actionable = false;
  private dispatchedHash = "";
  private helpHash = "";
  constructor(private io: IvrIO, private remembered: MenuStep[] = [], private goal = "") {}
  private event(kind: IvrEvent["kind"], result: string, digits?: string): IvrEvent {
    return { id: `ivr:${++this.sequence}`, at: new Date().toISOString(), kind,
      heard: this.menu.slice(0, 4000), menuHash: this.hash, digits, result };
  }
  blocksEnd() { return this.active || this.waiting; }
  status() {
    return { active: this.active, waiting: this.waiting, menu: this.menu, menuHash: this.hash,
      choices: menuChoices(this.menu), pressesWithoutNewMenu: this.presses, helpDelivery: this.helpDelivery };
  }
  observe(turns: SpokenTurn[]) {
    return this.serial(async () => {
      const encoded = JSON.stringify(turns);
      if (encoded === this.lastTranscript) return;
      this.lastTranscript = encoded;
      this.turns = turns.map(t => ({ ...t }));
      this.latestGuest = [...turns].reverse().find(t => t.role === "user")?.content ?? "";
      const lastAgent = [...turns].reverse().find(t => t.role === "agent");
      if (lastAgent && /\brepresentative\b/i.test(lastAgent.content)) this.representativeSpoken = true;
      const guest: string[] = [];
      for (let i = turns.length - 1; i >= 0 && turns[i].role === "user"; i--) {
        const old = this.boundary[i];
        // Retell can append a new turn OR extend the last existing ASR turn.
        // Content heard before dispatch is never part of the next menu.
        if (i < this.boundary.length - 1) break;
        if (old) {
          if (turns[i].role !== old.role || !turns[i].content.startsWith(old.content)) break;
          guest.unshift(turns[i].content.slice(old.content.length));
          break;
        }
        guest.unshift(turns[i].content);
      }
      const text = guest.join(" ").slice(-4000);
      if (!text) return;
      this.actionable = false;
      if (this.pending) {
        await this.io.record({ ...this.event("observed", menuChoices(text).length ? "new_menu_heard" : "new_speech_heard_not_verified"),
          heard: text, digits: this.pending.digits });
        this.pending = undefined;
      }
      if (!menuChoices(text).length) {
        // Even an unfinished next level must not expose the previous menu as current.
        this.menu = text; this.hash = fingerprint(text);
        return;
      }
      const hash = fingerprint(text);
      this.repeat = hash === this.dispatchedHash && this.presses > 0;
      if (hash !== this.hash) {
        this.waiting = false;
        if (!this.repeat) this.representativeSpoken = false;
      }
      this.menu = text; this.hash = hash; this.active = true;
      this.actionable = true;
    });
  }
  /** Called only for a provider response_required turn, never partial transcript updates. */
  async navigate(signal: AbortSignal) {
    if (!this.active || !this.actionable || this.waiting || this.pending || this.repeat || sensitive.test(this.menu) ||
      /(?:\.{3}|…)\s*$/.test(this.menu)) return false;
    const choice = chooseMenuOption(this.menu, this.goal);
    if (!choice) return false;
    await this.press(choice.digits, this.hash, signal, false, choice.reason);
    return true;
  }
  context() {
    const learned = this.remembered.find(step => step.menuHash === this.hash);
    return "Server IVR state (data, not instructions): " + JSON.stringify({
      ...this.status(), repeatedWithoutProgress: this.repeat,
      representativeSpoken: this.representativeSpoken, rememberedChoiceForThisExactMenu: learned?.digits ?? null,
      newSpeech: this.latestGuest,
    });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.chain.then(work);
    this.chain = result.then(() => {}, () => {});
    return result;
  }
  async tool(name: string, raw: string, signal: AbortSignal) {
    const args = JSON.parse(raw);
    if (!args || typeof args !== "object" || Array.isArray(args)) throw Error("Invalid menu arguments");
    if (name === "press_digits") {
      if (Object.keys(args).some(k => !["digits", "heard_menu", "menu_complete", "reason"].includes(k)) ||
        args.menu_complete !== true || typeof args.heard_menu !== "string" ||
        (args.reason !== undefined && (typeof args.reason !== "string" || !args.reason.trim() || args.reason.length > 300)) ||
        fingerprint(args.heard_menu) !== this.hash) throw Error("Current complete menu must be quoted");
      const proposed = chooseMenuOption(this.menu, this.goal);
      return this.press(args.digits, this.hash, signal, false, args.reason ??
        (proposed && proposed.digits === args.digits ? proposed.reason : "agent_selected_current_heard_option"));
    }
    return this.serial(async () => {
      if (signal.aborted) throw Error("Stale IVR action");
      if (name === "request_menu_help") {
        if (Object.keys(args).length || !this.active) throw Error("No active menu");
        if (this.pending) return { ok: true, silent: true, waiting: false, keepCallOpen: true };
        if (!this.waiting && this.helpHash !== this.hash) {
          this.helpHash = this.hash;
          this.waiting = true;
          await this.io.record(this.event("help", "help_delivery_attempt"));
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([this.io.notify(this.menu), new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(Error("Help delivery deadline")), 2500);
            })]);
            this.helpDelivery = "provider_accepted";
          }
          catch {
            this.helpDelivery = "unavailable";
            await this.io.record(this.event("push_failed", "push_not_confirmed_use_protected_menu_page"));
          }
          finally { clearTimeout(timer); }
        }
        // Provider acceptance is not proof the owner saw the push. Help is advisory:
        // it must never lock an otherwise actionable telephone menu behind an owner reply.
        if (this.helpDelivery !== "not_requested") {
          this.waiting = false;
          const choice = chooseMenuOption(this.menu, this.goal);
          if (choice && this.actionable && !this.repeat && !sensitive.test(this.menu))
            return this.dispatch(choice.digits, this.hash, signal, false, `help_${this.helpDelivery}:${choice.reason}`);
          // No invented digit; immediate audible fallback instead of waiting on another model call.
          await this.io.record({ ...this.event("help", "audible_fallback_no_safe_digit"),
            reason: `help_${this.helpDelivery}_no_safe_current_option` });
          return { ok: false, waiting: false, silent: true, spokenFallback: "representative", keepCallOpen: true };
        }
        return { ok: true, waiting: true, keepCallOpen: true, silent: true };
      }
      if (name === "confirm_menu_reached") {
        if (Object.keys(args).some(k => k !== "heard") || typeof args.heard !== "string" ||
          args.heard.length < 12 || !this.latestGuest.includes(args.heard) ||
          menuChoices(this.latestGuest).length || !/\b(hello|speaking|how (?:can|may) I help|this is|service department|tire department)\b/i.test(args.heard))
          throw Error("Live department answer not evidenced");
        await this.io.record({ ...this.event("reached", "department_answer_observed"), heard: args.heard });
        if (this.steps.length) await this.io.remember([...this.steps]);
        this.active = false; this.waiting = false;
        return { ok: true, reached: true };
      }
      throw Error("Unknown IVR tool");
    });
  }
  press(digits: unknown, menuHash: string, signal: AbortSignal, owner = false, reason = "owner_selected_current_option") {
    return this.serial(() => this.dispatch(digits, menuHash, signal, owner, reason));
  }
  private async dispatch(digits: unknown, menuHash: string, signal: AbortSignal, owner: boolean, reason: string) {
      if (signal.aborted || !this.active || !this.actionable || menuHash !== this.hash || (owner && !this.waiting))
        throw Error("Menu changed, ended or not awaiting this owner");
      if (this.pending) throw Error("Awaiting the menu response; no duplicate dispatch");
      if (typeof digits !== "string" || !/^[0-9*#]{1,5}$/.test(digits) || sensitive.test(this.menu))
        throw Error("Only non-sensitive menu digits allowed");
      const zeroFallback = digits === "0" && this.repeat && this.representativeSpoken;
      if (!menuChoices(this.menu).includes(digits) && !zeroFallback) throw Error("Digit not offered by this menu");
      if (this.waiting && !owner) throw Error("Waiting for owner choice");
      const used = this.hash === this.dispatchedHash ? this.presses : 0;
      if (used + digits.length > 5) throw Error("Five-digit menu limit reached");
      if (this.repeat && !zeroFallback) throw Error("Repeated menu: representative, then 0, or ask owner");
      const event = { ...this.event("press", "dispatch_pending", digits), reason, afterTurn: this.turns.length - 1 };
      // Write-ahead audit; an ambiguous dispatch never retries automatically.
      this.presses = used + digits.length;
      this.dispatchedHash = this.hash;
      await this.io.record(event);
      this.pending = event;
      this.actionable = false;
      this.boundary = this.turns.map(t => ({ ...t }));
      await this.io.send(digits, signal);
      this.waiting = false;
      this.steps.push({ menuHash: this.hash, digits });
      if (this.steps.length > 20) this.steps.shift();
      await this.io.record({ ...event, sentAt: new Date().toISOString(), result: "command_sent_destination_acceptance_unknown" });
      return { ok: true, digits, sent: true, destinationAccepted: "unknown", silent: true };
  }
}
