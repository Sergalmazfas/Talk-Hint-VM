/** Dev C only. No telephone imports, provider calls, model calls or task writes. */
export type WaitKind = "silence" | "brief" | "checking" | "background";
export type WaitingAction = { text: string; end: boolean; kind: WaitKind; elapsedMs: number; acknowledgement?: boolean; resume?: boolean };
export type WaitingEvent = {
  type: "started" | "acknowledged" | "probe" | "returned" | "expired" | "background";
  kind: WaitKind; atMs: number; elapsedMs: number; probeCount: number;
};
export const WAITING_DEV_SUFFIX = " · waiting-dev";
export const WAITING_DEV_DURATION_MS = 600_000;
export const WAITING_DEV_INSTRUCTIONS = "\nDEV WAITING RULES (experiment, not telephone): " +
  "The transport acknowledges an explicit wait request ONCE; do not add a second acknowledgement. Then stay silent. " +
  "Respond to direct addresses, or a short caller turn followed by verified 1.2s silence. " +
  "One sec/give me a minute: wait 60s, one Still there? only in verified silence. " +
  "Let me check/back/warehouse/other line/I'll be right back: wait up to 5min without checks. " +
  "Music/background work/colleague conversation: do not check or interrupt. Ambiguous addressee: stay silent. " +
  "The deterministic transport owns timers/probes/farewell; do not produce additional waiting checks.";
