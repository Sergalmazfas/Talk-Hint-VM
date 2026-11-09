import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretaryIvr, type IvrEvent } from "./ivr";
import { chooseMenuOption, listedOptions } from "./ivrSelection";
import { PhoneLineGuard } from "./phoneLineGuard";
import { SecretaryConversationEngine, type EngineStream, type TelephoneTools } from "./conversationEngine";
import { RetellEngineRegistry } from "../secretaryLab/retellEngine";
import { secretaryEvidence } from "../aiCrew/secretaryReview";

const fleet = "Thank you for calling Fleet Pride. For parts, press one. For service, press two.";
const goal = "Call FleetPride Joplin and reach the parts department. Once connected, check same-day availability of a JOST landing gear crank handle.";
const user = (content: string) => ({ role: "user" as const, content });
const signal = () => new AbortController().signal;
function setup(objective: string) {
  const events: IvrEvent[] = [];
  const io = { send: vi.fn(async (_digits: string, _signal?: AbortSignal) => {}),
    record: vi.fn(async (e: IvrEvent) => { events.push(e); }), notify: vi.fn(), remember: vi.fn() };
  const ivr = new SecretaryIvr(io, [], objective);
  const tools: TelephoneTools = {
    beforeTurn: async turns => { await ivr.observe(turns); return ivr.context(); },
    navigate: abort => ivr.navigate(abort), needsChoice: () => ivr.needsChoice(),
    fallback: abort => ivr.fallback(abort), blocksEnd: () => ivr.blocksEnd(),
    execute: (name, args, abort) => ivr.tool(name, args, abort),
  };
  return { ivr, events, io, tools };
}
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent: any[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit("close"); }
  frame(value: object) { this.emit("message", Buffer.from(JSON.stringify(value)), false); }
}
afterEach(() => vi.useRealTimers());

