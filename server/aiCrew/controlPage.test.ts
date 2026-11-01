import { runInNewContext } from "node:vm";
import { describe, it, expect } from "vitest";
import { crewControlPage } from "./controlPage";
import { initialState } from "./domain";

// Execute the shipped inline JS and actual event handlers without adding an
// auth bypass or browser dependency. Network, dialogs and timers are explicit
// fakes; no provider, production request, paid action or real call is possible.
class Element {
  children: Element[] = [];
  listeners: Record<string, ((event?: unknown) => unknown)[]> = {};
  className = ""; disabled = false; value = ""; type = ""; id = "";
  private ownText = "";
  constructor(public tagName = "div") {}
  set textContent(v: unknown) { this.ownText = String(v ?? ""); this.children = []; }
  get textContent(): string { return this.ownText + this.children.map(c => c.textContent).join("\n"); }
  get firstChild() { return this.children[0] ?? null; }
  appendChild(el: Element) { this.children.push(el); return el; }
  removeChild(el: Element) { this.children.splice(this.children.indexOf(el), 1); return el; }
  addEventListener(kind: string, callback: (event?: unknown) => unknown) { (this.listeners[kind] ??= []).push(callback); }
  setAttribute(name: string, value: string) { (this as any)[name] = value; }
}
function state(status?: "prepared" | "author" | "review" | "owner") {
  const s = initialState(); s.revision = 10;
  if (status) {
    s.tasks.push({ id: "a1616161-aaaa-4bbb-8ccc-dddddddddddd", title: "Latency", closed: false, phase: "analysis",
      steps: [{ phase: "analysis", holder: "owner", updatedAt: "2026-11-01T12:00:00Z", note: "owner task", actor: "owner" }],
      hintPilot: { candidate: "latency", status, ownerId: "owner", ratesConfirmedBy: "owner", pricingUrl: "official",
        evidenceHash: "hash", evidence: { version: 1, calls: [], reports: [], problems: [], limitations: [] } } });
  }
  return s;
}
const payload = (s = state(), csrf = "a".repeat(64)) => ({
  initialized: true, environment: "production", state: s, csrf, stale: [], keyConfigured: true, codeVersion: {},
});
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
async function page(initial = payload()) {
  const elements = new Map<string, Element>();
  for (const m of crewControlPage.matchAll(/id="([^"]+)"/g)) {
    const e = new Element(); e.id = m[1]; elements.set(m[1], e);
  }
  // HTML input default values are relevant even before the first fetch.
  for (const m of crewControlPage.matchAll(/<input\b[^>]*>/g)) {
    const id = /id="([^"]+)"/.exec(m[0])?.[1], value = /value="([^"]*)"/.exec(m[0])?.[1];
    if (id && value !== undefined) elements.get(id)!.value = value;
  }
  let current = initial, confirmResult = true;
  const confirms: string[] = [], calls: { path: string; method: string; headers: any; body?: any }[] = [];
  let answer: (path: string, method: string, body: any) => Promise<any> = async (_path, method, body) => {
    if (method !== "POST") return { ok: true, data: current };
    const command = body?.command;
    if (command?.kind === "hint_pilot_prepare") current.state.tasks = state("prepared").tasks;
    if (command?.kind === "control") Object.assign(current.state.control, command);
    if (command?.kind === "hint_pilot_start") current.state.tasks[0].hintPilot!.status = "author";
    current.state.revision++;
    return { ok: true, data: { saved: true } };
  };
  const intervals: (() => unknown)[] = [];
  const sandbox = {
    document: { getElementById: (id: string) => {
      if (!elements.has(id)) throw Error("Unknown DOM id: " + id); return elements.get(id)!;
    }, createElement: (tag: string) => new Element(tag) },
    window: { confirm: (message: string) => { confirms.push(message); return confirmResult; } },
    Option: class extends Element { constructor(label: string, value: string) { super("option"); this.textContent = label; this.value = value; } },
    fetch: async (path: string, options: any = {}) => {
      const method = options.method ?? "GET", body = options.body ? JSON.parse(options.body) : undefined;
      calls.push({ path, method, headers: options.headers ?? {}, body });
      const result = await answer(path, method, body);
      return { ok: result.ok, status: result.status ?? 200, json: async () => structuredClone(result.data) };
    },
    setInterval: (callback: () => unknown) => { intervals.push(callback); return intervals.length; },
    clearInterval: () => {}, setTimeout: (callback: () => unknown) => { intervals.push(callback); return intervals.length; },
    clearTimeout: () => {}, console,
  };
  const script = crewControlPage.match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(script, sandbox, { timeout: 1500 });
  await flush();
  return {
    el: (id: string) => elements.get(id)!,
    async click(id: string, force = false) {
      const el = elements.get(id)!;
      if (el.disabled && !force) return;
      for (const callback of el.listeners.click ?? []) callback();
      await flush();
    },
    calls, confirms, intervals,
    setConfirm(v: boolean) { confirmResult = v; },
    setState(v: typeof initial) { current = v; },
    setAnswer(v: typeof answer) { answer = v; },
  };
}
describe("AI Crew owner pilot buttons — shipped script interactions", () => {
  it("renders the three requested actions and default $1; opening is read-only", async () => {
    const p = await page();
    expect(crewControlPage).toContain("Подготовить пилот: задержки");
    expect(crewControlPage).toContain("Включить с лимитом");
    expect(crewControlPage).toContain("Запустить пилот");
    expect(p.el("pilotLimitUsd").value).toBe("1");
    expect(p.calls.every(c => c.method === "GET")).toBe(true);
    expect(p.el("startHintPilot").disabled).toBe(true);
  });
  it.each(["prepareHintPilot", "enableHintPilot", "startHintPilot"])("%s cancels without POST when owner says no", async id => {
    const s = state("prepared"); s.control.enabled = true; s.control.dailyLimitMicroUsd = 1e6;
    const p = await page(payload(s)); p.setConfirm(false);
    await p.click(id, true);
    expect(p.calls.filter(c => c.method === "POST")).toEqual([]);
  });
  it("prepares latency using FRESH revision + CSRF, then rereads; confirmation is explicit", async () => {
    const p = await page();
    const fresh = payload(); fresh.state.revision = 28; fresh.csrf = "b".repeat(64);
    p.setState(fresh);
    await p.click("prepareHintPilot");
    const writes = p.calls.filter(c => c.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ path: "/api/admin/ai-crew/command", headers: { "x-crew-csrf": fresh.csrf },
      body: { revision: 28, command: { kind: "hint_pilot_prepare", candidate: "latency", ratesConfirmed: true } } });
    expect(p.confirms.some(t => t.includes("Вы уверены?"))).toBe(true);
    expect(p.calls.at(-1)?.method).toBe("GET");
    expect(p.calls.map(c => c.method)).toEqual(["GET", "GET", "POST", "GET"]);
  });
  it("follows prepare → enable $1 → start only via three owner clicks, polling never writes", async () => {
    const p = await page();
    await p.click("prepareHintPilot");
    expect(p.el("enableHintPilot").disabled).toBe(false);
    expect(p.el("startHintPilot").disabled).toBe(true);
    await p.click("enableHintPilot");
    expect(p.el("startHintPilot").disabled).toBe(false);
    await p.click("startHintPilot");
    expect(p.calls.filter(c => c.method === "POST").map(c => c.body.command)).toEqual([
      { kind: "hint_pilot_prepare", candidate: "latency", ratesConfirmed: true },
      { kind: "control", enabled: true, dailyLimitMicroUsd: 1000000, staleHours: 24 },
      { kind: "hint_pilot_start", taskId: state("prepared").tasks[0].id, ownerApproved: true },
    ]);
    expect(p.confirms.filter(t => t.includes("Вы уверены?"))).toHaveLength(3);
    for (const callback of [...p.intervals]) await callback();
    await flush();
    expect(p.calls.filter(c => c.method === "POST")).toHaveLength(3);
  });
  it("enables with exact dollar conversion and keeps freshly read staleHours", async () => {
    const p = await page(payload(state("prepared")));
    const fresh = payload(state("prepared")); fresh.state.revision = 30; fresh.state.control.staleHours = 48;
    p.setState(fresh); p.el("pilotLimitUsd").value = "1.234567";
    await p.click("enableHintPilot", true);
    expect(p.calls.find(c => c.method === "POST")?.body).toEqual({ revision: 30,
      command: { kind: "control", enabled: true, dailyLimitMicroUsd: 1234567, staleHours: 48 } });
    expect(p.confirms.some(t => t.includes("Вы уверены?"))).toBe(true);
    expect(p.calls.at(-1)?.method).toBe("GET");
  });
  it.each(["", "-1", "0", "1e2", "1.0000001", "Infinity", "100000.000001", "NaN"])(
    "rejects invalid USD limit %s before writing", async value => {
      const p = await page(payload(state("prepared"))); p.el("pilotLimitUsd").value = value;
      await p.click("enableHintPilot", true);
      expect(p.calls.filter(c => c.method === "POST")).toEqual([]);
    });
  it("starts only freshly prepared enabled pilot, never a stale task ID", async () => {
    const s = state("prepared"); s.control.enabled = true; s.control.dailyLimitMicroUsd = 1e6;
    const p = await page(payload(s));
    const fresh = payload(structuredClone(s)); fresh.state.revision = 31;
    fresh.state.tasks[0].id = "b2727272-aaaa-4bbb-8ccc-dddddddddddd";
    p.setState(fresh); await p.click("startHintPilot");
    expect(p.calls.find(c => c.method === "POST")?.body).toEqual({ revision: 31,
      command: { kind: "hint_pilot_start", taskId: fresh.state.tasks[0].id, ownerApproved: true } });
    expect(p.confirms.some(t => t.includes("Вы уверены?"))).toBe(true);
    expect(p.calls.at(-1)?.method).toBe("GET");
  });
  it.each(["off", "zero", "review", "owner", "missing", "dev", "not_initialized"])(
    "does not start on fresh %s state even if previously enabled", async mode => {
      const s = state("prepared"); s.control.enabled = true; s.control.dailyLimitMicroUsd = 1e6;
      const p = await page(payload(s)), fresh = payload(structuredClone(s));
      if (mode === "off") fresh.state.control.enabled = false;
      if (mode === "zero") fresh.state.control.dailyLimitMicroUsd = 0;
      if (mode === "review" || mode === "owner") fresh.state.tasks[0].hintPilot!.status = mode;
      if (mode === "missing") fresh.state.tasks = [];
      if (mode === "dev") fresh.environment = "development";
      if (mode === "not_initialized") fresh.initialized = false;
      p.setState(fresh); await p.click("startHintPilot");
      expect(p.calls.filter(c => c.method === "POST")).toEqual([]);
    });
  it("never repeats ambiguous POST; rereads, leaves STOP and requires manual refresh", async () => {
    const p = await page();
    p.setAnswer(async (_path, method) => method === "POST" ? Promise.reject(Error("timeout")) : { ok: true, data: payload() });
    await p.click("prepareHintPilot");
    expect(p.calls.filter(c => c.method === "POST")).toHaveLength(1);
    expect(p.calls.at(-1)?.method).toBe("GET");
    expect(p.el("message").textContent).toMatch(/СТОП|STOP|не подтвержд|Не подтвержд/);
    await p.click("prepareHintPilot", true);
    expect(p.calls.filter(c => c.method === "POST")).toHaveLength(1);
    await p.click("refresh");
    expect(p.el("prepareHintPilot").disabled).toBe(false);
  });
  it("does not write when fresh GET fails", async () => {
    const p = await page();
    p.setAnswer(async () => ({ ok: false, status: 503, data: { error: "unavailable" } }));
    await p.click("prepareHintPilot");
    expect(p.calls.filter(c => c.method === "POST")).toEqual([]);
  });
  it("blocks on successful HTTP with unclear receipt or mismatched reread, without retry", async () => {
    const p = await page();
    p.setAnswer(async (_path, method) => ({ ok: true, data: method === "POST" ? { saved: true } : payload() }));
    await p.click("prepareHintPilot");
    expect(p.calls.filter(c => c.method === "POST")).toHaveLength(1);
    expect(p.el("message").textContent).toMatch(/не удалось|не увеличилась|не совпало/i);
    await p.click("prepareHintPilot", true);
    expect(p.calls.filter(c => c.method === "POST")).toHaveLength(1);
    const q = await page();
    q.setAnswer(async (_path, method) => ({ ok: true, data: method === "POST" ? {} : payload() }));
    await q.click("prepareHintPilot");
    expect(q.el("message").textContent).toMatch(/СТОП/);
    expect(q.calls.filter(c => c.method === "POST")).toHaveLength(1);
  });
  it("locks double clicks, but emergency OFF remains usable during fresh-read wait", async () => {
    const p = await page(); let release!: (v: any) => void, blocked = true;
    p.setAnswer(async (_path, method) => {
      if (method === "GET" && blocked) {
        blocked = false; return new Promise(resolve => { release = resolve; });
      }
      return { ok: true, data: payload() };
    });
    await p.click("prepareHintPilot"); await p.click("prepareHintPilot", true);
    expect(p.confirms).toHaveLength(1);
    await p.click("disable");
    expect(p.calls.filter(c => c.path.endsWith("/disable") && c.method === "POST")).toHaveLength(1);
    release({ ok: true, data: payload() }); await flush();
    expect(p.calls.filter(c => c.body?.command?.kind === "hint_pilot_prepare")).toHaveLength(0);
  });
  it("shows Pasha, Foma verdict, both token usages and known price; polls only GET", async () => {
    const s = state("owner"), t = s.tasks[0];
    t.hintPilot!.proposalId = "p"; t.hintPilot!.reviewId = "f"; t.hintPilot!.verdict = "confirmed";
    s.control.enabled = false; s.control.dailyLimitMicroUsd = 1e6;
    s.documents.push({ id: "p", taskId: t.id, runId: "p-run", agentId: "product-manager-specialist", at: "now",
      text: "Pasha latency evidence <script>never execute</script>", status: "proposed" },
    { id: "f", taskId: t.id, runId: "f-run", agentId: "Hint-lg-qa-role", at: "now", text: "Foma review", status: "proposed" });
    s.runs.push({ id: "p-run", taskId: t.id, agentId: "product-manager-specialist", eventId: "p", status: "done", at: "now",
      cost: 26000, usage: { input_tokens: 3000, output_tokens: 2000 } },
    { id: "f-run", taskId: t.id, agentId: "Hint-lg-qa-role", eventId: "f", status: "done", at: "now",
      cost: 60000, usage: { input_tokens: 5000, output_tokens: 2000 } });
    const p = await page(payload(s));
    const view = p.el("pilotResults").textContent;
    expect(view).toContain("Pasha latency evidence"); expect(view).toContain("Foma review");
    expect(view).toMatch(/подтверждено/i); expect(view).toMatch(/0[,.]086/);
    for (const n of ["3000", "5000", "2000"]) expect(view.replace(/\s/g, "")).toContain(n);
    expect(view).toMatch(/OFF|выключ/i);
    for (const callback of [...p.intervals]) await callback();
    await flush(); expect(p.calls.every(c => c.method === "GET")).toBe(true);
  });
  it("does not present an unknown cost as zero", async () => {
    const s = state("author");
    s.runs.push({ id: "x", taskId: s.tasks[0].id, agentId: "product-manager-specialist", status: "unknown", at: "now",
      eventId: "event", reserved: 50000 });
    const p = await page(payload(s));
    expect(p.el("pilotResults").textContent).toMatch(/неизвест|не подтвержд/i);
    expect(p.el("pilotResults").textContent).toMatch(/резерв/i);
  });
});
