import { describe, it, expect } from "vitest";
import { runInNewContext } from "node:vm";
import { callApprovalWidgetHtml } from "./callApprovalWidget";

function harness(options: { state?: object; host?: boolean; respond?: (name: string, args: any) => any; noApproval?: boolean; persistThrows?: boolean } = {}) {
  const nodes = new Map<string, any>(), listeners = new Map<string, Function>();
  const calls: any[] = [], states: any[] = [], sent: any[] = [];
  function node(id: string) {
    if (!nodes.has(id)) nodes.set(id, { textContent: "", hidden: ["getResult", "report"].includes(id),
      disabled: ["approve", "deny"].includes(id), addEventListener(_event: string, fn: Function) { this.click = fn; } });
    return nodes.get(id);
  }
  const meta = { "talkhint/cardApproval": { confirmation: "secret-confirmation", approvalToken: "secret-approval" } };
  const output = { call: { phoneNumber: "+12025550123", instruction: "Ask opening hours", clientRequestId: "56fa4264-8b0a-4692-bcb2-77b03c145631" },
    expiresAt: new Date(Date.now() + 60_000).toISOString(), execution: { provider: "retell", voice: "retell-Merritt",
      outgoing: { fromNumber: "+12025550999", personality: { name: "Катя", version: 2 } } } };
  const parent = { postMessage(value: any) { sent.push(value); } };
  const host = options.host === false ? undefined : {
    toolOutput: output, toolResponseMetadata: options.noApproval ? undefined : meta, widgetState: options.state,
    setWidgetState(state: any) { if (options.persistThrows) throw new Error("Host state unavailable"); states.push(state); },
    async callTool(name: string, args: any) { calls.push({ name, args }); return options.respond?.(name, args) ??
      { structuredContent: { task_id: "task-alice", task: { id: "task-alice" } } }; },
  };
  const window = { parent, openai: host, addEventListener(name: string, fn: Function) { listeners.set(name, fn); },
    setTimeout() { return 1; }, clearTimeout() {} };
  const html = callApprovalWidgetHtml();
  runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)![1], {
    window, document: { getElementById: node }, Map, Date, Error, JSON, Object, String, Array, Promise,
  });
  return { node, calls, states, sent, parent, listeners, output, meta,
    async click(id: string) { if (!node(id).disabled) await node(id).click(); } };
}
describe("ChatGPT single confirmation and saved final report widget", () => {
  it("contains no player, live stream, external report screen, polling or audio APIs", () => {
    const html = callApprovalWidgetHtml();
    expect(html).toContain("Подтвердить и позвонить");
    expect(html).toContain("Получить итог звонка");
    expect(html).not.toMatch(/AudioContext|EventSource|<audio|<a |fetch\(|setInterval|open_call_monitor|read_call_turns|listenButton|reconnectButton/);
  });
  it("shows exact task, provider, outgoing line and Katya version before approval; does not auto-call", () => {
    const h = harness();
    expect(h.node("phoneNumber").textContent).toBe("+12025550123");
    expect(h.node("execution").textContent).toContain("Катя v2");
    expect(h.node("execution").textContent).toContain("retell-Merritt");
    expect(h.calls).toEqual([]);
  });
  it("one explicit approval uses the hidden capability once even on double tap", async () => {
    const h = harness();
    await Promise.all([h.click("approve"), h.click("approve")]);
    expect(h.calls).toEqual([{ name: "confirm_call_from_card", args: {
      confirmation: "secret-confirmation", approvalToken: "secret-approval", decision: "approve" } }]);
    expect(h.node("getResult").hidden).toBe(false);
    expect(h.node("preview").hidden).toBe(true);
    expect(h.states.at(-1)).toEqual({ taskId: "task-alice", clientRequestId: h.output.call.clientRequestId });
    expect(h.states[0]).toEqual({ taskId: null, clientRequestId: h.output.call.clientRequestId });
    expect(JSON.stringify(h.states)).not.toContain("secret-");
  });
  it("denial makes no result reader or outbound start", async () => {
    const h = harness({ respond: () => ({ structuredContent: { status: "denied" } }) });
    await h.click("deny");
    expect(h.calls[0].args.decision).toBe("deny");
    expect(h.node("getResult").hidden).toBe(true);
    expect(h.node("status").textContent).toContain("не начат");
  });
  it("retrieves full saved text in the same card without another confirmation/call", async () => {
    const speech = "<img src=x onerror=bad> " + "full speech ".repeat(12_000);
    const h = harness({ state: { taskId: "task-alice" }, respond: () => ({
      structuredContent: { task_id: "task-alice", ready: true, status: "completed",
        summary: "Opening hours confirmed.", transcript: "Собеседник: " + speech },
    }) });
    expect(h.calls).toHaveLength(0);
    await h.click("getResult"); await h.click("getResult");
    expect(h.calls.map(c => c.name)).toEqual(["get_call_result", "get_call_result"]);
    expect(h.node("summary").textContent).toBe("Opening hours confirmed.");
    expect(h.node("transcript").textContent).toBe("Собеседник: " + speech);
    expect(h.node("report").hidden).toBe(false);
  });
  it("not-ready shows no partial transcript and starts no automatic checks", async () => {
    const h = harness({ state: { taskId: "task-alice" }, respond: () => ({
      structuredContent: { task_id: "task-alice", ready: false, status: "connected" },
    }) });
    await h.click("getResult");
    expect(h.calls).toHaveLength(1);
    expect(h.node("report").hidden).toBe(true);
  });
  it("lost approval response preserves only locator and offers read-only recovery, not redial", async () => {
    const h = harness({ respond(name) { if (name === "confirm_call_from_card") throw new Error("network timeout");
      return { structuredContent: { task_id: "task-alice", ready: false, status: "connected" } }; } });
    await h.click("approve"); await h.click("getResult");
    expect(h.calls.map(c => c.name)).toEqual(["confirm_call_from_card", "get_call_result"]);
    expect(h.calls[1].args).toEqual({ clientRequestId: h.output.call.clientRequestId });
  });
  it("untrusted frames and stale cards cannot start a call after restoring a locator", () => {
    const h = harness({ state: { taskId: "task-alice" } });
    h.listeners.get("message")!({ source: {}, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result",
      params: { structuredContent: h.output, _meta: h.meta } } });
    expect(h.calls).toHaveLength(0);
    expect(h.node("preview").hidden).toBe(true);
  });
  it("historical results are only locators, not authority to reveal saved speech or replace this call", () => {
    const h = harness({ state: { taskId: "task-alice" } });
    const receive = (structuredContent: object) => h.listeners.get("message")!({ source: h.parent,
      data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent } } });
    receive({ task_id: "task-alice", ready: true, transcript: "old private speech", summary: "old result" });
    expect(h.node("report").hidden).toBe(true);
    expect(h.node("transcript").textContent).toBe("");
    receive({ task_id: "other-task", task: { id: "other-task" } });
    expect(h.states.at(-1).taskId).toBe("task-alice");
    expect(h.calls).toHaveLength(0);
  });
  it("fails closed without a real ChatGPT bridge", () => {
    const h = harness({ host: false });
    expect(h.node("approve").disabled).toBe(true);
    expect(h.calls).toHaveLength(0);
  });
  it("recovers an old preview without approval secrets using only the original request locator", async () => {
    const h = harness({ noApproval: true, respond: () => ({ structuredContent: {
      ready: false, status: "not_found", note: "Поручение не найдено в текущем аккаунте.",
    } }) });
    await h.click("getResult");
    expect(h.calls).toEqual([{ name: "get_call_result", args: { clientRequestId: h.output.call.clientRequestId } }]);
    expect(h.node("status").textContent).toContain("не найдено");
    expect(h.node("preview").hidden).toBe(true);
  });
  it("optional persistence failure does not hide an existing result; accepts text-only host responses", async () => {
    const h = harness({ state: { taskId: "task-alice" }, persistThrows: true, respond: () => ({
      content: [{ type: "text", text: JSON.stringify({ task_id: "task-alice", ready: true,
        status: "completed", summary: "Согласовали встречу.", transcript: "Собеседник: Да." }) }],
    }) });
    await h.click("getResult");
    expect(h.node("summary").textContent).toBe("Согласовали встречу.");
    expect(h.node("report").hidden).toBe(false);
  });
  it("shows actual RPC code and reason instead of blaming ChatGPT; retries only reads", async () => {
    const h = harness({ host: false });
    h.listeners.get("message")!({ source: h.parent, data: { jsonrpc: "2.0", id: "talkhint-initialize", result: {} } });
    h.listeners.get("message")!({ source: h.parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result",
      params: { structuredContent: { task_id: "task-alice", ready: false } } } });
    const reading = h.click("getResult");
    const rpc = h.sent.at(-1);
    expect(rpc.params.name).toBe("get_call_result");
    h.listeners.get("message")!({ source: h.parent, data: { jsonrpc: "2.0", id: rpc.id,
      error: { code: -32602, message: "Tool not available to this widget" } } });
    await reading;
    expect(h.node("status").textContent).toContain("-32602");
    expect(h.node("status").textContent).toContain("Tool not available");
    expect(h.node("getResult").disabled).toBe(false);
    expect(h.calls).toHaveLength(0);
  });
  it("uses compatibility transport only for a failed read, never resends approval", async () => {
    const h = harness({ state: { taskId: "task-alice" }, respond: () => ({ structuredContent: {
      task_id: "task-alice", ready: true, status: "completed", summary: "Готово.", transcript: "Да.",
    } }) });
    h.listeners.get("message")!({ source: h.parent, data: { jsonrpc: "2.0", id: "talkhint-initialize", result: {} } });
    const reading = h.click("getResult");
    const rpc = h.sent.at(-1);
    h.listeners.get("message")!({ source: h.parent, data: { jsonrpc: "2.0", id: rpc.id,
      error: { code: -32601, message: "tools/call unsupported" } } });
    await reading;
    expect(h.calls).toEqual([{ name: "get_call_result", args: { id: "task-alice" } }]);
    expect(h.node("summary").textContent).toBe("Готово.");
  });
});
