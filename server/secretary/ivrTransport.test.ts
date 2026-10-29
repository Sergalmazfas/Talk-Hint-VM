import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import twilio from "twilio";
import { RetellEngineRegistry } from "../secretaryLab/retellEngine";
import { SecretaryConversationEngine, type EngineStream } from "./conversationEngine";
import { SecretaryIvr } from "./ivr";

class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent: any[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit("close"); }
  frame(f: object) { this.emit("message", Buffer.from(JSON.stringify(f)), false); }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const menu = "For tires and repair press 2. For a manager press 8.";
describe("Secretary IVR transport contract — local Twilio menu / fake Retell, NOT PSTN proof", () => {
  it("generates a real Twilio Gather menu without provisioning a number or making a call", () => {
    const xml = new twilio.twiml.VoiceResponse();
    xml.gather({ input: ["dtmf"], numDigits: 1, timeout: 10, action: "/fixture-only/selection" }).say(menu);
    expect(xml.toString()).toContain('<Gather input="dtmf" numDigits="1" timeout="10" action="/fixture-only/selection">');
    expect(xml.toString()).toContain("<Say>" + menu + "</Say>");
    expect(xml.toString()).not.toContain("<Hangup");
  });
  it("a model press_digits reaches the current response exactly once, with no Twilio redirect/end/stream restart", async () => {
    const record = vi.fn(async () => {});
    let registry!: RetellEngineRegistry;
    const ivr = new SecretaryIvr({ send: async (digits, signal) => registry.pressDigits("task", digits, signal),
      record, notify: vi.fn(), remember: vi.fn() });
    const tools = { beforeTurn: async (turns: any) => { await ivr.observe(turns); return ivr.context(); },
      execute: (name: string, raw: string, signal: AbortSignal) => ivr.tool(name, raw, signal),
      blocksEnd: () => ivr.blocksEnd() };
    const stream: EngineStream = async function* () {
      const t = { type: "function_call", call_id: "press-1", name: "press_digits",
        arguments: JSON.stringify({ digits: "2", heard_menu: menu, menu_complete: true }) };
      yield { type: "complete", output: [t], tools: [t] };
    };
    registry = new RetellEngineRegistry(stream, { phone: true, telephoneTools: () => tools });
    try {
      const r = registry.reserve("owner", "Reach tire repair.", "task");
      registry.registered("task", "call_fixture");
      const ws = new Socket(); registry.attach(ws as any, `/retell-phone-engine/${r.ticket}/call_fixture`);
      ws.frame({ interaction_type: "response_required", response_id: 1, transcript: [{ role: "user", content: menu }] });
      await tick();
      expect(ws.sent.filter(f => f.digit_to_press)).toEqual([{
        response_type: "response", response_id: 1, content: "", content_complete: true, digit_to_press: "2",
      }]);
      expect(ws.sent.filter(f => f.response_type === "response" && f.content_complete)).toHaveLength(1);
      expect(ws.sent.some(f => f.end_call || f.transfer_number)).toBe(false);
      expect(ws.readyState).toBe(1);
      // Duplicate response ID cannot press again.
      ws.frame({ interaction_type: "response_required", response_id: 1, transcript: [{ role: "user", content: menu }] });
      await tick(); expect(ws.sent.filter(f => f.digit_to_press)).toHaveLength(1);
    } finally { registry.dispose(); }
  });
  it("owner's choice uses a distinct silent agent_interrupt when no model response is pending", () => {
    const registry = new RetellEngineRegistry(undefined, { phone: true });
    try {
      const r = registry.reserve("owner", "Reach tires", "task"); registry.registered("task", "call_fixture");
      const ws = new Socket(); registry.attach(ws as any, `/retell-phone-engine/${r.ticket}/call_fixture`);
      registry.pressDigits("task", "1#");
      registry.pressDigits("task", "0");
      expect(ws.sent.filter(f => f.digit_to_press).map(f => [f.response_type, f.interrupt_id, f.digit_to_press]))
        .toEqual([["agent_interrupt", 1, "1#"], ["agent_interrupt", 2, "0"]]);
      const abort = new AbortController(); abort.abort();
      expect(() => registry.pressDigits("task", "2", abort.signal)).toThrow();
      expect(() => registry.pressDigits("other-task", "2")).toThrow();
      ws.close(); expect(() => registry.pressDigits("task", "2")).toThrow();
    } finally { registry.dispose(); }
  });
  it("blocks prepare_call_end during menu navigation/owner wait", async () => {
    let rounds = 0;
    const stream: EngineStream = async function* (request) {
      if (!rounds++) {
        const t = { type: "function_call", call_id: "end", name: "prepare_call_end",
          arguments: JSON.stringify({ farewell: "Goodbye.", reason: "completed" }) };
        yield { type: "complete", output: [t], tools: [t] };
      } else {
        expect(JSON.parse(request.input.at(-1).output).ok).toBe(false);
        yield { type: "complete", output: [], tools: [] };
      }
    };
    const engine = new SecretaryConversationEngine("owner", "Reach tires", stream, true, undefined, [], {
      beforeTurn: async () => "Waiting for owner", execute: vi.fn(), blocksEnd: () => true,
    });
    expect(await engine.respond([{ role: "user", content: menu }], new AbortController().signal, vi.fn())).toBeUndefined();
  });
});