export const WAITING_REVIEW_RULES = Object.freeze({
  status: "proposed",
  leva: "По каждому ожиданию: тип, длительность, число проверок, перебивания, соблюдение правил 1–5. Не выдавать отсутствие текста за тишину: звук/музыку и адресата по одной расшифровке не доказать.",
  toma: "Независимо сверить тип/возврат/проверки с цитатами и таймингами. Музыку, фоновую работу и перебивания подтверждать аудио; без него — не проверено, не успех.",
  hold: { unnecessaryChecks: 0, interruptionsWhileWaiting: 0 },
});
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
export function waitingCue(text: string): Exclude<WaitKind, "silence"> | undefined {
  const s = normalize(text);
  // A factual return can mention the warehouse without asking us to wait again.
  if (/^(?:i'?m back|(?:we|i) (?:have|found|checked)|the (?:price|answer|total) (?:is|will be))\b/.test(s) &&
    !/\b(?:let me|i'?ll|have to|need to|going to|hold|wait|give me)\b/.test(s)) return;
  if (/\b(let me check|in the back|warehouse|other line|i'?ll be right back|hold on|please hold|on hold)\b|сейчас проверю|посмотрю|на складе|другой линии|сейчас вернусь|подождите на линии|voy a comprobar|almac[eé]n|otra l[ií]nea|vuelvo enseguida/.test(s)) return "checking";
  if (/\b(one sec(?:ond)?|one minute|give me a minute|just a (?:sec(?:ond)?|minute)|one moment)\b|секунд(?:очку|у)|одну минуту|минутку|un segundo|un minuto/.test(s)) return "brief";
  if (/^\s*[\[(].*(?:music|background|музыка|фонов).*[\])]\s*$/i.test(s)) return "background";
}
/** Explicit return/address only. A colleague's conversation must not unlock the model. */
export function colleagueSpeech(text: string) {
  const s = normalize(text);
  return /^(?:[\[(]|tell (?:him|her|them)|ask (?:him|her|them)|(?:i'?m )?talking to|скажи (?:ему|ей)|спроси у)/.test(s) ||
    /^(?:hey|hi|hello)\s+(?!(?:katya|kate)\b)[a-z]+[,!:]/.test(s) ||
    new RegExp("^(?!(?:катя|кать|катюш(?:а)?|katya|kate|hello|hi|hey|привет|здравствуйте|да|ну|хорошо)[,:])[\\p{L}-]+[,:]\\s+(?:can you|could you|ты|вы|у нас|we have)", "u").test(s);
}
export function addressedReturn(text: string) {
  const s = normalize(text);
  if (colleagueSpeech(s)) return false;
  // A name/third-party preface is not an address to Katya. Do not mine an
  // answer-looking fragment from a conversation with a colleague.
  if (/^(?:tell (?:him|her|them)|ask (?:him|her|them)|(?:i'?m )?talking to|скажи (?:ему|ей)|спроси у)/.test(s)) return false;
  if (new RegExp("(?:^|[^\\p{L}])(?:катя|кать|катюш(?:а|енька)?|katya|kate)(?=$|[^\\p{L}])", "u").test(s)) return true;
  if (/\b(?:you there|are you|can you hear)\b|(?:ты|вы) (?:ещ[её] )?здесь|слыш(?:ишь|ите)|^здесь[?!.]*$/.test(s)) return true;
  if (/^(?:hello|hi|hey|алло|здравствуйте|hola)[,.!?:\s]*$/.test(s)) return true;
  if (/^(?:can|could|would|will|do|did|are|have|what|when|where|how|which|who|why)\b.*\b(?:you|your)\b/.test(s)) return true;
  return /^(?:(?:hello|hi|алло)[,.!?:\s]+)?(?:i'?m back|thanks? for (?:holding|waiting)|are you (?:still )?there|(?:we|i) (?:have|found|checked|don't have|do not have)|it (?:is|costs)|it's|the (?:price|answer|total) (?:is|will be)|yes[, ]+we have|no[, ]+we (?:don't|do not) have|how can i help)\b|^(?:я вернул|спасибо.{0,10}подожд|вы ещё здесь|я (?:наш[её]л|проверил)|у нас есть|цена.{0,10}\d|he vuelto|ya volv[ií]|el precio es)/.test(s);
}
export class DevWaitingPolicy {
  readonly events: WaitingEvent[] = [];
  readonly review = WAITING_REVIEW_RULES;
  private wait?: { kind: WaitKind; since: number; probes: number; ackPending?: boolean; ackReadyAt?: number };
  private shortTurn?: { identity: string; at: number };
  private quietSince?: number;
  private lastSpeech = "";
  private lastCompleted = "";
  private language: "en" | "ru" | "es" = "en";
  private activeSince?: number;
  private activity?: { active: boolean; at: number };
  private speaking = false;
  private agentSpeaking = false;
  private ended = false;
  constructor(private now = Date.now, private strict?: { colleague: (text: string) => boolean }) {}
  private event(type: WaitingEvent["type"]) {
    if (!this.wait) return;
    this.events.push({ type, kind: this.wait.kind, atMs: this.now(),
      elapsedMs: this.now() - this.wait.since, probeCount: this.wait.probes });
  }
  /** Local microphone energy only. It cannot prove music, speaker identity or words. */
  audio(active: boolean, agentSpeaking = false) {
    if (active || agentSpeaking) this.quietSince = undefined;
    else this.quietSince ??= this.now();
    this.activity = { active, at: this.now() };
    if (this.agentSpeaking && !agentSpeaking) this.afterAnswer();
    this.agentSpeaking = agentSpeaking;
    if (active && !agentSpeaking) this.activeSince ??= this.now();
    else this.activeSince = undefined;
    if (active && !agentSpeaking && this.wait && (this.wait.kind === "silence" ||
      (this.wait.kind === "brief" && this.now() - this.activeSince! >= 3000))) {
      this.wait.kind = "background"; this.event("background");
    }
  }
  playbackEnded() { this.agentSpeaking = false; this.afterAnswer(); }
  observe(text: string, userSpeaking: boolean, completed: boolean, turnKey?: string) {
    this.speaking = userSpeaking;
    const key = normalize(text);
    const identity = normalize(turnKey ?? key);
    if (!key || (identity === this.lastSpeech && (!completed || identity === this.lastCompleted)) || this.ended) return;
    this.lastSpeech = identity;
    if (completed) this.lastCompleted = identity;
    if (/[а-яё]{3,}/i.test(text)) this.language = "ru";
    else if (/\b(hola|precio|gracias|almacén|compruebo)\b/i.test(text)) this.language = "es";
    else if (/[a-z]{3}/i.test(text)) this.language = "en";
    if (colleagueSpeech(text) || this.strict?.colleague(text)) {
      this.shortTurn = undefined;
      if (!this.wait) {
        this.wait = { kind: "background", since: this.now(), probes: 0 };
        this.event("started");
      }
      return;
    }
    const kind = waitingCue(text);
    if (kind) {
      this.shortTurn = undefined;
      // Repeated ASR / minor rewrites must not restart the waiting deadline.
      if (!this.wait || (["silence", "background"].includes(this.wait.kind) && kind !== "background")) {
        this.wait = { kind, since: this.now(), probes: 0,
          ackPending: kind !== "background", ...(completed && kind !== "background" ? { ackReadyAt: this.now() } : {}) };
        this.event("started");
      } else if (this.wait.kind === "brief" && kind === "checking") {
        this.wait.kind = kind;
      }
      if (completed && this.wait?.ackPending) this.wait.ackReadyAt ??= this.now();
      return;
    }
    const activeAudio = this.strict && this.activity?.active && this.now() - this.activity.at <= 3000;
    if (this.wait && completed && addressedReturn(text) && !activeAudio) {
      this.event("returned"); this.wait = undefined; this.shortTurn = undefined;
    } else if (this.wait && !colleagueSpeech(text) && key.length <= 100 && key.split(" ").length <= 12) {
      if (this.shortTurn?.identity !== identity) this.shortTurn = { identity, at: this.now() };
    } else this.shortTurn = undefined;
  }
  get awaitingPause() { return !!this.shortTurn && !!this.wait && !this.ended; }
  takeAcknowledgement(): WaitingAction | undefined {
    if (!this.wait?.ackPending || this.wait.ackReadyAt === undefined || this.ended ||
        this.speaking || this.agentSpeaking) return;
    if (this.strict && this.activity?.active && this.now() - this.activity.at <= 3000) return;
    this.wait.ackPending = false; this.event("acknowledged");
    return { text: this.language === "ru" ? "Конечно, жду." : this.language === "es" ?
      "Claro, espero." : "Sure, take your time.", end: false, kind: this.wait.kind,
      elapsedMs: this.now() - this.wait.since, acknowledgement: true };
  }
  afterAnswer() {
    if (!this.wait && !this.ended) {
      this.wait = { kind: "silence", since: this.now(), probes: 0 }; this.event("started");
    }
  }
  get waiting() { return !!this.wait || this.ended; }
  get snapshot() {
    return { status: "dev-only" as const, clock: "unix_milliseconds", state: this.ended ? "ended" : this.wait?.kind ?? "conversation",
      currentWaitElapsedMs: this.wait ? this.now() - this.wait.since : 0,
      events: this.events, review: this.review,
      acousticEvidence: this.activity ? "local-microphone-energy-not-speaker-identification" : "unavailable",
      notVerified: ["Real Retell/TTS playback", "Music identity and speaker addressee require audio review"] };
  }
  tick(): WaitingAction | undefined {
    if (!this.wait || this.ended) return;
    const { kind, since } = this.wait, elapsedMs = this.now() - since;
    const freshSilence = this.activity && !this.activity.active && this.now() - this.activity.at <= 3000;
    const quiet = freshSilence && !this.speaking && !this.agentSpeaking;
    const pause = freshSilence && !this.agentSpeaking && this.quietSince !== undefined &&
      this.now() - this.quietSince >= 1200;
    if (this.shortTurn && pause && this.now() - this.shortTurn.at >= 1200) {
      this.event("returned"); this.wait = undefined; this.shortTurn = undefined;
      return { text: this.language === "ru" ? "Да, слушаю." : "Yes, I'm listening.",
        end: false, kind, elapsedMs, resume: true };
    }
    // ASR-only entry may use acoustic end-of-turn; never speak over continued audio.
    if (this.wait.ackPending && pause && this.wait.ackReadyAt === undefined && !this.speaking)
      this.wait.ackReadyAt = this.now();
    if (this.wait.ackReadyAt !== undefined && this.now() - this.wait.ackReadyAt > 5000)
      this.wait.ackPending = false; // Do not emit a stale acknowledgement much later.
    if (quiet) {
      const acknowledgement = this.takeAcknowledgement();
      if (acknowledgement) return acknowledgement;
    }
    // One probe, then a 20-second reply window. Absolute deadlines never slide.
    const probeAt = kind === "silence" ? 20_000 : kind === "brief" ? 60_000 : undefined;
    const endAt = probeAt === undefined ? 300_000 : probeAt + 20_000;
    if (elapsedMs >= endAt) {
      this.event("expired"); this.ended = true;
      return { text: this.language === "ru" ? "Передам и перезвоню позже." :
        this.language === "es" ? "Se lo diré y volveré a llamar más tarde." : "I'll let him know and call back later.",
        end: true, kind, elapsedMs };
    }
    if (probeAt !== undefined && elapsedMs >= probeAt && this.wait.probes === 0 && quiet) {
      this.wait.probes++; this.event("probe");
      return { text: this.language === "ru" ? (kind === "silence" ? "Алло?" : "Вы ещё здесь?") :
        this.language === "es" ? (kind === "silence" ? "¿Hola?" : "¿Sigue ahí?") :
          (kind === "silence" ? "Hello?" : "Still there?"), end: false, kind, elapsedMs };
    }
    return;
  }
}
