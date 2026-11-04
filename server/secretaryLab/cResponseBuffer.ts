import type { SpokenTurn } from "../secretary/conversationEngine";

type Decision = { kind: "a" | "b" | "c"; reason: string };
const norm = (s: string) => s.toLowerCase().replace(/[.,!…:;]+/g, " ").replace(/\s+/g, " ").trim();
const acknowledgements = /^(угу|да|ага|ок|окей|понятно|mhm|mm hmm|uh huh|ok|okay|yeah|yep|yes)(\s+(угу|да|ага|ok|okay|yeah|mhm))*$/i;
const unsafe = /[0-9?？]|\b(no|not|never|actually|instead|but|tomorrow|today|when|where|what|why|how|who)\b|(?:^|\s)(?:нет|не|ни|стоп|подожди|завтра|сегодня|вчера|числ|дат|друг|вместо|но|почему|когда|где|сколько|кто|какой|что|как|исправ|точнее|хотя|давайте)(?:\S*)/i;
const users = (turns: SpokenTurn[]) => turns.filter(t => t.role === "user").map(t => t.content).join(" ");
const tokens = (text: string) => Array.from(text.matchAll(/[a-zа-яё0-9]+/gi)).map(m => ({
  word: m[0].toLowerCase(), end: m.index! + m[0].length,
}));
/** Deliberately narrow b: meaning cannot be established cheaply for arbitrary new
 * words. Anything outside exact duplicates / known fillers is a new fact (c). */
