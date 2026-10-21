import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { CALL_APPROVAL_RESOURCE, callApprovalWidgetHtml } from "./callApprovalWidget";

/** Tiny host/DOM simulation: never loads native runtime, DB, providers or network. */
function controlledSse() {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const waiters: Array<(result: { done: boolean; value?: Uint8Array }) => void> = [];
  let closed = false;
  const pushRaw = (text: string) => {
    const value = encoder.encode(text), waiter = waiters.shift();
    if (waiter) waiter({ done: false, value }); else chunks.push(value);
  };
  const close = () => {
    closed = true;
    while (waiters.length) waiters.shift()!({ done: true });
  };
  const response = { ok: true, body: { getReader: () => ({
    read: () => chunks.length ? Promise.resolve({ done: false, value: chunks.shift() }) :
      closed ? Promise.resolve({ done: true }) : new Promise<{ done: boolean; value?: Uint8Array }>(resolve => waiters.push(resolve)),
  }) } };
  return {
    response, pushRaw, close,
    event: (value: object) => pushRaw("data: " + JSON.stringify(value) + "\n\n"),
    attachSignal: (signal: AbortSignal) => signal.addEventListener("abort", close, { once: true }),
  };
}

function harness(options: { fetchResponse?: (url: string, init: any) => Promise<any>; audioContext?: any } = {}) {
  const nodes = new Map<string, any>();
  const messages: any[] = [];
  const fetchCalls: any[] = [];
  const listeners = new Map<string, Function>();
  const timers = new Map<number, Function>();
  let timer = 0;
  function node(id: string) {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: "", hidden: false, disabled: ["approve", "deny"].includes(id),
      className: "", classList: { toggle() {} }, setAttribute() {}, removeAttribute() {},
      children: [], parentNode: null,
      replaceChildren() { this.children.forEach((child: any) => { child.parentNode = null; }); this.children = []; },
      appendChild(child: any) { child.parentNode = this; this.children.push(child); },
      removeChild(child: any) { this.children = this.children.filter((item: any) => item !== child); child.parentNode = null; },
      addEventListener(type: string, cb: Function) { this[type] = cb; },
    });
    return nodes.get(id);
  }
  const parent = { postMessage(message: any) { messages.push(message); } };
  const window: any = {
    parent,
    addEventListener(type: string, fn: Function) { listeners.set(type, fn); },
    setTimeout(fn: Function) { timers.set(++timer, fn); return timer; },
    clearTimeout(id: number) { timers.delete(id); },
  };
  if (options.audioContext) window.AudioContext = options.audioContext;
  const script = callApprovalWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(script, {
    window,
    document: {
      getElementById: node,
      createElement: () => ({
        className: "", textContent: "", hidden: false, parentNode: null, children: [],
        appendChild(child: any) { child.parentNode = this; this.children.push(child); },
      }),
    },
    fetch: async (url: string, init: any) => {
      fetchCalls.push([url, init]);
      if (options.fetchResponse) return options.fetchResponse(url, init);
      throw new Error("fixture blocks external network");
    },
    AbortController,
    URL,
    TextDecoder,
    TextEncoder,
    atob,
  });
  function receive(data: object, source: unknown = parent) {
    listeners.get("message")!({ source, data: { jsonrpc: "2.0", ...data } });
  }
  const initialize = () => receive({ id: "talkhint-initialize", result: { protocolVersion: "2026-01-26" } });
  const card = {
    structuredContent: { call: { recipient: "Test recipient", phoneNumber: "+12025550123", instruction: "Ask hours" },
      execution: { provider: "openai", model: "gpt-realtime-2.1", voice: "marin", mode: "native_audio" },
      fallbackUrl: "https://talkhint.example/draft/mock-draft", expiresAt: "2099-01-01T00:00:00Z" },
    _meta: { "talkhint/cardApproval": { confirmation: "fixture-draft", approvalToken: "fixture-hidden-capability" } },
  };
  const show = (params: any = card) => receive({ method: "ui/notifications/tool-result", params });
  const click = (id: string) => { const n = node(id); if (!n.disabled) n.click?.(); };
  const requests = () => messages.filter(m => m.method === "tools/call");
  const flush = async (count = 20) => { for (let i = 0; i < count; i++) await Promise.resolve(); };
  const runTimers = () => { for (const callback of [...timers.values()]) callback(); };
  return { node, messages, fetchCalls, receive, initialize, card, show, click, requests, flush, timers, runTimers, window };
}
describe("inline card bridge with simulated ChatGPT host", () => {
  it("does not invoke tools until explicit click, locks doubleclicks and reports only task_id to the model", async () => {
    const h = harness();
    h.initialize(); h.show();
    expect(h.node("phoneNumber").textContent).toBe("+12025550123");
    expect(h.node("execution").textContent).toBe("gpt-realtime-2.1 · marin · openai");
    expect(h.requests()).toHaveLength(0);
    h.click("approve"); h.click("approve");
    expect(h.requests()).toHaveLength(1);
    const approval = h.requests()[0];
    expect(approval.params).toMatchObject({ name: "confirm_call_from_card",
      arguments: { approvalToken: "fixture-hidden-capability", decision: "approve" } });
    h.receive({ id: approval.id, result: { structuredContent: {
      task_id: "mock-task-1", task: { status: "starting" },
      fallbackUrl: "https://talkhint.example/api/chatgpt/secretary/tasks/mock-task-1",
    } } });
    await h.flush();
    expect(h.node("resultTitle").textContent).toContain("mock-task-1");
    expect(h.node("resultCopy").textContent).toContain("starting");
    expect(h.node("fallbackLink").href).toBe("https://talkhint.example/api/chatgpt/secretary/tasks/mock-task-1");
    expect(h.node("fallbackCopy").textContent).toContain("не встроенное live audio");
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
    expect(html).not.toMatch(/innerHTML|<iframe|<script[^>]*src=|localStorage/);
    expect(html).toContain("event.source !== window.parent");
    expect(html).toContain("ui/notifications/tool-result");
    expect(html).toContain("Подтвердить и позвонить");
    expect(html).toContain('fetch(monitorTicket.url');
    expect(html).toContain('ui/notifications/size-changed');
    expect(html).toContain('max-height:420px');
    expect(CALL_APPROVAL_RESOURCE).toBe("ui://talkhint/call-approval/v3.html");
    expect(html).not.toContain("voiceProvider");
    expect(html).not.toContain("translationLanguage");
  });
  it("does not substitute a website for an unsupported confirmation card", () => {
    const h = harness(); h.show(); h.runTimers();
    expect(h.node("approve").disabled).toBe(true);
    expect(h.node("fallback").hidden).toBe(true);
    expect(h.node("compat").textContent).toContain("ChatGPT web");
    expect(h.requests()).toHaveLength(0);
  });
  it("disables expired confirmation even when a compatible host is present", () => {
    const h = harness(); h.initialize();
    h.show({ ...h.card, structuredContent: { ...h.card.structuredContent, expiresAt: "2000-01-01T00:00:00Z" } });
    h.click("approve");
    expect(h.node("approve").disabled).toBe(true);
    expect(h.node("status").textContent).toContain("истекло");
    expect(h.requests()).toHaveLength(0);
  });
  it("requests a monitor ticket only after the owner asks and confines it to the same approved task", async () => {
    const h = harness(); h.initialize(); h.show(); h.click("approve");
    const confirmation = h.requests()[0];
    h.receive({ id: confirmation.id, result: { structuredContent: { task_id: "mock-task-1", task: { status: "starting" } } } });
    await h.flush();
    expect(h.requests().filter(r => r.params.name === "open_call_monitor")).toHaveLength(0);
    h.click("listenButton");
    const monitor = h.requests().find(r => r.params.name === "open_call_monitor");
    expect(monitor.params.arguments).toEqual({ id: "mock-task-1" });
    h.receive({ id: monitor.id, result: {
      structuredContent: { task_id: "mock-task-1", expiresAt: "2099-01-01T00:00:00Z" },
      _meta: { "talkhint/monitor": {
        url: "https://monitor.example.test/events", token: "private-fixture-ticket",
        task_id: "mock-task-1", expiresAt: "2099-01-01T00:00:00Z",
        fallbackUrl: "https://talkhint.example/api/chatgpt/secretary/tasks/mock-task-1",
      } },
    } });
    await h.flush();
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.fetchCalls[0][0]).toBe("https://monitor.example.test/events");
    expect(h.fetchCalls[0][1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer private-fixture-ticket", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(h.node("monitorState").textContent).toContain("Поток недоступен");
    expect(JSON.stringify(h.messages.filter(m => m.method === "ui/message"))).not.toContain("private-fixture-ticket");
    expect(h.requests().filter(r => r.params.name === "confirm_call_from_card")).toHaveLength(1);
    expect(h.requests().some(r => r.params.name === "start_call")).toBe(false);
  });
  it("does not accept a monitor capability for a different task", async () => {
    const h = harness(); h.initialize(); h.show(); h.click("approve");
    const approval = h.requests()[0];
    h.receive({ id: approval.id, result: { structuredContent: { task_id: "mock-task-1", task: {} } } });
    await h.flush(); h.click("listenButton");
    const monitor = h.requests().find(r => r.params.name === "open_call_monitor");
    h.receive({ id: monitor.id, result: { structuredContent: { task_id: "mock-task-1" }, _meta: {
      "talkhint/monitor": { url: "https://monitor.example.test/events", token: "hidden", task_id: "other-task" },
    } } });
    await h.flush();
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.node("monitorState").textContent).toContain("Не удалось открыть мониторинг");
  });
  it("shows saved-report wording and never reconnects a terminal task", async () => {
    const h = harness(); h.initialize(); h.show(); h.click("approve");
    const approval = h.requests()[0];
    h.receive({ id: approval.id, result: { structuredContent: {
      task_id: "mock-task-1", task: { status: "completed", summary: "Saved report" },
      fallbackUrl: "https://talkhint.example/api/chatgpt/secretary/tasks/mock-task-1",
    } } });
    await h.flush();
    expect(h.node("fallbackCopy").textContent).toContain("сохранённый отчёт");
    expect(h.node("monitorState").textContent).toContain("Задача завершена");
    h.click("reconnectButton");
    h.click("checkStatus");
    expect(h.requests().filter(r => r.params.name === "open_call_monitor")).toHaveLength(0);
    expect(h.requests().filter(r => r.params.name === "get_task")).toHaveLength(0);
  });
  it("parses live SSE, renders snapshot translations, bounds transcript DOM, plays both roles only after Listen, and reconnects only the same task", async () => {
    const firstStream = controlledSse(), secondStream = controlledSse(), thirdStream = controlledSse(), fourthStream = controlledSse();
    const streams = [firstStream, secondStream, thirdStream, fourthStream];
    const audioInstances: any[] = [];
    class AudioContextStub {
      currentTime = 1;
      destination = {};
      sources: any[] = [];
      resumeCount = 0;
      state = "suspended";
      constructor() { audioInstances.push(this); }
      resume() { this.resumeCount++; this.state = "running"; return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createBuffer(_channels: number, length: number, sampleRate: number) {
        return { duration: length / sampleRate, getChannelData: () => new Float32Array(length) };
      }
      createBufferSource() {
        const source: any = { startTime: null, stopCount: 0, connect() {}, start(time: number) { this.startTime = time; }, stop() { this.stopCount++; } };
        this.sources.push(source); return source;
      }
    }
    const h = harness({
      audioContext: AudioContextStub,
      fetchResponse: async (_url, init) => {
        const stream = streams.shift()!;
        stream.attachSignal(init.signal);
        return stream.response;
      },
    });
    h.initialize(); h.show(); h.click("approve");
    const approval = h.requests().find(r => r.params.name === "confirm_call_from_card");
    h.receive({ id: approval.id, result: { structuredContent: { task_id: "mock-task-1", task: { status: "starting" } } } });
    await h.flush();

    h.click("listenButton");
    expect(audioInstances[0].resumeCount).toBe(1); // resume happens synchronously in the gesture, before the monitor RPC is answered.
    const firstTicket = h.requests().find(r => r.params.name === "open_call_monitor");
    h.receive({ id: firstTicket.id, result: { structuredContent: { task_id: "mock-task-1" }, _meta: {
      "talkhint/monitor": { url: "https://monitor.example.test/one", token: "ticket-one", task_id: "mock-task-1" },
    } } });
    await h.flush();
    expect(h.fetchCalls).toHaveLength(1);
    expect(audioInstances[0].resumeCount).toBe(1);
    const snapshot = { type: "snapshot", task: { status: "in_progress", transcriptTurns: [
      { turnId: "snapshot-ru", role: "guest", text: "Исходная реплика", translation: "Перевод реплики", language: "ru" },
    ] } };
    const snapshotSse = "data: " + JSON.stringify(snapshot) + "\n\n";
    firstStream.pushRaw(snapshotSse.slice(0, 17));
    firstStream.pushRaw(snapshotSse.slice(17));
    firstStream.event({ type: "turn", turnId: "live-secretary", role: "secretary", text: "Фактическая реплика секретаря" });
    firstStream.event({ type: "subtitle", turnId: "live-secretary", translation: "Перевод из события", language: "ru" });
    firstStream.event({ type: "audio", role: "secretary", payload: "/w==" });
    firstStream.event({ type: "audio", role: "guest", payload: "/w==" });
    firstStream.event({ type: "audio", role: "unexpected", payload: "/w==" });
    await h.flush();

    expect(h.node("resultCopy").textContent).toBe("Статус: in_progress.");
    const transcript = h.node("transcript");
    expect(transcript.children[0].children[2].textContent).toContain("Перевод · русский: Перевод реплики");
    expect(transcript.children.some((turn: any) => turn.children[1].textContent === "Фактическая реплика секретаря")).toBe(true);
    expect(audioInstances[0].sources).toHaveLength(2);
    expect(audioInstances[0].sources.every((source: any) => source.startTime > audioInstances[0].currentTime)).toBe(true);

    h.click("listenButton");
    expect(audioInstances[0].sources.every((source: any) => source.stopCount === 1)).toBe(true);
    firstStream.event({ type: "audio", role: "guest", payload: "/w==" });
    await h.flush();
    expect(audioInstances[0].sources).toHaveLength(2);
    expect(h.fetchCalls).toHaveLength(1); // mute stops playback, not the monitor stream.

    h.click("listenButton");
    expect(audioInstances[0].resumeCount).toBe(2);
    firstStream.event({ type: "audio", role: "guest", payload: "/w==" });
    await h.flush();
    expect(audioInstances[0].sources).toHaveLength(3);

    for (let index = 0; index < 205; index++) {
      firstStream.event({ type: "turn", turnId: "bounded-" + index, role: "guest", text: "Тестовая реплика " + index });
    }
    await h.flush(600);
    firstStream.event({ type: "status", status: "transcript-batch-finished" });
    for (let attempt = 0; attempt < 30 && !h.node("monitorState").textContent.includes("transcript-batch-finished"); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(transcript.children.length).toBe(200);
    expect(h.node("monitorState").textContent).toContain("transcript-batch-finished");
    expect(transcript.children[transcript.children.length - 1].children[1].textContent).toBe("Тестовая реплика 204");

    // Reconnect while the first SSE reader is still live. Ticket acquisition must not wait for the stream reader.
    h.click("reconnectButton");
    const reconnect = h.requests().filter(r => r.params.name === "open_call_monitor")[1];
    expect(reconnect.params.arguments).toEqual({ id: "mock-task-1" });
    h.receive({ id: reconnect.id, result: { structuredContent: { task_id: "mock-task-1" }, _meta: {
      "talkhint/monitor": { url: "https://monitor.example.test/two", token: "ticket-two", task_id: "mock-task-1" },
    } } });
    await h.flush();
    expect(h.fetchCalls).toHaveLength(2);
    expect(h.fetchCalls[1][0]).toBe("https://monitor.example.test/two");
    secondStream.event({ type: "ended", reason: "expired" });
    await h.flush();
    expect(h.node("monitorState").textContent).toContain("Билет мониторинга истёк");
    expect(h.node("checkStatus").disabled).toBe(false);
    expect(h.node("reconnectButton").disabled).toBe(false);
    h.click("reconnectButton");
    const retryTicket = h.requests().filter(r => r.params.name === "open_call_monitor")[2];
    expect(retryTicket.params.arguments).toEqual({ id: "mock-task-1" });
    h.receive({ id: retryTicket.id, result: { structuredContent: { task_id: "mock-task-1" }, _meta: {
      "talkhint/monitor": { url: "https://monitor.example.test/three", token: "ticket-three", task_id: "mock-task-1" },
    } } });
    await h.flush();
    expect(h.fetchCalls).toHaveLength(3);
    expect(h.fetchCalls[2][0]).toBe("https://monitor.example.test/three");
    thirdStream.event({ type: "ended", reason: "revoked" });
    await h.flush();
    expect(h.node("monitorState").textContent).toContain("Разрешение на мониторинг отозвано");
    expect(h.node("checkStatus").disabled).toBe(false);
    expect(h.node("reconnectButton").disabled).toBe(false);
    h.click("reconnectButton");
    const permissionRetry = h.requests().filter(r => r.params.name === "open_call_monitor")[3];
    expect(permissionRetry.params.arguments).toEqual({ id: "mock-task-1" });
    h.receive({ id: permissionRetry.id, result: { structuredContent: { task_id: "mock-task-1" }, _meta: {
      "talkhint/monitor": { url: "https://monitor.example.test/four", token: "ticket-four", task_id: "mock-task-1" },
    } } });
    await h.flush();
    expect(h.fetchCalls).toHaveLength(4);
    fourthStream.event({ type: "snapshot", task: { status: "no_answer", transcriptTurns: [] } });
    await h.flush();
    expect(h.node("resultCopy").textContent).toBe("Статус: no_answer.");
    expect(h.node("reconnectButton").disabled).toBe(true);
    expect(h.requests().filter(r => r.params.name === "confirm_call_from_card")).toHaveLength(1);
    expect(h.requests().filter(r => r.params.name === "open_call_monitor").every((request: any) => request.params.arguments.id === "mock-task-1")).toBe(true);
  });
  it("keeps text monitoring available when audio is unsupported", async () => {
    const stream = controlledSse();
    const h = harness({ fetchResponse: async (_url, init) => { stream.attachSignal(init.signal); return stream.response; } });
    h.initialize(); h.show(); h.click("approve");
    const approval = h.requests()[0];
    h.receive({ id: approval.id, result: { structuredContent: { task_id: "mock-task-1", task: { status: "starting" } } } });
    await h.flush();
    h.click("listenButton");
    expect(h.node("listenButton").textContent).toContain("Аудио недоступно");
    const request = h.requests().find(r => r.params.name === "open_call_monitor");
    h.receive({ id: request.id, result: { structuredContent: { task_id: "mock-task-1" }, _meta: {
      "talkhint/monitor": { url: "https://monitor.example.test/text-only", token: "fixture", task_id: "mock-task-1",
        fallbackUrl: "https://talkhint.example/api/chatgpt/secretary/tasks/mock-task-1" },
    } } });
    await h.flush();
    stream.event({ type: "snapshot", task: { status: "in_progress", transcriptTurns: [] } });
    stream.event({ type: "turn", turnId: "text-only-turn", role: "guest", text: "Фактический текст без аудио." });
    await h.flush();
    expect(h.node("monitorState").textContent).toContain("аудио не поддерживается");
    expect(h.node("transcript").children[0].children[1].textContent).toBe("Фактический текст без аудио.");
    expect(h.node("fallbackCopy").textContent).toContain("не встраивает live audio");
    expect(h.requests().some(r => r.params.name === "start_call")).toBe(false);
  });
  it("rejects nested tool errors instead of accepting hidden monitor metadata", async () => {
    const h = harness(); h.initialize(); h.show(); h.click("approve");
    const approval = h.requests()[0];
    h.receive({ id: approval.id, result: { structuredContent: { task_id: "mock-task-1", task: {} } } });
    await h.flush();
    h.click("listenButton");
    const monitor = h.requests().find(r => r.params.name === "open_call_monitor");
    h.receive({ id: monitor.id, result: { toolResponseMetadata: { mcp_tool_result: {
      isError: true, _meta: { "talkhint/monitor": {
        url: "https://monitor.example.test/should-not-fetch", token: "bad", task_id: "mock-task-1",
      } },
    } } } });
    await h.flush();
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.node("monitorState").textContent).toContain("Не удалось открыть мониторинг");
  });
  it("unwraps documented ChatGPT toolResponseMetadata and shows the no-bridge fallback without claiming device support", async () => {
    const h = harness();
    const monitorMetadata = { "talkhint/monitor": {
      url: "https://monitor.example.test/legacy", token: "legacy-ticket", task_id: "mock-task-1",
    } };
    h.window.openai = {
      toolOutput: h.card.structuredContent,
      toolResponseMetadata: { mcp_tool_result: { _meta: h.card._meta } },
      callTool: async (name: string) => name === "confirm_call_from_card"
        ? { structuredContent: { task_id: "mock-task-1", task: { status: "starting" } } }
        : { structuredContent: { task_id: "mock-task-1" }, toolResponseMetadata: {
          call_tool_result: { structuredContent: { task_id: "mock-task-1" }, _meta: monitorMetadata },
        } },
    };
    h.runTimers();
    expect(h.node("approve").disabled).toBe(false);
    h.click("approve");
    await h.flush();
    h.click("listenButton");
    await h.flush();
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.fetchCalls[0][0]).toBe("https://monitor.example.test/legacy");
    expect(h.fetchCalls[0][1].headers.Authorization).toBe("Bearer legacy-ticket");

    const unsupported = harness();
    unsupported.show();
    unsupported.runTimers();
    expect(unsupported.node("approve").disabled).toBe(true);
    expect(unsupported.node("compat").textContent).toContain("ChatGPT tool bridge не обнаружен");
    expect(unsupported.node("compat").textContent).not.toContain("iPhone поддерживается");
    expect(unsupported.node("fallback").hidden).toBe(true);
    expect(unsupported.requests()).toHaveLength(0);
  });
});
