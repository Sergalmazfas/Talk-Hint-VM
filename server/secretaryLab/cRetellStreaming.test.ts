import { afterEach, describe, expect, it, vi } from "vitest";
import { CResponseBuffer } from "./cResponseBuffer";
import type { SpokenTurn } from "../secretary/conversationEngine";

const user = (content: string): SpokenTurn => ({ role: "user", content });
const agent = (content: string): SpokenTurn => ({ role: "agent", content });
const buffers: CResponseBuffer[] = [];
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
function fixture(retellStreaming = true) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
  const frames: Array<{ at: number; frame: any }> = [];
  const calls: Array<{ at: number; turns: SpokenTurn[]; signal: AbortSignal;
    emit(text: string): void; done(result?: boolean): void; fail(error: Error): void }> = [];
  const buffer = new CResponseBuffer({
    retellStreaming, advanceCompletedTurn: true,
    generate: (turns, signal, emit) => new Promise<boolean | undefined>((done, fail) => {
      calls.push({ at: Date.now(), turns, signal, emit, done, fail });
    }),
    send: frame => { frames.push({ at: Date.now(), frame }); return true; },
    record: vi.fn(), error: () => ({ message: "Fixture error", end: true }),
  });
  buffers.push(buffer);
  return { buffer, calls, frames };
}
afterEach(() => { buffers.splice(0).forEach(b => b.close()); vi.useRealTimers(); });

