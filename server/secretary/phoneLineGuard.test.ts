import { EventEmitter } from "node:events";
import { afterEach, describe, it, expect, vi } from "vitest";
import { PhoneLineGuard } from "./phoneLineGuard";
import { voicemailChoice, voicemailWasSkipped } from "./voicemail";
import { secretaryInstruction, legacySecretaryPlan } from "../../shared/callPlan";
import { SecretaryConversationEngine, type EngineStream } from "./conversationEngine";
import { RetellEngineRegistry } from "../secretaryLab/retellEngine";
import { secretaryEvidence } from "../aiCrew/secretaryReview";
import { secretaryActionReport } from "../team/actionReports";
import { toSecretaryTaskReport } from "./tasks";
vi.mock("node:timers/promises", async original => ({
  ...await original<typeof import("node:timers/promises")>(),
  setTimeout: (ms: number, value: unknown, options: { signal?: AbortSignal } = {}) => new Promise((resolve, reject) => {
    const signal=options.signal;
    if(signal?.aborted) { reject(new Error("Aborted")); return; }
    const abort=()=>{clearTimeout(timer);reject(new Error("Aborted"));};
    const timer=setTimeout(()=>{signal?.removeEventListener("abort",abort);resolve(value);},ms);
    signal?.addEventListener("abort",abort,{once:true});
  }),
}));
const announcement = "The person you're trying to reach is not available. At the tone, please record your message.";
const plan = (mode?: "skip" | "leave", sayAsk = ["Ask about tires."]) => secretaryInstruction({
  ...legacySecretaryPlan("Ask about tires.", "+15550000001"), sayAsk, ...(mode ? { voicemail: mode } : {}),
});
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent: any[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit("close"); }
  frame(v: object) { this.emit("message", Buffer.from(JSON.stringify(v)), false); }
}
afterEach(() => vi.useRealTimers());
describe("Phone voicemail / no-human guard — no real calls", () => {
  it("uses explicit skip from an old checklist; never infers leave permission", () => {
    expect(voicemailChoice(plan(undefined, ["If voicemail, do not leave a message."]))).toBe("skip");
    expect(voicemailChoice(plan(undefined, ["Ask about voicemail services."]))).toBeUndefined();
    expect(voicemailChoice(plan("leave", ["Skip voicemail"]))).toBe("leave");
  });
  it("skip precedes an IVR hold lock and never invokes IVR or a model", async () => {
    const stream = vi.fn(); const beforeTurn = vi.fn(); const navigate = vi.fn();
    const engine = new SecretaryConversationEngine("fixture", plan("skip"), stream, true, undefined, [],
      { beforeTurn, navigate, blocksEnd: () => true, execute: vi.fn() });
    expect(await engine.respond([{ role:"user", content:announcement }], new AbortController().signal, vi.fn()))
      .toEqual({reason:"follow_up",farewell:""});
    expect(beforeTurn).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled(); expect(stream).not.toHaveBeenCalled();
  });
  it("repeated ASR cannot postpone skip beyond 1500ms or send two endings", async () => {
    vi.useFakeTimers(); const end = vi.fn(); const g = new PhoneLineGuard(true, end);
    g.observe("The person", true); g.observe(announcement, true);
    await vi.advanceTimersByTimeAsync(1000); g.observe(announcement, true);
    await vi.advanceTimersByTimeAsync(500);
    expect(end).toHaveBeenCalledExactlyOnceWith("voicemail_skip");
    await vi.advanceTimersByTimeAsync(30000); expect(end).toHaveBeenCalledTimes(1);
  });
  it("20s silence/recording expires; an actual digit renews the window, ASR does not", async () => {
    vi.useFakeTimers(); const end = vi.fn(); const g = new PhoneLineGuard(false, end);
    await vi.advanceTimersByTimeAsync(15000); g.progress("new-menu");
    g.observe("Thank you for calling. Press 1.", false);
    g.progress("new-menu"); // Repeating the same selection cannot renew it.
    await vi.advanceTimersByTimeAsync(19999); expect(end).not.toHaveBeenCalled();
    g.observe("Thank you for calling. Press 1.", false);
    await vi.advanceTimersByTimeAsync(1); expect(end).toHaveBeenCalledExactlyOnceWith("no_human_20s");
  });
  it("human answer disarms no-human watchdog, and a human returning cancels skip", async () => {
    vi.useFakeTimers(); const end = vi.fn(); const g = new PhoneLineGuard(true, end);
    g.observe(announcement, false); g.observe("Hello, this is the shop.", true);
    await vi.advanceTimersByTimeAsync(60000); expect(end).not.toHaveBeenCalled(); g.close();
  });
  it.each(["skip", "leave", undefined] as const)("phone transport: no response_required is necessary for guard (%s)", async mode => {
    vi.useFakeTimers(); const end = vi.fn(async () => {}); const stream = vi.fn();
    const registry = new RetellEngineRegistry(stream, {phone:true, onNoHuman:end, phoneProfile:()=>"C"});
    const r = registry.reserve("fixture", plan(mode), "fixture-task");
    registry.registered("fixture-task","call_fixture"); const ws = new Socket();
    registry.attach(ws as any, `/retell-phone-engine/${r.ticket}/call_fixture`);
    ws.frame({interaction_type:"call_details",call:{call_id:"call_fixture",call_type:"phone_call"}});
    ws.frame({interaction_type:"update_only",turntaking:"user_turn",transcript:[{role:"user",content:announcement}]});
    await vi.advanceTimersByTimeAsync(mode === "skip" ? 1500 : 20000);
    expect(ws.sent.filter(f=>f.end_call)).toHaveLength(1);
    expect(end).toHaveBeenCalledExactlyOnceWith("fixture-task",mode==="skip"?"voicemail_skip":"no_human_20s");
    expect(ws.sent.some(f=>f.content)).toBe(false); expect(stream).not.toHaveBeenCalled(); registry.dispose();
  });
  it.each(["leave", undefined] as const)("one message then end, even without a model ending tool (%s)", async mode => {
    vi.useFakeTimers();
    const stream:EngineStream = async function* () {
      yield {type:"text",text:mode==="leave"?"Authorized message. Goodbye.":"Please call the owner back. Goodbye."};
      yield {type:"complete",output:[],tools:[]};
    };
    const engine = new SecretaryConversationEngine("fixture",plan(mode),stream,true);
    const speak=vi.fn(); const response=engine.respond([{role:"user",content:announcement}],new AbortController().signal,speak);
    expect(speak).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1200);
    expect((await response)?.reason).toBe("follow_up"); expect(speak).toHaveBeenCalledTimes(1);
  });
  it("skip response_required sends end_call immediately, with silent server fallback by 1500ms", async () => {
    vi.useFakeTimers(); const end = vi.fn(async () => {}); const stream = vi.fn();
    const registry = new RetellEngineRegistry(stream,{phone:true,onNoHuman:end,phoneProfile:()=>"C"});
    const r=registry.reserve("fixture",plan("skip"),"task"); registry.registered("task","call_fixture");
    const ws=new Socket(); registry.attach(ws as any,`/retell-phone-engine/${r.ticket}/call_fixture`);
    ws.frame({interaction_type:"call_details",call:{call_id:"call_fixture",call_type:"phone_call"}});
    ws.frame({interaction_type:"response_required",response_id:1,transcript:[{role:"user",content:announcement}]});
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.sent.some(f=>f.response_id===1&&f.end_call)).toBe(true);
    await vi.advanceTimersByTimeAsync(1500); expect(end).toHaveBeenCalledExactlyOnceWith("task","voicemail_skip");
    expect(ws.sent.some(f=>f.content)).toBe(false); expect(stream).not.toHaveBeenCalled(); registry.dispose();
  });
  it("leave sends one message after the silence gate and one end, no C bridge or duplicate message", async () => {
    vi.useFakeTimers(); const speak="Authorized message. Goodbye.";
    const stream=vi.fn(async function*(){yield{type:"text" as const,text:speak};yield{type:"complete" as const,output:[],tools:[]};});
    const registry=new RetellEngineRegistry(stream,{phone:true,phoneProfile:()=>"C"});
    const r=registry.reserve("fixture",plan("leave"),"task");registry.registered("task","call_fixture");
    const ws=new Socket();registry.attach(ws as any,`/retell-phone-engine/${r.ticket}/call_fixture`);
    ws.frame({interaction_type:"call_details",call:{call_id:"call_fixture",call_type:"phone_call"}});
    const transcript=[{role:"user",content:announcement}];
    ws.frame({interaction_type:"response_required",response_id:1,transcript});
    await vi.advanceTimersByTimeAsync(1199);expect(ws.sent.some(f=>f.content)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);expect(ws.sent.filter(f=>f.content).map(f=>f.content)).toEqual([speak]);
    expect(ws.sent.some(f=>f.end_call)).toBe(true);
    ws.frame({interaction_type:"response_required",response_id:2,transcript});
    await vi.advanceTimersByTimeAsync(20000);expect(stream).toHaveBeenCalledTimes(1);registry.dispose();
  });
  it("reports voicemail skip as not reached, not an employee failure", () => {
    const turns=[{role:"guest",text:announcement}]; const instruction=plan("skip");
    expect(voicemailWasSkipped(instruction,turns)).toBe(true);
    expect(secretaryEvidence(instruction,turns,"fixture").voicemailSkipped).toBe(true);
    const report=secretaryActionReport({call_sid:"CA-fixture",user_id:"owner",ended_at:"2026-11-05T00:12:00Z"},
      {id:"task",call_sid:"CA-fixture",user_id:"owner",instruction,transcript_turns:turns})!;
    expect(report.outcome).toBe("not_reached"); expect(report.succeeded.join(" ")).toContain("не провал");
  });
  it("watchdog not_reached cannot be upgraded to message_left from incomplete speech", () => {
    const report=toSecretaryTaskReport({id:"task",mode:"live",phoneNumber:"+15550000001",status:"completed",
      outcome:"not_reached",instruction:plan("leave"),summary:"No human in 20 seconds.",
      transcriptTurns:[{role:"guest",text:announcement},{role:"secretary",text:"Partial message"}]} as any);
    expect(report.outcome).toBe("not_reached");
  });
});
