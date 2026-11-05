import { afterEach, describe, expect, it, vi } from "vitest";
import { CResponseBuffer } from "./cResponseBuffer";
import type { SpokenTurn } from "../secretary/conversationEngine";

const user = (content: string): SpokenTurn => ({ role: "user", content });
const agent = (content: string): SpokenTurn => ({ role: "agent", content });
const buffers: CResponseBuffer[] = [];
function replay(enabled = true) {
  vi.useFakeTimers();
  const frames: any[] = [];
  const calls: Array<{
    turns: SpokenTurn[]; signal: AbortSignal;
    emit(text: string): void; done(): void;
  }> = [];
  const buffer = new CResponseBuffer({
    advanceCompletedTurn: enabled,
    generate: (turns, signal, emit) => new Promise<void>(done => calls.push({ turns, signal, emit, done })),
    send: frame => frames.push(frame), record: vi.fn(),
    error: () => ({ message: "fixture failure", end: true }),
  });
  buffers.push(buffer);
  return { buffer, frames, calls };
}
afterEach(() => { buffers.splice(0).forEach(b => b.close()); vi.useRealTimers(); });

describe("Dev completed-turn replay — no model or audio calls", () => {
  it.each(["Yes.", "No.", "Да.", "Нет."])("a finished question → %s starts a fresh answer without a reminder", async answer => {
    const { buffer, calls, frames } = replay();
    const question = "Is $400 the total including installation and taxes?";
    const initial = [user("The total is $400.")];
    buffer.request(1, initial);
    calls[0].emit(question); calls[0].done();
    await vi.advanceTimersByTimeAsync(0);
    const next = [...initial, agent(question), user(answer)];
    buffer.update(next, true); buffer.request(2, next);
    await vi.advanceTimersByTimeAsync(160); // Unchanged existing 150 ms coalescer.
    expect(calls).toHaveLength(2);
    expect(calls[1].turns).toEqual(next);
    calls[1].emit("Can you take the truck in two hours?");
    calls[1].done(); await vi.advanceTimersByTimeAsync(0);
    const spoken = frames.filter(f => f.response_id === 2).map(f => f.content).join("");
    expect(spoken).toBe("Can you take the truck in two hours?");
    expect(spoken).not.toContain(question);
    expect(buffer.metrics.reused).toBe(0);
    expect(buffer.metrics.events.some(e => e.reason === "reminder")).toBe(false);
    expect(buffer.metrics.bridges).toBe(0);
    if (/^(Yes|Да)/i.test(answer))
      expect(buffer.metrics.events).toContainEqual(expect.objectContaining({ reason: "completed_response_new_turn" }));
  });

  it("even before stream completion, a fully spoken question can receive an answer", async () => {
    const { buffer, calls } = replay();
    const initial = [user("The price is $400.")], question = "Does that include tax?";
    buffer.request(1, initial); calls[0].emit(question);
    const next = [...initial, agent(question), user("Yes.")];
    buffer.request(2, next); await vi.advanceTimersByTimeAsync(160);
    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true);
  });

  it.each([false, true])("угу while speech is in progress reuses its unspoken remainder (generation done=%s)", async done => {
    const { buffer, calls, frames } = replay();
    const initial = [user("Please explain.")];
    buffer.request(1, initial);
    calls[0].emit("First part. Remaining part.");
    if (done) calls[0].done();
    await vi.advanceTimersByTimeAsync(0);
    const next = [...initial, agent("First part."), user("угу")];
    buffer.update(next, true); buffer.request(2, next);
    await vi.advanceTimersByTimeAsync(160);
    expect(calls).toHaveLength(1);
    expect(calls[0].signal.aborted).toBe(false);
    expect(frames.filter(f => f.response_id === 2).map(f => f.content).join("")).toBe(" Remaining part.");
  });

  it("a correction cancels the old amount and supplies the new fact to the next answer", async () => {
    const { buffer, calls, frames } = replay();
    const initial = [user("The total is $400.")];
    buffer.request(1, initial); calls[0].emit("The total is $400.");
    const next = [...initial, agent("The total is"), user("No, correction: the total is $380.")];
    buffer.update(next, true); buffer.request(2, next);
    const boundary = frames.length;
    calls[0].emit(" Pay $400.");
    await vi.advanceTimersByTimeAsync(160);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].turns.at(-1)?.content).toContain("$380");
    calls[1].emit("Is $380 the complete total?");
    expect(frames.slice(boundary).map(f => f.content).join("")).toBe("Is $380 the complete total?");
  });

  it("case/punctuation-only repeat of the same snapshot does not create an extra answer", async () => {
    const { buffer, calls } = replay();
    buffer.request(1, [user("Please confirm.")]);
    calls[0].emit("Is this correct?"); calls[0].done();
    await vi.advanceTimersByTimeAsync(0);
    buffer.request(2, [user("PLEASE CONFIRM!"), agent("Is this correct?")]);
    await vi.advanceTimersByTimeAsync(160);
    expect(calls).toHaveLength(1);
  });

  it("unopted cohorts retain the previous behavior; no implicit production rollout", async () => {
    const { buffer, calls } = replay(false);
    const initial = [user("The price is $400.")], question = "Is tax included?";
    buffer.request(1, initial); calls[0].emit(question); calls[0].done();
    await vi.advanceTimersByTimeAsync(0);
    buffer.request(2, [...initial, agent(question), user("Yes.")]);
    await vi.advanceTimersByTimeAsync(160);
    expect(calls).toHaveLength(1);
    expect(buffer.metrics.reused).toBe(1);
  });
});