describe("FleetPride November 9 offline replay; no network or paid model", () => {
  it("parses the actual menu and chooses parts, not service", () => {
    expect(listedOptions(fleet)).toEqual([{ digits: "1", label: "For parts" }, { digits: "2", label: "For service" }]);
    expect(chooseMenuOption(fleet, goal)?.digits).toBe("1");
  });
  it.each([
    ["parts department", "parts"], ["new tyres", "tires"], ["repair", "service"],
    ["sales department", "sales"], ["invoice question", "billing"], ["dispatcher", "dispatch"],
    ["warranty claims", "warranty claims"], ["нужны запчасти", "parts"], ["ремонт", "service"],
  ])("matches objective %s to heard %s, including arbitrary labels", (objective, department) => {
    expect(chooseMenuOption(`For ${department}, press three. For unrelated inquiries, press seven.`, objective)?.digits).toBe("3");
  });
  it("uses the structured goal, not forbidden actions, private facts or incidental parking", () => {
    const instruction = "Owner-approved call plan.\n" + JSON.stringify({
      goal: "Reach parts department", sayAsk: ["Ask where to park"], ownerFacts: ["I need service"],
      disclosurePolicy: { forbidden: ["Do not reserve parking or pay billing"] },
    });
    expect(chooseMenuOption(fleet, instruction)?.digits).toBe("1");
    expect(chooseMenuOption("For parts press one. For service press two.", "parts or service")).toBeUndefined();
  });
  it.each(["C-reserve", "streaming-v1"] as const)("sends Retell digit 1 with matching response_id, silently (%s)", async version => {
    const f = setup(goal), stream = vi.fn<EngineStream>();
    const end = vi.fn(), registry = new RetellEngineRegistry(stream, {
      phone: true, phoneProfile: () => "C", phoneConversationVersion: () => version,
      telephoneTools: () => f.tools, onNoHuman: end,
    });
    f.io.send.mockImplementation(async (digits, abort) => registry.pressDigits("task", digits, abort, f.ivr.status().menuHash));
    try {
      const r = registry.reserve("fixture", goal, "task");
      registry.registered("task", "call_fixture");
      const ws = new Socket();
      registry.attach(ws as any, `/retell-phone-engine/${r.ticket}/call_fixture`);
      ws.frame({ interaction_type: "call_details", call: { call_id: "call_fixture", call_type: "phone_call" } });
      ws.frame({ interaction_type: "response_required", response_id: 42, transcript: [user(fleet)] });
      await vi.waitFor(() => expect(f.io.send).toHaveBeenCalledTimes(1));
      expect(ws.sent).toContainEqual(expect.objectContaining({ response_id: 42, digit_to_press: "1", content: "", content_complete: true }));
      expect(ws.sent.some(f => f.content)).toBe(false);
      expect(stream).not.toHaveBeenCalled();
      expect(f.events).toContainEqual(expect.objectContaining({
        kind: "press", digits: "1", heard: fleet, afterTurn: 0,
        result: "command_sent_destination_acceptance_unknown", sentAt: expect.any(String),
      }));
      expect(end).not.toHaveBeenCalled();
      expect(() => registry.pressDigits("task", "2", f.io.send.mock.calls[0][1], f.ivr.status().menuHash)).toThrow();
    } finally { registry.dispose(); }
  });
  it("unknown semantic match hands the complete menu to model tools without audible filler", async () => {
    const menu = "For product support press three. For returns press four.";
    const f = setup("Reach warranty claims");
    const stream = vi.fn<EngineStream>(async function* () {
      yield { type: "text", text: "This must never be spoken over IVR." };
      const tool = { name: "press_digits", call_id: "choice", arguments: JSON.stringify({
        digits: "3", menu_complete: true, heard_menu: menu, reason: "Warranty is handled by the heard product support department",
      }) };
      yield { type: "complete", output: [tool], tools: [tool] };
    });
    const speak = vi.fn(), engine = new SecretaryConversationEngine("fixture", "Reach warranty claims", stream, true, undefined, [], f.tools);
    await engine.respond([user(menu)], signal(), speak);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(f.io.send.mock.calls[0][0]).toBe("3");
    expect(speak).not.toHaveBeenCalled();
  });
  it("no usable model choice falls back to 0, audit first, no duplicate dispatch", async () => {
    const menu = "For the restaurant press four.";
    const f = setup("Reach parts"), speak = vi.fn();
    const stream: EngineStream = async function* () { yield { type: "complete", tools: [], output: [] }; };
    const engine = new SecretaryConversationEngine("fixture", "Reach parts", stream, true, undefined, [], f.tools);
    await engine.respond([user(menu)], signal(), speak);
    expect(f.io.send.mock.calls[0][0]).toBe("0");
    expect(f.io.record.mock.invocationCallOrder[1]).toBeLessThan(f.io.send.mock.invocationCallOrder[0]);
    expect(await f.ivr.fallback(signal())).toBe(false);
    expect(speak).not.toHaveBeenCalled();
  });
  it.each([
    "Enter your account number then press one.",
    "For parts press one...",
  ])("does not bypass sensitive/incomplete menu gates: %s", async menu => {
    const f = setup("Reach parts"), stream = vi.fn<EngineStream>();
    const engine = new SecretaryConversationEngine("fixture", "Reach parts", stream, true, undefined, [], f.tools);
    await engine.respond([user(menu)], signal(), vi.fn());
    expect(f.io.send).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(await f.ivr.fallback(signal())).toBe(false);
  });
  it("an aborted or stale model action cannot press a digit", async () => {
    const f = setup("Reach warranty"), abort = new AbortController();
    await f.ivr.observe([user("For product support press three.")]);
    abort.abort();
    expect(await f.ivr.fallback(abort.signal)).toBe(false);
    await expect(f.ivr.tool("press_digits", JSON.stringify({ digits: "3", heard_menu: fleet, menu_complete: true }), signal())).rejects.toThrow();
    expect(f.io.send).not.toHaveBeenCalled();
  });
  it("a model transport failure uses the safe operator fallback without speaking or retrying the model", async () => {
    const f = setup("Reach warranty"), speak = vi.fn();
    const stream = vi.fn<EngineStream>(async function* () { throw Error("Fake upstream failure"); });
    const engine = new SecretaryConversationEngine("fixture", "Reach warranty", stream, true, undefined, [], f.tools);
    await engine.respond([user("For the restaurant press four.")], signal(), speak);
    expect(f.io.send.mock.calls[0][0]).toBe("0");
    expect(stream).toHaveBeenCalledTimes(1);
    expect(speak).not.toHaveBeenCalled();
  });
  it("advisory help cannot leave a complete menu silently stuck without any dispatch", async () => {
    const f = setup("Reach warranty");
    await f.ivr.observe([user("For the restaurant press four.")]);
    expect(await f.ivr.tool("request_menu_help", "{}", signal())).toMatchObject({ digits: "0", sent: true });
    expect(f.io.send.mock.calls[0][0]).toBe("0");
  });
  it("repeating menu cannot trigger no_human_20s before first press; after press it can", async () => {
    vi.useFakeTimers();
    const end = vi.fn(), guard = new PhoneLineGuard(false, end);
    guard.observe(fleet, false, true);
    for (let n = 0; n < 4; n++) {
      await vi.advanceTimersByTimeAsync(20000); guard.observe(fleet, false, true);
      expect(end).not.toHaveBeenCalled();
    }
    guard.progress("first-dispatched-menu");
    await vi.advanceTimersByTimeAsync(19999); expect(end).not.toHaveBeenCalled();
    guard.observe(fleet, false, true); guard.progress("first-dispatched-menu");
    await vi.advanceTimersByTimeAsync(1); expect(end).toHaveBeenCalledExactlyOnceWith("no_human_20s");
    guard.close();
  });
  it("hands the same audited digits/times/menu to both reviewers, redacting private numbers", async () => {
    const f = setup(goal); await f.ivr.observe([user(fleet)]); await f.ivr.navigate(signal());
    const evidence = secretaryEvidence(goal, [{ role: "guest", text: fleet }], "fixture", [], [], f.events);
    expect(evidence.ivrNavigation).toMatchObject({ status: "recorded", omitted: 0 });
    expect(evidence.ivrNavigation?.events).toContainEqual(expect.objectContaining({
      digits: "1", heard: fleet, afterTurn: 0, sentAt: expect.any(String),
      result: "command_sent_destination_acceptance_unknown",
    }));
    const privateMenu = [{ ...f.events[0], heard: "My home address is 10 Private Street. Phone +15551234567", digits: "15551234567" }];
    const redacted = secretaryEvidence(goal, [{ role: "guest", text: fleet }], "fixture", [], [], privateMenu);
    expect(JSON.stringify(redacted.ivrNavigation)).not.toContain("15551234567");
    expect(JSON.stringify(redacted.ivrNavigation)).not.toContain("10 Private Street");
    expect(secretaryEvidence(goal, [{ role: "guest", text: fleet }], "fixture", [], [], []).ivrNavigation?.status).toBe("no_events_recorded");
  });
});
