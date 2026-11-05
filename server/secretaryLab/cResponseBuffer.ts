import type { SpokenTurn } from "../secretary/conversationEngine";
import { voicemailTurn } from "../secretary/voicemail";

type Decision = { kind: "a" | "b" | "c"; reason: string; regenerate?: boolean };
const norm = (s: string) => s.toLowerCase().replace(/[.,!…:;]+/g, " ").replace(/\s+/g, " ").trim();
const acknowledgements = /^(угу|да|ага|ок|окей|понятно|mhm|mm hmm|uh huh|ok|okay|yeah|yep|yes)(\s+(угу|да|ага|ok|okay|yeah|mhm))*$/i;
const unsafe = /[0-9?？]|\b(no|not|never|actually|instead|but|tomorrow|today|when|where|what|why|how|who)\b|(?:^|\s)(?:нет|не|ни|стоп|подожди|завтра|сегодня|вчера|вместо|но|почему|когда|где|сколько|кто|что|как|точнее|хотя|давайте)(?=\s|$)|(?:^|\s)(?:числ|дат|друг|како|исправ)\S*/i;
const users = (turns: SpokenTurn[]) => turns.filter(t => t.role === "user").map(t => t.content).join(" ");
const tokens = (text: string) => Array.from(text.matchAll(/[a-zа-яё0-9]+/gi)).map(m => ({
  word: m[0].toLowerCase(), end: m.index! + m[0].length,
}));
const factWords = /(?:^|\s)(?:two|three|four|five|six|seven|eight|nine|ten|hundred|monday|tuesday|wednesday|thursday|friday|saturday|sunday|один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто|сто|двести|триста)(?=\s|$)|(?:^|\s)(?:repeat|повтори|dollar|cent|доллар|цент)\S*/i;
/** b appends may require a SILENT regeneration; they are not proof the old answer
 * is still safe. Only duplicates/acknowledgements/empty fillers reuse old text. */