describe("Retell streaming — opt-in New Dev only, no providers", () => {
  it.each(["Yes.", "No.", "Да.", "Нет."])("finished question → %s has no extra coalescing wait", async answer => {
    const { buffer, calls } = fixture();
    const initial = [user("The total is $400.")], question = "Is that including tax?";
    buffer.request(1, initial); calls[0].emit(question); calls[0].done(); await tick();
    const next = [...initial, agent(question), user(answer)];
    const at = Date.now();
    buffer.request(2, next);
    expect(calls).toHaveLength(2);
    expect(calls[1].at - at).toBe(0);
    expect(calls[1].turns).toEqual(next);
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("update_only cannot cancel, restart or hold the current requested stream", async () => {
    const { buffer, calls, frames } = fixture();
    const initial = [user("Please quote the total.")];
    buffer.request(7, initial);
    buffer.update(initial, true);
    await tick(200);
    calls[0].emit("Does "); await tick(25);
    expect(frames.at(-1)?.frame).toEqual(expect.objectContaining({
      response_id: 7, content: "Does ", content_complete: false,
    }));
    expect(buffer.metrics.events.some(e => e.kind === "first_sentence_sent")).toBe(false);
    calls[0].emit("that include installation?"); calls[0].done(); await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0].signal.aborted).toBe(false);
    const textAt = buffer.metrics.events.find(e => e.kind === "first_text_sent")!;
    const sentenceAt = buffer.metrics.events.find(e => e.kind === "first_sentence_sent")!;
    expect(Date.parse(sentenceAt.at) - Date.parse(textAt.at)).toBe(25);
    expect(frames.at(-1)?.frame).toEqual(expect.objectContaining({ response_id: 7, content_complete: true }));
  });

  it("partial-utterance updates keep old IDs; the corrected request aborts the old provider and drops late text", async () => {
    const { buffer, calls, frames } = fixture();
    const initial = [user("The total is $400")];
    buffer.request(1, initial);
    const correction = [user("The total is $400 — no, $380 including installation.")];
    buffer.update(correction, true);
    expect(buffer.permitsTools()).toBe(false);
    expect(calls[0].signal.aborted).toBe(false);
    buffer.request(2, correction);
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].emit("Old price $400."); calls[0].done();
    await tick(160);
    expect(calls).toHaveLength(2);
    expect(calls[1].turns).toEqual(correction);
    calls[1].emit("Is $380 the full installed price?"); calls[1].done(); await tick();
    expect(frames.every(x => x.frame.response_id === 2)).toBe(true);
    expect(frames.map(x => x.frame.content).join("")).not.toContain("$400");
    const requests = calls.length;
    buffer.request(1, initial); buffer.request(2, correction);
    expect(calls).toHaveLength(requests);
  });

  it("a genuine backchannel during speech resumes only the unspoken prefix without a new generation", async () => {
    const { buffer, calls, frames } = fixture();
    const initial = [user("Please explain the options.")];
    buffer.request(1, initial);
    calls[0].emit("First option. Second option."); calls[0].done(); await tick();
    const next = [...initial, agent("First option."), user("угу")];
    buffer.update(next, true);
    buffer.request(2, next);
    expect(calls).toHaveLength(1);
    expect(frames.filter(x => x.frame.response_id === 2).map(x => x.frame.content).join("")).toBe(" Second option.");
  });

  it("a request to wait is kept intact; background updates do not start replies or emit bridges", async () => {
    const { buffer, calls, frames } = fixture();
    const initial = [user("One sec, let me check in the warehouse.")];
    buffer.request(1, initial);
    calls[0].emit("Sure, take your time."); calls[0].done(); await tick();
    const count = frames.length;
    buffer.update([...initial, agent("Sure, take your time."), user("Speaking to my colleague.")], true);
    await tick(5000);
    expect(calls).toHaveLength(1);
    expect(calls[0].turns).toEqual(initial);
    expect(frames).toHaveLength(count);
    expect(buffer.metrics.bridges).toBe(0);
  });

  it("caller context updates block tool permission and a stale end_call until a new requested turn", async () => {
    const { buffer, calls, frames } = fixture();
    buffer.request(1, [user("Thanks.")]);
    buffer.update([user("Thanks. Wait, I have a correction.")], true);
    expect(buffer.permitsTools()).toBe(false);
    calls[0].emit("Goodbye."); calls[0].done(true); await tick();
    expect(frames.some(x => x.frame.end_call)).toBe(false);
  });

  it("a timed-out old generation during caller speech cannot close the entire buffer", async () => {
    const { buffer, calls, frames } = fixture();
    buffer.request(1, [user("Hello.")]);
    buffer.update([user("Hello. One more thing.")], true);
    calls[0].fail(Error("fixture cancelled")); await tick();
    expect(frames).toHaveLength(1);
    expect(frames[0].frame).toEqual({
      response_type: "response", response_id: 1, content: "", content_complete: true,
    });
    // Existing fatal-error policy remains in force on the next explicit request.
    buffer.request(2, [user("Hello. One more thing.")]);
    expect(frames.at(-1)?.frame.response_id).toBe(2);
    expect(frames.at(-1)?.frame.content_complete).toBe(true);
  });

  it("keeps the 150 ms burst coalescer for corrections to incomplete speech", async () => {
    const { buffer, calls } = fixture();
    buffer.request(1, [user("The price is $400.")]);
    calls[0].emit("Is that");
    buffer.request(2, [user("Actually the price is $380.")]);
    await tick(149); expect(calls).toHaveLength(1);
    await tick(1); expect(calls).toHaveLength(2);
  });

  it("diagnostics do not mistake a split decimal point for a completed sentence", async () => {
    const { buffer, calls } = fixture();
    buffer.request(1, [user("What is the price?")]);
    calls[0].emit("The price is $400.");
    expect(buffer.metrics.events.some(e => e.kind === "first_sentence_sent")).toBe(false);
    calls[0].emit("50 including tax.");
    expect(buffer.metrics.events.filter(e => e.kind === "first_sentence_sent")).toHaveLength(1);
  });

  it("before/after on the SAME synthetic turn isolates 150 ms, not a measured audio improvement", async () => {
    const rows: Array<{ mode: string; requestToModel: number; requestToFirstText: number; requestToSentence: number }> = [];
    for (const enabled of [false, true]) {
      const { buffer, calls, frames } = fixture(enabled);
      const initial = [user("The tire is in stock.")], question = "Can you take the truck in two hours?";
      buffer.request(1, initial); calls[0].emit(question); calls[0].done(); await tick();
      const requestAt = Date.now();
      buffer.request(2, [...initial, agent(question), user("Yes.")]);
      await tick(enabled ? 0 : 150);
      await tick(800); calls[1].emit("Does "); await tick(200);
      calls[1].emit("that include installation?"); calls[1].done(); await tick();
      rows.push({ mode: enabled ? "after" : "before",
        requestToModel: calls[1].at - requestAt,
        requestToFirstText: frames.find(x => x.frame.response_id === 2 && x.frame.content === "Does ")!.at - requestAt,
        requestToSentence: frames.find(x => x.frame.response_id === 2 && x.frame.content === "that include installation?")!.at - requestAt,
      });
      buffer.close();
    }
    expect(rows).toEqual([
      { mode: "before", requestToModel: 150, requestToFirstText: 950, requestToSentence: 1150 },
      { mode: "after", requestToModel: 0, requestToFirstText: 800, requestToSentence: 1000 },
    ]);
    console.log("DEV_REPLAY_ONLY_NOT_AUDIO", JSON.stringify(rows));
  });

  it("before/after exposes an update-only text hold without creating a new request", async () => {
    for (const enabled of [false, true]) {
      const { buffer, calls, frames } = fixture(enabled);
      buffer.request(1, [user("Hello.")]);
      buffer.update([user("Hello.")], true);
      calls[0].emit("Can you confirm the price?");
      expect(calls).toHaveLength(1);
      expect(calls[0].signal.aborted).toBe(false);
      expect(frames.length).toBe(enabled ? 1 : 0);
      buffer.close();
    }
  });
});
