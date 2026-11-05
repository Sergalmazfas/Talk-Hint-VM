import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanDevReply, devColleagueSpeech, devMannersStream, devQuestion, devProviderHasText, DEV_C_MANNERS } from "./manners";
import { DevWaitingPolicy } from "../secretaryLab/waitingPolicy";
import type { EngineChunk, EngineStream } from "../secretary/conversationEngine";
import { CResponseBuffer } from "../secretaryLab/cResponseBuffer";

afterEach(() => vi.unstubAllEnvs());
describe("new rehearsal C manners: deterministic and no paid calls", () => {
  it.each(["New,", "New tires,", "Okay. What"])("does not transmit an unfinished model fragment %s", text => {
    expect(cleanDevReply(text, true, [])).toBe("");
  });
  it("answers a question without Got it and preserves exact numbers", () => {
    expect(cleanDevReply("Got it. The new tire is $207.57; used is $150.", true, []))
      .toBe("The new tire is $207.57; used is $150.");
    expect(devQuestion([{ role: "user", content: "Сколько стоит" }])).toBe(true);
  });
  it("does not repeat a missing-fact acknowledgement but retains a useful question and numbers", () => {
    const heard = ["He didn't mention — could you give me the price for both options?"];
    expect(cleanDevReply("I don't know. Could you quote both options?", true, heard)).toBe("Could you quote both options?");
    expect(cleanDevReply("He didn't mention — could you quote $207.57 and $150?", true, heard))
      .toBe("could you quote $207.57 and $150?");
    expect(cleanDevReply("I don't know which is $207.57.", true, heard)).toBe("I don't know which is $207.57.");
    expect(DEV_C_MANNERS).toContain("Do not invent options");
  });
  it("says thank you only once and does not remove a factual clause", () => {
    expect(cleanDevReply("Thank you. Goodbye! Thank you!", false, [])).toBe("Thank you. Goodbye!");
    expect(cleanDevReply("Thank you for your time. Thank you. Goodbye.", false, []))
      .toBe("Thank you for your time. Goodbye.");
    expect(cleanDevReply("Thank you, the price is $207.57.", false, [])).toBe("Thank you, the price is $207.57.");
    expect(cleanDevReply("Thank you. Goodbye! Bye.", false, ["Thank you. Goodbye."])).toBe("");
    expect(cleanDevReply("It is $207.57. Goodbye.", false, ["Thank you. Goodbye."])).toBe("It is $207.57.");
  });
  it("keeps completed content when the last fragment is cut off, without splitting decimal prices", () => {
    expect(cleanDevReply("The total is $207.57. Okay. What", false, [])).toBe("The total is $207.57.");
    expect(cleanDevReply("The total is $207.57. New tires,", false, [])).toBe("The total is $207.57.");
    expect(cleanDevReply("The total is $207.57,", false, [])).toBe("");
  });
  it("streams the first delta before completion and never emits MORE text after cancellation", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => release = r);
    const signal = new AbortController();
    const stream: EngineStream = async function* () {
      yield { type: "text", text: "New," }; await gate;
      yield { type: "text", text: " tires?" }; yield { type: "complete", output: [], tools: [] };
    };
    const iterator = devMannersStream(stream)({ instructions: "", input: [], signal: signal.signal });
    expect(await iterator.next()).toEqual({ done: false, value: { type: "text", text: "New," } });
    signal.abort(); release();
    expect((await iterator.next()).done).toBe(true);
  });
  it("preserves usage/tools, strips only a bounded Got it prefix, and streams the content", async () => {
    const stream: EngineStream = async function* () {
      yield { type: "text", text: "Got" };
      yield { type: "usage", input: 20, cachedInput: 10, output: 8 };
      yield { type: "text", text: " it. Could you quote both options?" };
      yield { type: "complete", output: [], tools: [] };
    };
    const chunks: EngineChunk[] = [];
    for await (const c of devMannersStream(stream)({ instructions: "", input: [{ role: "user", content: "New or used?" }],
      signal: new AbortController().signal })) chunks.push(c);
    expect(chunks).toEqual([{ type: "usage", input: 20, cachedInput: 10, output: 8 },
      { type: "text", text: "Could you quote both options?" }, { type: "complete", output: [], tools: [] }]);
  });
  it.each(["one sec", "give me a minute", "секунду", "посмотрю", "на складе", "other line"])("acks %s once and waits even if Retell falsely reports completion over active audio", text => {
    let now = 0; const p = new DevWaitingPolicy(() => now, { colleague: devColleagueSpeech });
    p.audio(true); p.observe(text, false, true);
    expect(p.takeAcknowledgement()).toBeUndefined();
    now = 100; p.audio(false);
    expect(p.takeAcknowledgement()?.acknowledgement).toBe(true);
    p.observe(text + ".", false, true); expect(p.takeAcknowledgement()).toBeUndefined();
    expect(p.waiting).toBe(true);
  });
  it("does not release waiting for a colleague command, even after a pause", () => {
    let now = 0; const p = new DevWaitingPolicy(() => now, { colleague: devColleagueSpeech });
    p.observe("Let me check the warehouse.", false, true); p.takeAcknowledgement();
    p.observe("John, check the new tires.", false, true); p.audio(false);
    now += 1500; p.audio(false);
    expect(p.tick()).toBeUndefined(); expect(p.waiting).toBe(true);
  });
  it("waits for 1.2 seconds of measured silence after a short return; ongoing speech resets it", () => {
    let now = 0; const p = new DevWaitingPolicy(() => now, { colleague: devColleagueSpeech });
    p.observe("на складе посмотрю", false, true); p.takeAcknowledgement();
    p.observe("новые", true, false); p.audio(true); now = 100; p.audio(false);
    now = 1299; p.audio(false); expect(p.tick()).toBeUndefined();
    p.audio(true); now = 1400; p.audio(false); now = 2600; p.audio(false);
    expect(p.tick()?.resume).toBe(true);
  });
  it("does not insert a bridge before an answer to a question, without changing default buffers", async () => {
    vi.useFakeTimers();
    try {
      const make = (dev: boolean) => {
        const sent: any[] = [];
        const b = new CResponseBuffer({ generate: async () => new Promise(() => {}),
          send: frame => sent.push(frame), record: () => {}, error: () => ({ message: "", end: false }),
          ...(dev ? { bridgeAllowed: (turns: any) => !devQuestion(turns) } : {}) });
        b.request(1, [{ role: "user", content: "New tires?" }]);
        b.request(2, [{ role: "user", content: "New tires for $200?" }]);
        return { b, sent };
      };
      const dev = make(true), baseline = make(false);
      await vi.advanceTimersByTimeAsync(900);
      expect(dev.b.metrics.bridges).toBe(0); expect(dev.sent.filter(x => x.content)).toHaveLength(0);
      expect(baseline.b.metrics.bridges).toBe(1);
      dev.b.close(); baseline.b.close();
    } finally { vi.useRealTimers(); }
  });
  it("a raw token streams immediately, cancels the bridge, and is not held until completion", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>(r => release = r);
    const sent: any[] = [];
    const stream: EngineStream = async function* () {
      yield { type: "text", text: "The price " }; await gate;
      yield { type: "text", text: "is $150." };
      yield { type: "complete", output: [], tools: [] };
    };
    const b = new CResponseBuffer({
      generate: async (turns, signal, emit) => {
        for await (const c of devMannersStream(stream)({ signal, input: turns, instructions: "" }))
          if (c.type === "text") emit(c.text);
      },
      providerHasText: devProviderHasText, firstTextReason: "dev_streaming_text_delta",
      send: frame => sent.push(frame), record: () => {}, error: () => ({ message: "", end: false }),
    });
    try {
      b.request(1, [{ role: "user", content: "We have new tires" }]);
      b.request(2, [{ role: "user", content: "No, we have used tires for $150" }]);
      await vi.advanceTimersByTimeAsync(900);
      expect(b.metrics.bridges).toBe(0);
      expect(sent.filter(x => x.content).map(x => x.content)).toEqual(["The price "]);
      release(); await vi.advanceTimersByTimeAsync(0);
      expect(sent.filter(x => x.content).map(x => x.content).join("")).toBe("The price is $150.");
      expect(b.metrics.events.find(x => x.kind === "first_token")?.reason).toBe("dev_streaming_text_delta");
    } finally { release(); b.close(); vi.useRealTimers(); }
  });
  it("does not impose the 1.2s return timer on ordinary dialogue; keeps it for an explicit warehouse wait", () => {
    let now = 0;
    const p = new DevWaitingPolicy(() => now, { colleague: devColleagueSpeech });
    p.afterAnswer(); p.audio(false);
    p.observe("Да, на ночь сто пятьдесят долларов", false, true);
    expect(p.waiting).toBe(false);
    p.observe("Секунду, на складе посмотрю", false, true);
    p.takeAcknowledgement(); p.observe("Новые есть", false, true);
    expect(p.waiting).toBe(true);
    p.audio(false); now = 1199; p.audio(false); expect(p.tick()).toBeUndefined();
    now = 1200; p.audio(false); expect(p.tick()?.resume).toBe(true);
  });
  it.each([
    { text: "Got it. The price is $207.57.", heard: [], question: true, expected: "The price is $207.57." },
    { text: "Got it the total is $207.57.", heard: [], question: true, expected: "the total is $207.57." },
    { text: "Thank you. Thank you. Goodbye! Bye.", heard: [], question: false, expected: "Thank you.Goodbye!" },
    { text: "Thank you. Goodbye!", heard: ["Thank you. Goodbye!"], question: false, expected: "" },
    { text: "Thanks for checking. It costs $150.", heard: ["Goodbye!"], question: false, expected: "Thanks for checking. It costs $150." },
  ])("runtime streaming manners preserve style without full-answer buffering: $text", async ({ text, heard, question, expected }) => {
    const stream: EngineStream = async function* () {
      // Worst-case token fragmentation.
      for (const c of text) yield { type: "text", text: c };
      yield { type: "complete", output: [], tools: [] };
    };
    let actual = "";
    for await (const c of devMannersStream(stream)({ signal: new AbortController().signal,
      instructions: "", input: [...heard.map(content => ({ role: "assistant", content })),
        { role: "user", content: question ? "How much?" : "Okay" }] }))
      if (c.type === "text") actual += c.text;
    expect(actual).toBe(expected);
  });
  it("matches the baseline first-text time on the same model stream, without waiting for completion", async () => {
    vi.useFakeTimers();
    try {
      const run = async (dev: boolean) => {
        const start = Date.now(); let first: number | undefined, complete = false;
        const source: EngineStream = async function* () {
          await new Promise(r => setTimeout(r, 20));
          yield { type: "text", text: "The price " };
          await new Promise(r => setTimeout(r, 2000));
          yield { type: "text", text: "is $150." };
          yield { type: "complete", output: [], tools: [] };
        };
        const work = (async () => {
          for await (const c of (dev ? devMannersStream(source) : source)({
            signal: new AbortController().signal, instructions: "", input: [] })) {
            if (c.type === "text" && first === undefined) first = Date.now() - start;
            if (c.type === "complete") complete = true;
          }
        })();
        await vi.advanceTimersByTimeAsync(20);
        expect(first).toBe(20); expect(complete).toBe(false);
        await vi.advanceTimersByTimeAsync(2000); await work;
        return first;
      };
      expect(await run(true)).toBe(await run(false));
    } finally { vi.useRealTimers(); }
  });
  it("discards an interrupted answer even for an acknowledgement; late chunks cannot leak or resume", async () => {
    vi.useFakeTimers();
    const sent: any[] = []; const signals: AbortSignal[] = [];
    let oldEmit: ((s: string) => void) | undefined;
    const b = new CResponseBuffer({
      discardOnInterruption: true, interruptionActive: () => true,
      generate: async (_turns, signal, emit) => { signals.push(signal); oldEmit ??= emit; await new Promise(() => {}); },
      send: frame => sent.push(frame), record: () => {}, error: () => ({ message: "", end: false }),
    });
    try {
      b.request(1, [{ role: "user", content: "The price is $300" }]);
      b.update([{ role: "user", content: "The price is $300" }], true);
      expect(signals[0].aborted).toBe(true);
      oldEmit!("Old price is $300."); expect(sent.filter(x => x.content)).toHaveLength(0);
      b.request(2, [{ role: "user", content: "The price is $300" }, { role: "user", content: "mhm" }]);
      await vi.advanceTimersByTimeAsync(0);
      expect(b.metrics.reused).toBe(0); expect(signals).toHaveLength(2);
      oldEmit!("Wrong continued answer."); expect(sent.filter(x => x.content)).toHaveLength(0);
    } finally { b.close(); vi.useRealTimers(); }
  });
});
