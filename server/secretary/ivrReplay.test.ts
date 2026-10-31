import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import replays from "./fixtures/ivr-replays.json";
import { SecretaryIvr, type IvrEvent } from "./ivr";
import { chooseMenuOption, mergeIvrTranscript } from "./ivrSelection";
import { RetellEngineRegistry } from "../secretaryLab/retellEngine";
import { SecretaryConversationEngine, type EngineStream, type SpokenTurn } from "./conversationEngine";

const signal = () => new AbortController().signal;
const user = (content: string): SpokenTurn => ({ role: "user", content });
const first = replays[0].menus[0], second = replays[0].menus[1];
function fixture(goal = replays[0].goal) {
  const events: IvrEvent[] = [];
  const io = { send: vi.fn(async (_digits: string, _signal?: AbortSignal) => {}),
    record: vi.fn(async (event: IvrEvent) => { events.push(event); }),
    notify: vi.fn(async () => {}), remember: vi.fn(async () => {}) };
  return { io, events, ivr: new SecretaryIvr(io, [], goal) };
}
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent: any[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit("close"); }
  frame(value: object) { this.emit("message", Buffer.from(JSON.stringify(value)), false); }
}
describe("KATYA.1 / KATYA.4 — recorded-menu replay, fake transport, no PSTN", () => {
  it.each(replays)("$name passes both levels through the actual Engine/Retell protocol", async replay => {
    let registry: RetellEngineRegistry;
    const sentEvents: IvrEvent[] = [];
    const ivr = new SecretaryIvr({
      send: async (digits, abort) => registry.pressDigits("task", digits, abort),
      record: async e => { sentEvents.push(e); },
      notify: vi.fn(), remember: vi.fn(),
    }, [], replay.goal);
    const stream = vi.fn<EngineStream>();
    registry = new RetellEngineRegistry(stream, { phone: true,
      telephoneTools: () => ({
        beforeTurn: async turns => { await ivr.observe(turns); return ivr.context(); },
        navigate: abort => ivr.navigate(abort),
        execute: (name, args, abort) => ivr.tool(name, args, abort),
        blocksEnd: () => ivr.blocksEnd(),
      }),
      onTranscript: async (_id, turns) => { await ivr.observe(turns); },
    });
    try {
      const reservation = registry.reserve("fixture owner", replay.goal, "task");
      registry.registered("task", "fixture_call");
      const socket = new Socket();
      registry.attach(socket as any, `/retell-phone-engine/${reservation.ticket}/fixture_call`);
      const turns: SpokenTurn[] = [];
      for (const [index, menu] of replay.menus.entries()) {
        // No premature DTMF on partial ASR updates.
        socket.frame({ interaction_type: "update_only", transcript: [...turns, user(menu.slice(0, 35))] });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(socket.sent.filter(f => f.digit_to_press)).toHaveLength(index);
        turns.push(user(menu));
        socket.frame({ interaction_type: "response_required", response_id: index + 1, transcript: turns });
        await vi.waitFor(() => expect(socket.sent.filter(f => f.digit_to_press)).toHaveLength(index + 1));
      }
      expect(socket.sent.filter(f => f.digit_to_press).map(f => f.digit_to_press)).toEqual(replay.expected);
      expect(socket.sent.some(f => f.end_call || f.transfer_number)).toBe(false);
      expect(stream).not.toHaveBeenCalled();
      const dispatches = sentEvents.filter(e => e.sentAt);
      expect(dispatches.map(e => e.heard.trim())).toEqual(replay.menus);
      expect(dispatches.every(e => e.reason && e.menuHash && e.sentAt && e.afterTurn !== undefined)).toBe(true);
      expect(dispatches.map(e => e.afterTurn)).toEqual([0, 1]);
    } finally { registry.dispose(); }
  });
  it("supports third and subsequent levels, never quoting old menus", async () => {
    const { ivr, io } = fixture();
    const turns: SpokenTurn[] = [];
    for (let i = 0; i < 7; i++) {
      const menu = `Level ${i}. For the general manager, press seven.`;
      turns.push(user(menu)); await ivr.observe(turns);
      await expect(ivr.navigate(signal())).resolves.toBe(true);
      expect(ivr.status().menu.trim()).toBe(menu);
    }
    expect(io.send).toHaveBeenCalledTimes(7);
    expect(ivr.status().pressesWithoutNewMenu).toBe(1);
  });
  it("handles a new menu extending the same ASR turn", async () => {
    const { ivr, io } = fixture();
    await ivr.observe([user(first)]); await ivr.navigate(signal());
    await ivr.observe([user(first + " For the")]);
    expect(ivr.status().menu.trim()).toBe("For the");
    expect(ivr.status().choices).toEqual([]);
    expect(await ivr.navigate(signal())).toBe(false);
    await ivr.observe([user(first + " " + second)]);
    expect(ivr.status().choices).not.toContain("8");
    await ivr.navigate(signal());
    expect(io.send.mock.calls.map(c => c[0])).toEqual(["8", "7"]);
  });
  it("does not replay old digits on a live human answer or goodbye", async () => {
    const { ivr, io } = fixture();
    await ivr.observe([user(first)]); await ivr.navigate(signal());
    await ivr.observe([user(first), user("Hello, the general manager speaking.")]);
    expect(await ivr.navigate(signal())).toBe(false);
    await ivr.observe([user(first), user("Goodbye.")]);
    expect(await ivr.navigate(signal())).toBe(false);
    expect(io.send).toHaveBeenCalledTimes(1);
  });
  it("rejects an old menu quote and an aborted response on the second level", async () => {
    const { ivr, io } = fixture();
    await ivr.observe([user(first)]); await ivr.navigate(signal());
    await ivr.observe([user(first), user(second)]);
    await expect(ivr.tool("press_digits", JSON.stringify({ digits: "8", heard_menu: first, menu_complete: true }), signal())).rejects.toThrow();
    const abort = new AbortController(); abort.abort();
    await expect(ivr.navigate(abort.signal)).rejects.toThrow();
    expect(io.send).toHaveBeenCalledTimes(1);
  });
  it("keeps the five-digit budget across fragmented repetitions of the SAME menu", async () => {
    const { ivr, io } = fixture();
    const menu = "For a manager, press 12345.";
    await ivr.observe([user(menu)]);
    await ivr.tool("press_digits", JSON.stringify({ digits: "12345", heard_menu: menu, menu_complete: true }), signal());
    await ivr.observe([user(menu), { role: "agent", content: "representative" }, user("For a manager,")]);
    await ivr.observe([user(menu), { role: "agent", content: "representative" }, user(menu)]);
    await expect(ivr.tool("press_digits", JSON.stringify({ digits: "0", heard_menu: menu, menu_complete: true }), signal())).rejects.toThrow(/limit/);
    expect(io.send).toHaveBeenCalledTimes(1);
  });
  it("failed help immediately chooses general manager; never waits or sends push twice", async () => {
    const { ivr, io, events } = fixture();
    io.notify.mockRejectedValue(Error("push failed"));
    await ivr.observe([user(second)]);
    await expect(ivr.tool("request_menu_help", "{}", signal())).resolves.toMatchObject({ sent: true, digits: "7" });
    await ivr.tool("request_menu_help", "{}", signal());
    expect(io.notify).toHaveBeenCalledTimes(1);
    expect(io.send).toHaveBeenCalledTimes(1);
    expect(ivr.status().waiting).toBe(false);
    expect(events.some(e => e.kind === "push_failed")).toBe(true);
    expect(events.at(-1)?.reason).toBe("help_unavailable:no_exact_option_general_manager");
  });
  it("stalled notification is bounded below three seconds and cannot later change state", async () => {
    vi.useFakeTimers();
    try {
      const { ivr, io } = fixture();
      let finish!: () => void;
      io.notify.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
      await ivr.observe([user(second)]);
      const action = ivr.tool("request_menu_help", "{}", signal());
      await vi.advanceTimersByTimeAsync(2500);
      expect(await action).toMatchObject({ sent: true, digits: "7" });
      expect(io.send).toHaveBeenCalledTimes(1);
      finish(); await vi.advanceTimersByTimeAsync(1);
      expect(ivr.status()).toMatchObject({ waiting: false, helpDelivery: "unavailable" });
      expect(io.send).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("failed help uses offered repeat, or an audible fallback if there is no safe choice", async () => {
    const { ivr, io } = fixture();
    io.notify.mockRejectedValue(Error("push failed"));
    await ivr.observe([user("For accounts press one. To repeat the menu press pound.")]);
    expect(await ivr.tool("request_menu_help", "{}", signal())).toMatchObject({ digits: "#", sent: true });
    const other = fixture();
    other.io.notify.mockRejectedValue(Error("push failed"));
    await other.ivr.observe([user("For account number enter one.")]);
    expect(await other.ivr.tool("request_menu_help", "{}", signal())).toMatchObject({
      waiting: false, spokenFallback: "representative",
    });
    expect(other.io.send).not.toHaveBeenCalled();
  });
  it("emits the audible help fallback without another slow model call", async () => {
    const stream: EngineStream = async function* () {
      const call = { type: "function_call", call_id: "help", name: "request_menu_help", arguments: "{}" };
      yield { type: "complete", output: [call], tools: [call] };
    };
    const { ivr, io } = fixture();
    io.notify.mockRejectedValue(Error("push failed"));
    const engine = new SecretaryConversationEngine("owner", "Reach a person", stream, true, undefined, [], {
      beforeTurn: async turns => { await ivr.observe(turns); return ivr.context(); },
      execute: (name, args, abort) => ivr.tool(name, args, abort), blocksEnd: () => ivr.blocksEnd(),
    });
    const emit = vi.fn();
    await engine.respond([user("For account number enter one.")], signal(), emit);
    expect(emit).toHaveBeenCalledExactlyOnceWith("representative");
    expect(engine.report.usage.requests).toBe(1);
  });
  it("does not select unoffered digits, unfinished menus or sensitive input", async () => {
    const { ivr, io } = fixture();
    await ivr.observe([user("For the general manager press seven. For...")]);
    expect(await ivr.navigate(signal())).toBe(false);
    await ivr.observe([user("For a credit card payment to the manager enter seven.")]);
    expect(await ivr.navigate(signal())).toBe(false);
    expect(io.send).not.toHaveBeenCalled();
    expect(chooseMenuOption("For the restaurant press four.", "Parking reservation")).toBeUndefined();
    expect(chooseMenuOption("For fuel, press one, for store, press two, for general manager, press seven", "Parking reservation")?.digits).toBe("7");
    expect(chooseMenuOption("Press one for fuel, press two for general manager", "Parking reservation")?.digits).toBe("2");
  });
  it("preserves chronological menu → digit → next menu → digit → goodbye across snapshots", () => {
    const spoken = [first, second, "Goodbye."].map((text, index) => ({ id: `retell:${index}`, role: "guest", text }));
    const actions = [{ id: "ivr:1", role: "secretary", text: "8", afterTurn: 0 },
      { id: "ivr:3", role: "secretary", text: "7", afterTurn: 1 }];
    expect(mergeIvrTranscript(spoken, actions).map(t => t.id)).toEqual(["retell:0", "ivr:1", "retell:1", "ivr:3", "retell:2"]);
  });
});