export function classifyCInterruption(before: string, after: string): Decision {
  const a = norm(before), b = norm(after);
  if (a === b && !/[?？]/.test(after.slice(before.length)))
    return { kind: "b", reason: "unchanged_context" };
  const delta = b.startsWith(a + " ") ? b.slice(a.length).trim() : b;
  if (unsafe.test(delta)) return { kind: "c", reason: "fact_question_or_negation" };
  if (acknowledgements.test(delta)) return { kind: "a", reason: "acknowledgement" };
  if (b.startsWith(a + " ") && /^(пожалуйста|ну вот|в общем|please|you know)$/i.test(delta))
    return { kind: "b", reason: "safe_filler_only" };
  return { kind: "c", reason: "changed_or_ambiguous_context" };
}
export class CResponseBuffer {
  readonly metrics = {
    version: 1, responseEvents: 0, generations: 0, restarts: 0, updates: 0,
    a: 0, b: 0, c: 0, reused: 0, bridges: 0, ambiguousPlayback: 0,
    events: [] as Array<{ at: string; id: number; kind: string; reason: string; from?: number }>,
  };
  private generation?: {
    controller: AbortController; turns: SpokenTurn[]; text: string; done: boolean;
    reusable: boolean; bridge: string; firstText: boolean; timer: ReturnType<typeof setTimeout>;
  };
  private target?: { id: number; cursor: number; completed: boolean };
  private paused = false;
  private closed = false;
  private lastId = -1;
  private lastBridge = "";
  private language?: "ru" | "en";
  private latest: SpokenTurn[] = [];
  private fatal?: { message: string; end: boolean };
  constructor(private deps: {
    generate: (turns: SpokenTurn[], signal: AbortSignal, emit: (text: string) => void, reminder: boolean) => Promise<unknown>;
    send: (frame: object) => unknown;
    error: (error: unknown) => { message: string; end: boolean };
    record: (event: string) => void;
  }) {}
  private event(id: number, kind: string, reason: string, from?: number) {
    this.metrics.events.push({ at: new Date().toISOString(), id, kind, reason, ...(from === undefined ? {} : { from }) });
    if (this.metrics.events.length > 200) this.metrics.events.shift();
  }
  update(turns: SpokenTurn[], userTurn: boolean) {
    const changed = users(this.latest) !== users(turns);
    this.latest = turns; this.metrics.updates++;
    // Retell still stops playback; only the model generation survives. Never
    // transmit more old text while the caller's final words are unknown.
    if (userTurn || changed) this.paused = true;
  }
  private output(text: string, complete = false, end = false) {
    if (!this.target || this.closed) return;
    this.deps.send({ response_type: "response", response_id: this.target.id, content: text,
      content_complete: complete, ...(end ? { end_call: true } : {}) });
  }
  private flush() {
    const g = this.generation, t = this.target;
    if (!g || !t || this.paused || this.closed || t.completed) return;
    const text = g.text.slice(t.cursor);
    if (text) { this.output(text); t.cursor = g.text.length; }
    if (g.done) { this.output("", true); t.completed = true; }
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
    const choices = ru ? ["Поняла.", "Так.", "Хорошо."] : ["Got it.", "Okay.", "Understood."];
    const next = choices.find(s => s !== this.lastBridge)!;
    this.lastBridge = next; this.metrics.bridges++; this.output(next + " "); return next;
  }
  request(id: number, turns: SpokenTurn[], reminder = false) {
    if (this.closed || id <= this.lastId) return;
    this.lastId = id; this.metrics.responseEvents++; this.latest = turns;
    if (id > 0) {
      const meaningful = turns.filter(t => t.role === "user" && /[a-zа-яё]/i.test(t.content) &&
        !/unintelligible/i.test(t.content) && !acknowledgements.test(norm(t.content))).at(-1)?.content;
      if (meaningful && (!this.language || tokens(meaningful).length >= 4))
        this.language = /[а-яё]/i.test(meaningful) ? "ru" : "en";
    }
    const old = this.generation;
    this.target = { id, cursor: 0, completed: false };
    this.paused = false;
    if (this.fatal) { this.output(this.fatal.message, true, true); this.close(); return; }
    let decision = old?.reusable && !reminder ? classifyCInterruption(users(old.turns), users(turns)) : undefined;
    if (decision && decision.kind !== "c") {
      const position = this.playbackPosition(turns);
      if (position !== null) {
        this.metrics[decision.kind]++; this.metrics.reused++;
        this.target.cursor = position;
        this.event(id, decision.kind, decision.reason, position);
        this.deps.record("c_response_reused_" + decision.kind);
        // Context updates live here even though the already generated answer
        // intentionally keeps its original immutable input. The next generation
        // always receives the latest full provider transcript.
        this.flush(); return;
      }
      this.metrics.ambiguousPlayback++;
      decision = { kind: "c", reason: "unverified_playback_prefix" };
    }
    if (decision) {
      this.metrics.c++; this.metrics.restarts++;
      this.event(id, "c", decision.reason);
      this.deps.record("c_response_restarted");
    }
    if (old) { clearTimeout(old.timer); old.controller.abort(); }
    const bridge = decision ? this.bridge(turns) : "";
    const controller = new AbortController();
    const g = { controller, turns, text: "", done: false, bridge, firstText: true, reusable: id !== 0 && !reminder,
      timer: setTimeout(() => {
        if (this.generation === g) this.fail(g, Error("C_RESPONSE_TIMEOUT"));
      }, 25_000) };
    g.timer.unref(); this.generation = g; this.metrics.generations++;
    this.deps.record("response_started");
    void this.deps.generate(turns, controller.signal, text => {
      if (this.generation !== g || controller.signal.aborted || this.closed) return;
      if (g.text.length + text.length > 16_000) { this.fail(g, Error("C_BUFFER_BOUND")); return; }
      g.text += text;
      if (g.firstText && bridge) {
        const phrase = bridge.replace(/[.!]+$/, "").toLowerCase();
        const beginning = g.text.trimStart().toLowerCase();
        if (phrase.startsWith(beginning) || beginning === phrase) return;
        if (beginning.startsWith(phrase) && /[\s,.:;!?]/.test(beginning[phrase.length] ?? "")) {
          g.text = g.text.trimStart().slice(phrase.length).replace(/^[\s,.:;!?]+/, "");
        }
        g.firstText = false;
      }
      this.flush();
    }, reminder).then(() => {
      if (this.generation !== g || controller.signal.aborted || this.closed) return;
      if (g.firstText && bridge && norm(g.text) === norm(bridge)) g.text = "";
      g.done = true; clearTimeout(g.timer); this.flush(); this.deps.record("response_complete");
    }).catch(error => { if (this.generation === g && !controller.signal.aborted) this.fail(g, error); });
  }
  private fail(g: NonNullable<CResponseBuffer["generation"]>, error: unknown) {
    clearTimeout(g.timer); g.controller.abort(); g.reusable = false;
    const result = this.deps.error(error);
    // Never emit an error over the caller; keep the failed generation unusable.
    if (this.paused) this.fatal = result;
    else { this.output(result.message, true, result.end); if (this.target) this.target.completed = true; }
    this.deps.record("c_response_failed");
    if (result.end && !this.paused) this.close();
  }
  close() {
    this.closed = true;
    if (this.generation) { clearTimeout(this.generation.timer); this.generation.controller.abort(); }
  }
}