export function classifyCInterruption(before: string, after: string): Decision {
  const aa = tokens(before).map(t => t.word), bb = tokens(after).map(t => t.word);
  const a = aa.join(" "), b = bb.join(" ");
  if (a === b)
    return { kind: "b", reason: "unchanged_context" };
  let prefix = 0; while (prefix < aa.length && aa[prefix] === bb[prefix]) prefix++;
  const delta = bb.slice(prefix).join(" ");
  const removed = aa.slice(prefix).join(" ");
  const unitEnding = prefix === aa.length - 1 && /^(доллар|цент|dollar|cent)/.test(aa[prefix] ?? "") &&
    bb.length === aa.length && bb[prefix]?.startsWith(aa[prefix]);
  if (unitEnding) return { kind: "b", reason: "unit_word_ending", regenerate: true };
  if (unsafe.test(delta) || factWords.test(delta) || (prefix < aa.length && (unsafe.test(removed) || factWords.test(removed))))
    return { kind: "c", reason: "fact_question_or_negation", regenerate: true };
  if (acknowledgements.test(delta)) return { kind: "a", reason: "acknowledgement" };
  if (b.startsWith(a + " ") && /^(пожалуйста|ну вот|в общем|please|you know)$/i.test(delta))
    return { kind: "b", reason: "safe_filler_only" };
  const wordEnding = prefix === aa.length - 1 && bb[prefix] &&
    (bb[prefix].startsWith(aa[prefix]) || aa[prefix].startsWith(bb[prefix]));
  if (prefix === aa.length || wordEnding)
    return { kind: "b", reason: "asr_append_or_word_completion", regenerate: true };
  return { kind: "c", reason: "correction_of_existing_words", regenerate: true };
}
export class CResponseBuffer {
  readonly metrics = {
    version: 2, responseEvents: 0, generations: 0, restarts: 0, updates: 0,
    a: 0, b: 0, c: 0, reused: 0, bridges: 0, ambiguousPlayback: 0,
    events: [] as Array<{ at: string; id: number; kind: string; reason: string; from?: number; phrase?: number }>,
  };
  private generation?: {
    controller: AbortController; turns: SpokenTurn[]; text: string; done: boolean;
    reusable: boolean; bridge: string; firstText: boolean; end?: boolean; timer: ReturnType<typeof setTimeout>;
  };
  private target?: { id: number; cursor: number; completed: boolean; sentText?: string; sentenceSent?: boolean };
  private paused = false;
  private awaitingProviderTurn = false;
  private closed = false;
  private lastId = -1;
  private lastBridge = "";
  private language?: "ru" | "en" | "es";
  private latest: SpokenTurn[] = [];
  private fatal?: { message: string; end: boolean };
  private phrase?: { key: number; token: boolean; bridged: boolean; eligible: boolean; agents: number; armed?: boolean };
  private bridgeTimer?: ReturnType<typeof setTimeout>;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private lastBridgeAgent = -3;
  constructor(private deps: {
    generate: (turns: SpokenTurn[], signal: AbortSignal, emit: (text: string) => void, reminder: boolean) => Promise<unknown>;
    send: (frame: object) => unknown;
    error: (error: unknown) => { message: string; end: boolean };
    record: (event: string) => void;
    onGeneration?: (controller: AbortController, id: number) => void;
    bridgeAllowed?: (turns: SpokenTurn[]) => boolean;
    providerHasText?: (signal: AbortSignal) => boolean;
    firstTextReason?: string;
    discardOnInterruption?: boolean;
    interruptionActive?: () => boolean;
    advanceCompletedTurn?: boolean;
    retellStreaming?: boolean;
  }) {}
  private event(id: number, kind: string, reason: string, from?: number) {
    this.metrics.events.push({ at: new Date().toISOString(), id, kind, reason, phrase: this.phrase?.key, ...(from === undefined ? {} : { from }) });
    if (this.metrics.events.length > 200) this.metrics.events.shift();
  }
  update(turns: SpokenTurn[], userTurn: boolean, protectInitialPhoneGreeting = false) {
    const changed = users(this.latest) !== users(turns);
    const semanticChange = norm(users(this.latest)) !== norm(users(turns));
    const duplicateOpening = protectInitialPhoneGreeting && norm(users(this.latest)) === norm(users(turns));
    this.latest = turns; this.metrics.updates++;
    if (this.deps.retellStreaming) {
      // update_only is not a cancellation or a replacement response request.
      // Retell controls audible turn-taking and discards superseded response IDs.
      // Keep streaming the current ID; block side effects/bridges until Retell
      // requests a response for the updated caller context.
      if (userTurn || semanticChange) this.awaitingProviderTurn = true;
      return;
    }
    if (this.deps.discardOnInterruption) {
      // New rehearsal only: no stale prefix may be resumed after real speech.
      // A repeated/case-only ASR snapshot is not itself proof of interruption.
      if (semanticChange || (userTurn && (this.deps.interruptionActive?.() ?? true))) {
        this.event(this.target?.id ?? this.lastId, "discarded", "dev_interruption");
        this.suspendForWaiting();
      }
      return;
    }
    // Retell still stops playback; only the model generation survives. Never
    // transmit more old text while the caller's final words are unknown.
    // Opt-in for telephone opening only. Retell can repeat the SAME completed
    // ASR as user_turn without issuing another response_required. This must not
    // hold an unsaid greeting forever. New speech still pauses; native barge-in
    // and all subsequent / Dev buffer semantics are unchanged.
    if ((userTurn || changed) && !duplicateOpening) this.paused = true;
  }
  permitsTools() { return !this.closed && !this.paused && !this.awaitingProviderTurn && !!this.generation && !this.generation.controller.signal.aborted; }
  private output(text: string, complete = false, end = false, substantive = false) {
    if (!this.target || this.closed) return;
    const sent = this.deps.send({ response_type: "response", response_id: this.target.id, content: text,
      content_complete: complete, ...(end && !this.awaitingProviderTurn ? { end_call: true } : {}) });
    // Diagnostics only, AFTER sending. Never buffer a sentence on our server.
    // Exclude acknowledgement bridges from substantive-response measurements.
    if (this.deps.retellStreaming && sent !== false) {
      const t = this.target;
      if (substantive && text) {
        if (!t.sentText) this.event(t.id, "first_text_sent", "websocket_send");
        t.sentText = (t.sentText ?? "") + text;
        // A trailing decimal point is ambiguous until another chunk arrives.
        if (!t.sentenceSent && /[!?…](?=\s|$)|\.(?=\s)|(?<!\d)\.(?=$)/.test(t.sentText)) {
          t.sentenceSent = true;
          this.event(t.id, "first_sentence_sent", "text_terminator_observed");
        }
      }
      if (complete) {
        if (t.sentText && !t.sentenceSent) {
          t.sentenceSent = true;
          this.event(t.id, "first_sentence_sent", "content_complete");
        }
        this.event(t.id, "response_closed", "content_complete");
      }
    }
  }
  private flush() {
    const g = this.generation, t = this.target;
    if (!g || !t || this.paused || this.closed || t.completed) return;
    const text = g.text.slice(t.cursor);
    if (text) { this.output(text, false, false, true); t.cursor = g.text.length; }
    if (g.done) { this.output("", true, !!g.end); t.completed = true; }
  }
  private playbackPosition(turns: SpokenTurn[]) {
    const g = this.generation!;
    // Retell transcript is evidence of the played prefix, not sent-to-TTS bytes.
    // Search only AFTER the last substantive caller turn that this generation used.
    const anchor = g.turns.filter(t => t.role === "user").at(-1)?.content;
    let start = -1;
    for (let i = 0; i < turns.length; i++) if (turns[i].role === "user" && turns[i].content === anchor) start = i;
    let played = start < 0 ? "" : turns.slice(start + 1).filter(t => t.role === "agent").map(t => t.content).join(" ").trim();
    if (g.bridge && played.startsWith(g.bridge)) played = played.slice(g.bridge.length).trimStart();
    if (!played) return 0;
    // Punctuation/case differ between TTS text and ASR transcript. Match exact
    // lexical prefixes only, retaining the original character offset.
    let heard = tokens(played).map(t => t.word);
    const oldStart = g.turns.findLastIndex(t => t.role === "user" && t.content === anchor);
    const baseline = tokens(g.turns.slice(oldStart + 1).filter(t => t.role === "agent").map(t => t.content).join(" ")).map(t => t.word);
    if (baseline.length && baseline.every((w, i) => heard[i] === w)) heard = heard.slice(baseline.length);
    const link = tokens(g.bridge).map(t => t.word);
    if (link.length && link.every((w, i) => heard[i] === w)) heard = heard.slice(link.length);
    if (!heard.length) return 0;
    const generated = tokens(g.text);
    if (heard.length <= generated.length && heard.every((w, i) => generated[i].word === w)) {
      let end = generated[heard.length - 1].end;
      while (/[.,:;!?…]/.test(g.text[end] ?? "") && end < g.text.length) end++;
      return end;
    }
    // Never replay a possibly contradictory answer when delivery cannot be mapped.
    return null;
  }
  private bridge(turns: SpokenTurn[]) {
    const ru = this.language === "ru";
    const choices = ru ? ["Поняла.", "Хорошо.", "Услышала."] : this.language === "es"
      ? ["Entendido.", "De acuerdo.", "Comprendido."] : ["Got it.", "Okay.", "Understood."];
    const next = choices[(choices.indexOf(this.lastBridge) + 1) % choices.length];
    this.lastBridge = next; this.metrics.bridges++; this.output(next + " "); return next;
  }
  private armBridge(phrase: NonNullable<CResponseBuffer["phrase"]>) {
    if (phrase.armed) return;
    phrase.armed = true;
    this.bridgeTimer = setTimeout(() => {
      const g = this.generation;
      if (this.closed || this.paused || this.awaitingProviderTurn || this.deps.bridgeAllowed?.(this.latest) === false ||
        voicemailTurn(this.latest) || this.phrase !== phrase || phrase.token || phrase.bridged ||
        !phrase.eligible || !g || this.deps.providerHasText?.(g.controller.signal) || g.done ||
        g.controller.signal.aborted || phrase.agents - this.lastBridgeAgent < 3) return;
      g.bridge = this.bridge(this.latest); phrase.bridged = true; this.lastBridgeAgent = phrase.agents;
      this.event(this.target!.id, "bridge", g.bridge);
      this.deps.record("c_delayed_bridge");
    }, 600);
    this.bridgeTimer.unref();
  }
  request(id: number, turns: SpokenTurn[], reminder = false) {
    if (this.closed || id <= this.lastId) return;
    this.lastId = id; this.metrics.responseEvents++; this.latest = turns;
    this.event(id, "response_required", "provider_turn_complete");
    if (id > 0) {
      const meaningful = turns.filter(t => t.role === "user" && /[a-zа-яё]/i.test(t.content) &&
        !/unintelligible/i.test(t.content) && !acknowledgements.test(norm(t.content))).at(-1)?.content;
      if (meaningful && (!this.language || tokens(meaningful).length >= 4))
        this.language = /[а-яё]/i.test(meaningful) ? "ru" :
          /(?:hola|gracias|precio|cuánto|mañana|dólares|repite|acuerdo|quiero|necesito)/i.test(meaningful) ? "es" : "en";
    }
    const old = this.generation;
    // A provider can split a single utterance into adjacent transcript entries.
    // Those entries must not reset the phrase or earn extra bridge quota.
    let key = 0, agents = 0, previousRole: SpokenTurn["role"] | undefined, substantiveAgent = false;
    for (const turn of turns) {
      if (turn.role === "user") {
        if (previousRole !== "user") key++;
        substantiveAgent = false;
      } else {
        if (previousRole !== "agent") substantiveAgent = false;
        if (!substantiveAgent && turn.content.trim() &&
          !/^(поняла|так|хорошо|услышала|got it|okay|understood)[.! ]*$/i.test(turn.content.trim())) {
          agents++; substantiveAgent = true;
        }
      }
      previousRole = turn.role;
    }
    if (id > 0 && this.phrase?.key !== key) {
      clearTimeout(this.bridgeTimer);
      this.phrase = { key, token: false, bridged: false, eligible: false, agents };
    }
    this.target = { id, cursor: 0, completed: false };
    this.paused = false;
    this.awaitingProviderTurn = false;
    if (this.fatal?.end) { this.output(this.fatal.message, true, true); this.close(); return; }
    this.fatal = undefined; // A recoverable phone error over interrupted speech is not a terminal hang.
    let decision = old?.reusable && !reminder ? classifyCInterruption(users(old.turns), users(turns)) : undefined;
    // A fully played previous turn cannot need ASR-burst coalescing. Preserve
    // the old coalescer for partial/in-flight speech, but start real new turns now.
    const played = this.deps.retellStreaming && old?.reusable &&
      (old.done || /[?？]\s*$/.test(old.text)) ? this.playbackPosition(turns) : null;
    const finishedPreviousTurn = played !== null && !!old && !old.text.slice(played).trim();
    if (old && this.deps.discardOnInterruption && norm(users(old.turns)) !== norm(users(turns)))
      decision = { kind: "c", reason: "dev_interrupted_answer_discarded", regenerate: true };
    if (old?.controller.signal.aborted && decision) decision = {
      kind: decision.kind === "a" ? "b" : decision.kind, reason: decision.reason, regenerate: true,
    };
    if (decision && decision.kind !== "c" && !decision.regenerate) {
      const position = this.playbackPosition(turns);
      // Generation completion is not playback completion: a fully generated
      // answer may still be speaking. Only hand off when the played prefix
      // exhausted it (or its finished question) AND the caller added content.
      const completedNewTurn = this.deps.advanceCompletedTurn && position !== null &&
        (old!.done || /[?？]\s*$/.test(old!.text)) &&
        !old!.text.slice(position).trim() && decision.reason !== "unchanged_context";
      if (position !== null && !completedNewTurn) {
        this.metrics[decision.kind]++; this.metrics.reused++;
        this.target.cursor = position;
        this.event(id, decision.kind, decision.reason, position);
        this.deps.record("c_response_reused_" + decision.kind);
        // Context updates live here even though the already generated answer
        // intentionally keeps its original immutable input. The next generation
        // always receives the latest full provider transcript.
        this.flush(); return;
      }
      if (completedNewTurn) {
        decision = { kind: "b", reason: "completed_response_new_turn", regenerate: true };
        this.deps.record("c_completed_response_new_turn");
      } else {
        this.metrics.ambiguousPlayback++;
        decision = { kind: "b", reason: "unverified_playback_silent_restart", regenerate: true };
      }
    }
    if (decision) {
      this.metrics[decision.kind]++;
      this.event(id, decision.kind, decision.reason);
      this.deps.record("c_response_restarted");
    }
    if (this.phrase && decision?.kind === "c") this.phrase.eligible = true;
    if (old) { clearTimeout(old.timer); old.controller.abort(); }
    clearTimeout(this.restartTimer);
    const start = () => {
    if (this.closed || this.lastId !== id) return;
    if (decision) this.metrics.restarts++;
    const bridge = "";
    const controller = new AbortController();
    const g = { controller, turns, text: "", done: false, bridge, firstText: true, tokenRecorded: false, reusable: id !== 0 && !reminder,
      timer: setTimeout(() => {
        if (this.generation === g) this.fail(g, Error("C_RESPONSE_TIMEOUT"));
      }, 25_000) };
    g.timer.unref(); this.generation = g; this.metrics.generations++;
    this.event(id, "generation_started", reminder ? "reminder" : "answer");
    this.deps.onGeneration?.(controller, id);
    if (id > 0 && !reminder && this.phrase) this.armBridge(this.phrase);
    this.deps.record("response_started");
    void this.deps.generate(turns, controller.signal, text => {
      if (this.generation !== g || controller.signal.aborted || this.closed) return;
      if (g.text.length + text.length > 16_000) { this.fail(g, Error("C_BUFFER_BOUND")); return; }
      if (!g.tokenRecorded) { this.event(id, "first_token", this.deps.firstTextReason ?? "model_text_delta"); g.tokenRecorded = true; }
      if (this.phrase) this.phrase.token = true;
      g.text += text;
      if (g.firstText && g.bridge) {
        const phrase = g.bridge.replace(/[.!]+$/, "").toLowerCase();
        const beginning = g.text.trimStart().toLowerCase();
        if (phrase.startsWith(beginning) || beginning === phrase) return;
        if (beginning.startsWith(phrase) && /[\s,.:;!?]/.test(beginning[phrase.length] ?? "")) {
          g.text = g.text.trimStart().slice(phrase.length).replace(/^[\s,.:;!?]+/, "");
        }
        g.firstText = false;
      }
      this.flush();
    }, reminder).then(result => {
      if (this.generation !== g || controller.signal.aborted || this.closed) return;
      if (result) { (g as typeof g & { end?: boolean }).end = true; g.reusable = false; }
      if (g.firstText && g.bridge && norm(g.text) === norm(g.bridge)) g.text = "";
      g.done = true; clearTimeout(g.timer); this.flush(); this.deps.record("response_complete");
    }).catch(error => { if (this.generation === g && !controller.signal.aborted) this.fail(g, error); });
    };
    // Coalesce response_required bursts. Abort obsolete facts immediately, but
    // don't admit a paid replacement for every ASR delta.
    if (decision?.regenerate && !finishedPreviousTurn) {
      this.restartTimer = setTimeout(start, 150); this.restartTimer.unref();
    } else start();
  }
  private fail(g: NonNullable<CResponseBuffer["generation"]>, error: unknown) {
    clearTimeout(g.timer); g.controller.abort(); g.reusable = false;
    const result = this.deps.error(error);
    // Never emit an error over the caller; keep the failed generation unusable.
    if (this.paused || this.awaitingProviderTurn) {
      this.fatal = result;
      if (this.deps.retellStreaming && !this.paused) {
        // Close the current protocol response without speaking an error or
        // hanging up over the caller. Surface the failure on the next request.
        this.output("", true);
        if (this.target) this.target.completed = true;
      }
    } else { this.output(result.message, true, result.end); if (this.target) this.target.completed = true; }
    this.deps.record("c_response_failed");
    if (result.end && !this.paused && !this.awaitingProviderTurn) this.close();
  }
  /** Explicit Dev waiting gate: discard stale text and timers, but allow a later fresh request. */
  suspendForWaiting() {
    clearTimeout(this.bridgeTimer); clearTimeout(this.restartTimer);
    if (this.generation) { clearTimeout(this.generation.timer); this.generation.controller.abort(); }
    this.generation = undefined; this.target = undefined; this.paused = true;
  }
  close() {
    this.closed = true;
    clearTimeout(this.bridgeTimer); clearTimeout(this.restartTimer);
    if (this.generation) { clearTimeout(this.generation.timer); this.generation.controller.abort(); }
  }
}
