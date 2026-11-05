import { afterEach, describe, expect, it, vi } from "vitest";
import { C_NO_LOOP_POLICY, C_NO_LOOP_POLICY_HASH, withCNoLoopRule } from "./cNoLoop";
import type { EngineRequest, EngineStream } from "../secretary/conversationEngine";
import { CResponseBuffer } from "../secretaryLab/cResponseBuffer";

afterEach(() => vi.useRealTimers());
describe("C prompt-only experiment, no network or generated semantic claims", () => {
  it("changes only one developer input; keeps tools, instructions, signal and chunks untouched", async () => {
    const original: EngineRequest = { instructions: "trusted baseline C rules",
      input: [{ role: "user", content: "We work 24/7. Which day do you want?" }],
      signal: new AbortController().signal };
    const chunks = [{ type: "text" as const, text: "Сергей ещё не выбрал день." },
      { type: "usage" as const, input: 123, cachedInput: 100, output: 12 },
      { type: "complete" as const, output: [], tools: [] }];
    let observed!: EngineRequest;
    const provider: EngineStream = async function* (request) {
      observed = request; yield* chunks;
    };
    const result = [];
    for await (const chunk of withCNoLoopRule(provider)(original)) result.push(chunk);
    expect(observed.instructions).toBe(original.instructions);
    expect(observed.signal).toBe(original.signal);
    expect(observed.input).toEqual([...original.input, { role: "developer", content: C_NO_LOOP_POLICY }]);
    expect(original.input).toHaveLength(1);
    chunks.forEach((chunk, i) => expect(result[i]).toBe(chunk));
    expect(C_NO_LOOP_POLICY_HASH).toMatch(/^[a-f0-9]{64}$/);
  });
  it("passes the first token at the same time as C, long before the model completes", async () => {
    vi.useFakeTimers();
    for (const wrap of [false, true]) {
      const sent: { text: string; at: number }[] = []; const start = Date.now();
      const provider: EngineStream = async function* () {
        await new Promise(resolve => setTimeout(resolve, 20));
        yield { type: "text", text: "The price is " };
        await new Promise(resolve => setTimeout(resolve, 2000));
        yield { type: "text", text: "$430." };
        yield { type: "complete", output: [], tools: [] };
      };
      const b = new CResponseBuffer({ generate: async (_turns, signal, emit) => {
        for await (const chunk of (wrap ? withCNoLoopRule(provider) : provider)({ instructions: "",
          input: [], signal })) if (chunk.type === "text") emit(chunk.text);
      }, send: (frame: any) => { if (frame.content) sent.push({ text: frame.content, at: Date.now() - start }); },
      error: () => ({ message: "error", end: true }), record: () => {} });
      b.request(1, [{ role: "user", content: "What is the total?" }]);
      await vi.advanceTimersByTimeAsync(20);
      expect(sent).toEqual([{ text: "The price is ", at: 20 }]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(sent.map(x => x.text).join("")).toBe("The price is $430.");
      b.close();
    }
  });
  it("preserves baseline generation on an ASR update instead of the discarded Dev behavior", async () => {
    const signals: AbortSignal[] = [];
    const b = new CResponseBuffer({ generate: async (_turns, signal) => {
      signals.push(signal); await new Promise(() => {});
    }, send: () => {}, record: () => {}, error: () => ({ message: "", end: false }) });
    b.request(1, [{ role: "user", content: "The total is $430" }]);
    b.update([{ role: "user", content: "THE TOTAL IS $430." }], true);
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);
    expect(b.metrics.events.some(e => e.reason === "dev_interruption")).toBe(false);
    b.close();
  });
  // Scripted responses are contract fixtures, NOT evidence that a live model obeys the new rule.
  it.each([
    { name: "missing arrival day", guest: "We work 24/7. Tell us your preferred day, then we check slots.",
      reply: "Сергей ещё не выбрал день. Передам, что нужно согласовать время заранее. Спасибо, до свидания.",
      facts: ["24/7"], forbidden: /tomorrow|завтра|booked|забронировал/i },
    { name: "new actual availability", guest: "The earliest free slot is Friday at 10; no booking yet.",
      reply: "Пятница, 10 часов. Передам Сергею, ничего не бронирую.", facts: ["Friday", "10"], forbidden: /забронировала|booked/i },
    { name: "genuine contradictory number", guest: "Correction: installation is $80, not $18.",
      reply: "Установка $80 вместо $18, верно?", facts: ["$80", "$18"], forbidden: /booked/i },
    { name: "above budget", guest: "Tire $350 plus installation $80, total $430.",
      reply: "Итого $430 — выше бюджета $400. Передам Сергею, без заказа.", facts: ["$350", "$80", "$430"], forbidden: /заказала|booked/i },
  ])("replays the $name contract without losing guest evidence or modifying output", async fixture => {
    let actual!: EngineRequest;
    const provider: EngineStream = async function* (request) {
      actual = request;
      yield { type: "text", text: fixture.reply };
      yield { type: "complete", output: [], tools: [] };
    };
    let text = "";
    for await (const chunk of withCNoLoopRule(provider)({ instructions: "Budget $400. Do not book or pay.",
      input: [{ role: "user", content: fixture.guest }], signal: new AbortController().signal }))
      if (chunk.type === "text") text += chunk.text;
    expect(text).toBe(fixture.reply); expect(text).not.toMatch(fixture.forbidden);
    fixture.facts.forEach(fact => expect(actual.input[0].content).toContain(fact));
    expect(actual.instructions).toContain("Do not book or pay");
    expect(actual.input.at(-1).content).toBe(C_NO_LOOP_POLICY);
  });
});
