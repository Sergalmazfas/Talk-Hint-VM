import { describe, it, expect } from "vitest";
import vm from "node:vm";
import { crewControlPage } from "./controlPage";
import { initialState } from "./domain";

function fixture(options: { confirmed?: boolean; wrongReadback?: boolean; ambiguous?: boolean; emergency?: boolean } = {}) {
  const source = crewControlPage.slice(crewControlPage.indexOf("var secretaryBusy=false;"),
    crewControlPage.indexOf('$("modelSelect").addEventListener'));
  const calls: any[] = [], messages: string[] = [], elements: Record<string, any> = {};
  for (const [id, value] of Object.entries({ secretaryMonthly: "20", secretaryDaily: "1",
    secretaryEnable: "", secretaryDisable: "", phoneC: "", phoneReserve: "", phoneLegacy: "" }))
    elements[id] = { value, addEventListener: (_: string, listener: any) => { elements[id].listener = listener; } };
  const before = initialState(), after = structuredClone(before);
  after.revision = before.revision + 1; after.control.enabled = true; after.control.dailyLimitMicroUsd = 1e6;
  after.secretarySettings = { enabled: !options.wrongReadback, ownerId: "owner", activatedAt: "2026-11-03T00:00:00Z", monthlyLimitMicroUsd: 20e6 };
  const context: any = {
    $: (id: string) => elements[id], pilotBusy: false, pilotBlocked: false, pilotIntent: 0,
    window: { confirm: () => options.confirmed !== false },
    render: () => {}, setMessage: (s: string) => messages.push(s),
    pilotStateValid: (x: any) => x.initialized && x.environment === "production",
    request: async (path: string, init: any) => {
      calls.push({ path, ...init });
      if (init.method === "POST") return { saved: !options.ambiguous };
      if (options.emergency) context.pilotIntent++;
      return { initialized: true, environment: "production", state: calls.length === 1 ? before : after };
    },
  };
  vm.runInNewContext(source, context);
  return { context, calls, messages, elements, after };
}
describe("Secretary owner controls", () => {
  it("binds both buttons and requires confirmation before even reading", async () => {
    const f = fixture({ confirmed: false });
    expect(typeof f.elements.secretaryEnable.listener).toBe("function");
    expect(typeof f.elements.secretaryDisable.listener).toBe("function");
    await f.context.secretaryControl(true); expect(f.calls).toHaveLength(0);
  });
  it("fresh read → one revision-protected command in dollars → readback", async () => {
    const f = fixture(); await f.context.secretaryControl(true);
    expect(f.calls.map(c => c.method)).toEqual(["GET", "POST", "GET"]);
    const body = JSON.parse(f.calls[1].body);
    expect(body).toEqual({ revision: 0, command: { kind: "secretary_review_config",
      enabled: true, monthlyLimitMicroUsd: 20e6, dailyLimitMicroUsd: 1e6 } });
    expect(f.context.pilotBlocked).toBe(false);
  });
  it.each([{ ambiguous: true }, { wrongReadback: true }])("blocks after ambiguous/mismatching response without retry %j", async options => {
    const f = fixture(options); await f.context.secretaryControl(true); await f.context.secretaryControl(true);
    expect(f.calls.filter(c => c.method === "POST")).toHaveLength(1);
    expect(f.context.pilotBlocked).toBe(true); expect(f.messages.at(-1)).toContain("СТОП");
  });
  it("a racing emergency OFF cancels the pending enable before POST", async () => {
    const f = fixture({ emergency: true }); await f.context.secretaryControl(true);
    expect(f.calls.filter(c => c.method === "POST")).toHaveLength(0);
  });
  it("does not accept malformed dollar input or send a microUSD-looking raw number", async () => {
    const f = fixture(); f.elements.secretaryMonthly.value = "0.0000001";
    await f.context.secretaryControl(true);
    expect(f.calls.filter(c => c.method === "POST")).toHaveLength(0);
    expect(f.messages.at(-1)).toContain("долларах");
  });
});
