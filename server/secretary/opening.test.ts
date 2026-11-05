import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PhoneOpeningGate, openingTiming } from "./opening";
import { RetellEngineRegistry } from "../secretaryLab/retellEngine";
import { SecretaryConversationEngine, type EngineStream } from "./conversationEngine";
import { checklistItemKind } from "../../shared/callChecklist";

const turn = (content: string) => [{ role: "user" as const, content }];
const tick = () => new Promise(resolve => setImmediate(resolve));
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; frames: any[] = [];
  send(raw: string) { this.frames.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit("close"); }
  frame(frame: object) { this.emit("message", Buffer.from(JSON.stringify(frame)), false); }
}
afterEach(() => vi.useRealTimers());
describe("Owner-approved listen-first telephone opening", () => {
  it("detects overlap of fragmented recording by word clocks, not transcript order",()=>{
    const turns=[{speaker:"secretary",text:"Hello"},{speaker:"guest",text:"Thank you"},
      {speaker:"secretary",text:"Hello, are you"},{speaker:"guest",text:"for calling Flying J"}];
    const playback=[{index:0,role:"agent",start:2.445,end:12.925},
      {index:1,role:"user",start:24.94,end:25.34},
      {index:2,role:"agent",start:24.549,end:25.5},
      {index:3,role:"user",start:25.5,end:29}];
    expect(openingTiming(turns,playback)).toMatchObject({source:"provider_word_clocks",firstSpeaker:"secretary",spokeOverRecording:true});
    expect(openingTiming(turns,undefined).spokeOverRecording).toBeNull();
    expect(openingTiming(turns,playback.slice(1)).spokeOverRecording).toBeNull();
  });
  it("does not treat fragmented Thank you / for calling as a human", () => {
    const g = new PhoneOpeningGate();
    expect(g.permit([])).toBe(false);
    expect(g.permit(turn("Thank you"), false)).toBe(false);
    for (const t of ["for calling Flying J, Tulsa", "press 1", "para español", "your call is important", "calls may be recorded"])
      expect(g.permit(turn(t))).toBe(false);
    expect(g.permit(turn("Flying J, this is Denise"))).toBe(true);
    expect(g.permit(turn("The price is 150"))).toBe(true);
    expect(g.probe()).toBeUndefined();
  });
  it("probes initial silence only once and never delivers an introduction", () => {
    const g = new PhoneOpeningGate();
    expect(g.probe()).toBe("Hi, hello?");
    expect(g.probe()).toBeUndefined();
    const recording = new PhoneOpeningGate();
    recording.permit(turn("Thank you for calling"));
    expect(recording.probe()).toBeUndefined();
  });
  it("leaves voicemail to the existing leave/skip policy", () => {
    expect(new PhoneOpeningGate().permit(turn("Leave a message after the beep"))).toBe(true);
  });
  it("never calls the model for an announcement; introduces after the human only", async () => {
    const stream = vi.fn<EngineStream>(async function* () {
      yield { type: "text", text: "Hello, I am the secretary." };
      yield { type: "complete", tools: [], output: [] };
    });
    const e = new SecretaryConversationEngine("owner", "Ask about parking", stream, true);
    const emit = vi.fn(), signal = new AbortController().signal;
    for (const content of ["Thank you for calling Flying J", "for calling Flying J, Tulsa"])
      await e.respond(turn(content), signal, emit);
    expect(stream).not.toHaveBeenCalled(); expect(emit).not.toHaveBeenCalled();
    await e.respond(turn("Flying J, this is Denise"), signal, emit);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("Hello, I am the secretary.");
  });
  it.each([true, false])("connection is silent; 3s probe is once, phone=%s", async phone => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stream = vi.fn<EngineStream>(async function* () { yield { type: "complete", tools: [], output: [] }; });
    const registry = new RetellEngineRegistry(stream, { phone });
    const e = registry.reserve("owner", "Ask parking", "opening");
    registry.registered("opening", "call_opening");
    const ws = new Socket();
    registry.attach(ws as any, `${phone ? "/retell-phone-engine/" : "/retell-engine-stream/"}${e.ticket}/call_opening`);
    ws.frame({ interaction_type: "call_details", call: { call_id: "call_opening", call_type: phone ? "phone_call" : "web_call" } });
    await tick();
    if (phone) {
      expect(stream).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2999);
      expect(ws.frames.some(f => f.content)).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(ws.frames.filter(f => f.content).map(f => f.content)).toEqual(["Hi, hello?"]);
      await vi.advanceTimersByTimeAsync(10000);
      expect(ws.frames.filter(f => f.content)).toHaveLength(1);
    } else expect(stream).toHaveBeenCalledTimes(1); // Do not change Dev/browser opening.
    registry.dispose();
  });
  it("partial recording speech cancels silence probe before response_required", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stream = vi.fn<EngineStream>(async function* () { yield { type: "complete", tools: [], output: [] }; });
    const registry = new RetellEngineRegistry(stream, { phone: true });
    const e = registry.reserve("owner", "Ask parking", "opening");
    registry.registered("opening", "call_opening");
    const ws = new Socket();
    registry.attach(ws as any, `/retell-phone-engine/${e.ticket}/call_opening`);
    ws.frame({ interaction_type: "call_details", call: { call_id: "call_opening", call_type: "phone_call" } });
    ws.frame({ interaction_type: "update_only", transcript: turn("Thank you"), turntaking: "user_turn" });
    await vi.advanceTimersByTimeAsync(5000);
    ws.frame({ interaction_type: "response_required", response_id: 1, transcript: turn("Thank you for calling Flying J") });
    await tick();
    expect(stream).not.toHaveBeenCalled(); expect(ws.frames.some(f => f.content)).toBe(false);
    registry.dispose();
  });
  it.each(["Не платить", "Не бронировать", "Do not pay", "Don't book", "Skip voicemail"])(
    "labels %s as a prohibition, never SAY/ASK", text => expect(checklistItemKind(text)).toBe("prohibition"));
});
