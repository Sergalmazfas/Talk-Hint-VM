import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { callApprovalWidgetHtml } from "./callApprovalWidget";

/** Tiny host/DOM simulation: never loads native runtime, DB, providers or network. */
function harness() {
  const nodes = new Map<string, any>();
  const messages: any[] = [];
  const listeners = new Map<string, Function>();
  const timers = new Map<number, Function>();
  let timer = 0;
  function node(id: string) {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: "", hidden: false, disabled: ["approve", "deny"].includes(id),
      className: "", classList: { toggle() {} }, setAttribute() {}, removeAttribute() {},
      addEventListener(type: string, cb: Function) { this[type] = cb; },
    });
    return nodes.get(id);
  }
  const parent = { postMessage(message: any) { messages.push(message); } };
  const window = {
    parent,
    addEventListener(type: string, fn: Function) { listeners.set(type, fn); },
    setTimeout(fn: Function) { timers.set(++timer, fn); return timer; },
    clearTimeout(id: number) { timers.delete(id); },
  };
  const script = callApprovalWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(script, { window, document: { getElementById: node } });
  function receive(data: object, source: unknown = parent) {
    listeners.get("message")!({ source, data: { jsonrpc: "2.0", ...data } });
  }
  const initialize = () => receive({ id: "talkhint-initialize", result: { protocolVersion: "2026-01-26" } });
  const card = {
    structuredContent: { call: { phoneNumber: "+12025550123", instruction: "Ask hours",
      voiceProvider: "elevenlabs", translationLanguage: "ru" }, expiresAt: "2099-01-01T00:00:00Z" },
    _meta: { "talkhint/cardApproval": { confirmation: "fixture-draft", approvalToken: "fixture-hidden-capability" } },
  };
  const show = (params: any = card) => receive({ method: "ui/notifications/tool-result", params });
  const click = (id: string) => { const n = node(id); if (!n.disabled) n.click?.(); };
  const requests = () => messages.filter(m => m.method === "tools/call");
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return { node, messages, receive, initialize, card, show, click, requests, flush, timers };
}
describe("inline card bridge with simulated ChatGPT host", () => {
  it("does not invoke tools until explicit click, locks doubleclicks and reports only task_id to the model", async () => {
    const h = harness();
    h.initialize(); h.show();
    expect(h.node("phoneNumber").textContent).toBe("+12025550123");
    expect(h.requests()).toHaveLength(0);
    h.click("approve"); h.click("approve");
    expect(h.requests()).toHaveLength(1);
    const approval = h.requests()[0];
    expect(approval.params).toMatchObject({ name: "confirm_call_from_card",
      arguments: { approvalToken: "fixture-hidden-capability", decision: "approve" } });
    h.receive({ id: approval.id, result: { structuredContent: {
      task_id: "mock-task-1", task: { status: "starting" },
    } } });
    await h.flush();
    expect(h.node("resultTitle").textContent).toContain("mock-task-1");
    expect(h.node("resultCopy").textContent).toContain("starting");
    const modelMessages = h.messages.filter(m => m.method === "ui/message");
    expect(modelMessages).toHaveLength(1);
    expect(modelMessages[0].id).toBeTruthy(); // ui/message is a request, not a notification.
    expect(JSON.stringify(modelMessages)).not.toContain("fixture-hidden-capability");
    h.show(); // Host replay must not unlock a submitted approval.
    h.click("approve");
    expect(h.requests()).toHaveLength(1);
    h.click("checkStatus");
    expect(h.requests()[1].params).toEqual({ name: "get_task", arguments: { id: "mock-task-1" } });
    h.receive({ id: h.requests()[1].id, result: { structuredContent: { status: "completed", summary: "Open at nine" } } });
    await h.flush();
    expect(h.node("resultCopy").textContent).toContain("Open at nine");
    expect(h.requests().filter(r => r.params.name === "confirm_call_from_card")).toHaveLength(1);
  });
  it("keeps approval disabled without the UI-only metadata, even if a model supplies similar public fields", () => {
    const h = harness(); h.initialize();
    h.show({ structuredContent: { ...h.card.structuredContent, approvalToken: "not-trusted", confirmation: "draft" } });
    h.click("approve");
    expect(h.node("approve").disabled).toBe(true);
    expect(h.requests()).toHaveLength(0);
  });
  it("ignores non-parent messages and never interprets recipient/goal as HTML", () => {
    const h = harness(); h.initialize();
    h.receive({ method: "ui/notifications/tool-result", params: h.card }, {});
    expect(h.node("approve").disabled).toBe(true);
    const malicious = "<img src=x onerror=alert(1)>";
    h.show({ ...h.card, structuredContent: { call: { ...h.card.structuredContent.call, instruction: malicious } } });
    expect(h.node("instruction").textContent).toBe(malicious);
    expect(h.requests()).toHaveLength(0);
  });
  it("denies inside the chat without a launch or model follow-up", async () => {
    const h = harness(); h.initialize(); h.show(); h.click("deny");
    const r = h.requests()[0];
    expect(r.params.arguments.decision).toBe("deny");
    h.receive({ id: r.id, result: { structuredContent: { status: "denied" } } });
    await h.flush();
    expect(h.node("approve").disabled).toBe(true);
    expect(h.messages.filter(m => m.method === "ui/message")).toHaveLength(0);
  });
  it("does not retry on an ambiguous timeout or re-enable the confirmation", async () => {
    const h = harness(); h.initialize(); h.show(); h.click("approve");
    for (const callback of [...h.timers.values()]) callback();
    await h.flush();
    h.click("approve");
    expect(h.requests()).toHaveLength(1);
    expect(h.node("status").textContent).toContain("Не удалось достоверно");
    expect(h.node("approve").disabled).toBe(true);
  });
  it("does not load external assets, send fetches or use unsafe HTML rendering", () => {
    const html = callApprovalWidgetHtml();
    expect(html).not.toMatch(/\bfetch\s*\(|innerHTML|<iframe|<script[^>]*src=|localStorage/);
    expect(html).toContain("event.source !== window.parent");
    expect(html).toContain("ui/notifications/tool-result");
  });
});
