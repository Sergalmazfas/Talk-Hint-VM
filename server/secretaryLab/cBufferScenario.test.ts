import { afterEach, expect, it, vi } from "vitest";
import { CResponseBuffer } from "./cResponseBuffer";
import type { SpokenTurn } from "../secretary/conversationEngine";

afterEach(() => vi.useRealTimers());
const scenarios = {
  ru: ["Привет, как дела", "Кто звонил сегодня",
    "Нужно заплатить 156 долларов. Повтори 156 долларов",
    "Запиши напоминание про оплату", "Еще купить холодильник",
    "Нужны продукты для пикника", "Нет, сумма 377 долларов 66 центов", "угу", "Хорошо, заканчиваем"],
  en: ["Hello, how are you", "Who called today",
    "Pay 156 dollars. Repeat 156 dollars", "Write a reminder about payment",
    "Also buy a refrigerator", "Need groceries for a picnic",
    "No, the amount is 377 dollars and 66 cents", "yeah", "Okay, finish the test"],
};
it.each(["ru","en"] as const)("free synthetic %s replay: amounts/repeat/interruption; not an acoustic measurement", async language => {
  vi.useFakeTimers();
  let responseId = 0, models = 0;
  const history: SpokenTurn[] = [], frames: any[] = [];
  const buffer = new CResponseBuffer({
    generate: (turns, signal, emit) => {
      models++;
      const current = turns.filter(t => t.role === "user").at(-1)!.content;
      return new Promise<void>(resolve => {
        setTimeout(() => {
          if (!signal.aborted) emit(current.includes("377") ? "Confirmed 377.66." : "Ready.");
          resolve();
        },700);
      });
    },
    send: f => frames.push(f), record: () => {},
    error: () => ({ message: "stopped", end: true }),
  });
  for (const text of scenarios[language]) {
    const words = text.split(" "), start = frames.length;
    // Reconstructed ASR bursts, not the original missing intermediate frames.
    const slices = [words.slice(0,Math.max(1,words.length-2)).join(" "),
      words.slice(0,Math.max(1,words.length-1)).join(" "), text];
    for (const content of slices) {
      const turns: SpokenTurn[] = [...history,{ role:"user",content }];
      buffer.update(turns,true); buffer.request(++responseId,turns);
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(1200);
    history.push({ role:"user",content:text });
    const spoken = frames.slice(start).map(f => f.content).join("");
    if (text.includes("377")) { expect(spoken).toContain("377.66"); expect(spoken).not.toContain("156"); }
    history.push({ role:"agent",content:spoken });
  }
  const bridgeEvents = buffer.metrics.events.filter(e => e.kind === "bridge");
  expect(new Set(bridgeEvents.map(e => e.phrase)).size).toBe(bridgeEvents.length);
  expect(buffer.metrics.bridges).toBeLessThanOrEqual(3);
  expect(buffer.metrics.a).toBeGreaterThan(0);
  expect(models).toBeLessThan(15);
  console.log("C_FREE_REPLAY "+JSON.stringify({ language, phrases:9, models,
    restarts:buffer.metrics.restarts, a:buffer.metrics.a, b:buffer.metrics.b, c:buffer.metrics.c,
    bridges:buffer.metrics.bridges, bridgesPerPhrase:buffer.metrics.bridges/9,
    injectedModelTTFT:700, realModelCalls:0, realAudio:false }));
  buffer.close();
});
