import { EventEmitter } from "node:events";
import { describe, it, expect } from "vitest";
import { SecretaryConversationEngine, type EngineStream } from "./conversationEngine";
import { RetellEngineRegistry } from "../secretaryLab/retellEngine";

const ending = { reason: "completed", farewell: "До свидания!" };
function speech(text = ending.farewell): EngineStream {
  return async function* (request) {
    if (request.input.at(-1)?.type !== "function_call_output") {
      const tool = { call_id: "end-this-response", name: "prepare_call_end", arguments: JSON.stringify(ending) };
      yield { type: "complete", output: [tool], tools: [tool] };
    } else {
      yield { type: "text", text };
      yield { type: "complete", output: [], tools: [] };
    }
  };
}
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; frames: any[] = [];
  send(text: string) { this.frames.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.emit("close"); }
  receive(frame: object) { this.emit("message", Buffer.from(JSON.stringify(frame)), false); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
describe("Retell telephone farewell", () => {
  it("allows only a validated end preparation and never imports browser fixture data", async () => {
    const engine = new SecretaryConversationEngine("owner", "Confirmed telephone assignment", speech(), true);
    expect(await engine.respond([{ role: "user", content: "Yes, that is all. Goodbye." }],
      new AbortController().signal, () => {})).toEqual(ending);
    expect(engine.report.testOnly).toBe(false);
    expect(JSON.stringify(engine.report.context)).not.toContain("TEST practice");
    expect(engine.instructions).not.toContain("2026-11-02");
    expect(() => engine.execute("save_test_message", "{}", new AbortController().signal)).toThrow();
  });
  it("does not end after a different reply or an aborted response", async () => {
    const engine = new SecretaryConversationEngine("owner", "assignment", speech("Please hold."), true);
    expect(await engine.respond([], new AbortController().signal, () => {})).toBeUndefined();
    const abort = new AbortController(); abort.abort();
    expect(await engine.respond([], abort.signal, () => {})).toBeUndefined();
  });
  it("sends end_call only on the completed telephone farewell; browser conversations keep manual stop", async () => {
    for (const phone of [true, false]) {
      const registry = new RetellEngineRegistry(speech(), { phone });
      const entry = registry.reserve("owner", "assignment", "task");
      registry.registered("task", "call_test");
      const socket = new Socket();
      registry.attach(socket as any, `${phone ? "/retell-phone-engine/" : "/retell-engine-stream/"}${entry.ticket}/call_test`);
      socket.receive({ interaction_type: "response_required", response_id: 1, transcript: [{ role: "user", content: "Goodbye" }] });
      await tick();
      const ends = socket.frames.filter(f => f.end_call);
      expect(ends).toHaveLength(phone ? 1 : 0);
      if (phone) expect(ends[0]).toMatchObject({ response_id: 1, content_complete: true });
      registry.dispose();
    }
  });
  it("never finishes a stale farewell after the caller resumes speaking", async () => {
    let release!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const stream: EngineStream = async function* (request) {
      if (request.input.at(-1)?.type !== "function_call_output") {
        const tool = { call_id: "end", name: "prepare_call_end", arguments: JSON.stringify(ending) };
        yield { type: "complete", output: [tool], tools: [tool] };
      } else {
        await paused;
        yield { type: "text", text: ending.farewell };
        yield { type: "complete", output: [], tools: [] };
      }
    };
    const registry = new RetellEngineRegistry(stream, { phone: true });
    const entry = registry.reserve("owner", "assignment", "task");
    registry.registered("task", "call_test");
    const socket = new Socket();
    registry.attach(socket as any, `/retell-phone-engine/${entry.ticket}/call_test`);
    socket.receive({ interaction_type: "response_required", response_id: 1, transcript: [{ role: "user", content: "Goodbye" }] });
    await tick();
    socket.receive({ interaction_type: "update_only", turntaking: "user_turn", transcript: [{ role: "user", content: "Wait, another question" }] });
    release(); await tick();
    expect(socket.frames.filter(f => f.end_call)).toHaveLength(0);
    registry.dispose();
  });
});
