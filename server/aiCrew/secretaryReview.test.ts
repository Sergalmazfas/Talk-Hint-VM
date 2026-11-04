import { describe, it, expect } from "vitest";
import { initialState, applyOwnerCommand } from "./domain";
import {
  SECRETARY_AGENTS, configureSecretary, secretaryEvidence, secretaryHash, secretaryCharacters,
  queueSecretaryReview, secretaryInput, finishSecretaryRun, secretaryReviewComplete, secretaryReserve, secretarySettle,
} from "./secretaryReview";
import { reviewSecretaryCall } from "./secretaryAutomation";
import { CrewRuntime } from "./runtime";

const at = "2026-11-03T04:00:00.000Z";
const models = SECRETARY_AGENTS.map(a => a.modelId);
const evidence = () => secretaryEvidence("ask price", [{ role: "guest", text: "the price is $150" }], "abc123");
const characters = Object.fromEntries(SECRETARY_AGENTS.map(a =>
  [a.agentId, { traits: ["один", "два", "три"], motto: "Проверить" }]));
function ready() {
  const s = initialState(); s.control.enabled = true; s.control.dailyLimitMicroUsd = 1e6;
  configureSecretary(s, true, 20e6, "owner", at, models);
  return s;
}
const author = JSON.stringify({ points: [{ index: 0, status: "выполнено", quote: "$150", turn: 0, reason: "цена названа" }] });
const reviewer = JSON.stringify({ verdict: "confirmed", checks: [{ index: 0, quote: "$150", turn: 0, reason: "сверено" }], disagreements: [] });
describe("Secretary analysis: disabled by default, existing owner scope", () => {
  it("first five C calls are selected once, keep OFF gates, then queue measured evidence for Leva/Toma", async () => {
    const s = ready();
    const company = { documents: Object.entries(characters).map(([roleId, character]) => ({
      text: JSON.stringify({ visualPassport: { roleId, character } }),
    })) };
    const deps: any = { environment: "production", model: async () => company,
      store: () => ({ read: async () => structuredClone(s), change: async (fn: any) => { const result=fn(s);s.revision++;return result; } }) };
    const call: any = { user_id: "owner", call_sid: "call-private-id", ended_at: at, lab_mode: "secretary",
      metadata: { retellPhone: { variant: "C" }, secretaryEngine: {
        runtime: { variant: "C", promptMode: "compact" },
        interruption: { restarts: 2, a: 1, b: 1, c: 1, bridges: 1, events: [] },
      } } };
    const task: any = { user_id: "owner", call_sid: call.call_sid, instruction: "ask price",
      transcript_turns: [{ role: "guest", text: "the price is $150" }] };
    s.control.enabled=false;
    const off=await reviewSecretaryCall(call,task,"owner","production",new Date(at),deps);
    expect(off&&!off.pending&&off.failed).toContain("CREW_OFF_OR_HINT_PILOT_ACTIVE");
    expect(s.tasks).toHaveLength(0); expect(s.secretaryPhoneRollout!.reviews).toHaveLength(1);
    s.control.enabled=true;
    expect(await reviewSecretaryCall(call,task,"owner","production",new Date(at),deps)).toEqual({pending:true});
    const p=s.tasks[0].secretaryReview!;
    expect(p.evidence.cRollout).toMatchObject({ordinal:1,measurements:{restarts:2,bridges:1}});
    expect(p.evidence.cRollout!.measurements.endToSoundMedianMs).toBeNull();
    expect(secretaryInput(s,s.tasks[0],SECRETARY_AGENTS[0].agentId,models[0])).toContain("Тома проверяет это независимо");
    expect(s.secretaryPhoneRollout!.reviews).toHaveLength(1);
    await reviewSecretaryCall(call,task,"owner","production",new Date(at),deps);
    expect(s.tasks).toHaveLength(1);
    p.status="reported";p.verdict="not_confirmed";
    await reviewSecretaryCall(call,task,"owner","production",new Date(at),deps);
    await reviewSecretaryCall(call,task,"owner","production",new Date(at),deps);
    const logs=s.journal.filter(e=>e.kind==="katya_c_first_five_review_reported");
    expect(logs).toHaveLength(1);
    expect(logs[0].detail).toMatchObject({ordinal:1,verdict:"not_confirmed",ownerAcceptance:false});
  });
  it("does not claim a C review for another owner, Dev or a legacy call", async () => {
    const s=ready();
    const deps:any={environment:"production",store:()=>({read:async()=>s,change:async(fn:any)=>fn(s)}),
      model:async()=>({documents:[]})};
    for(const [owner,environment,variant] of [["stranger","production","C"],["owner","development","C"],["owner","production","legacy"]]) {
      const call:any={user_id:owner,call_sid:"test",ended_at:at,lab_mode:"secretary",metadata:{retellPhone:{variant}}};
      await reviewSecretaryCall(call,{user_id:owner,call_sid:"test",instruction:"ask price"},"owner",environment,new Date(at),deps);
    }
    expect(s.secretaryPhoneRollout).toBeUndefined();
  });
  it("does not enable or initialize anything by reading an unconfigured state", async () => {
    const s = initialState(); let writes = 0;
    const deps: any = { environment: "production", store: () => ({ read: async () => s, change: async () => writes++ }) };
    expect(await reviewSecretaryCall({}, {}, "owner", "production", new Date(at), deps)).toBeNull();
    expect(writes).toBe(0); expect(s.control.enabled).toBe(false); expect(s.agents).toEqual([]);
  });
  it("will not run in Dev and does not even read the production store", async () => {
    let reads = 0;
    expect(await reviewSecretaryCall({}, {}, "owner", "development", new Date(at),
      { environment: "production", store: () => { reads++; throw Error(); }, model: async () => null as any })).toBeNull();
    expect(reads).toBe(0);
  });
  it("requires verified model ids and the same bound owner", () => {
    const s = initialState();
    expect(() => configureSecretary(s, true, 20e6, "owner", at, [])).toThrow("MODELS_UNVERIFIED");
    configureSecretary(s, false, 20e6, "owner", at, []);
    expect(() => configureSecretary(s, true, 20e6, "stranger", at, models)).toThrow("OWNER_MISMATCH");
  });
  it("rejects a different user's call before extracting a transcript", async () => {
    const s = ready(), deps: any = { environment: "production", store: () => ({ read: async () => s }) };
    const result = await reviewSecretaryCall({ user_id: "stranger" }, {}, "owner", "production", new Date(at), deps);
    expect(result && !result.pending && result.failed[0]).toBe("SECRETARY_SOURCE_SCOPE_REJECTED");
  });
  it("rejects missing, malformed and oversized sources rather than truncating them silently", () => {
    expect(() => secretaryEvidence("", [], "x")).toThrow();
    expect(() => secretaryEvidence("goal", [{ text: "" }], "x")).toThrow();
    expect(() => secretaryEvidence("goal", Array(151).fill({ text: "a" }), "x")).toThrow();
    expect(() => secretaryEvidence("my medical record", [{ text: "private" }], "x")).toThrow("PRIVATE_SOURCE");
  });
  it("redacts private people/phones/home addresses, preserving public companies and brands", () => {
    const e = secretaryEvidence("ask Michelin price", [
      { role: "guest", text: "John: email mike@example.com, +1 (760) 237-8845, my home address is 123 Main Street. Goodyear is $150" },
      { role: "guest", text: "Иван сказал: Michelin is $160" }], "abc123", ["Иван"]);
    const text = JSON.stringify(e);
    for (const p of ["John", "Иван", "mike@example.com", "760", "123 Main"])
      expect(text).not.toContain(p);
    expect(text).toContain("$150"); expect(e.points[0]).toContain("Michelin");
    expect(text).toContain("Goodyear");
  });
  it("keeps critical business qualifiers and confirmations rather than redacting NEW or Yes as names", () => {
    const e = secretaryEvidence("Ask about a NEW tire", [{ role: "guest", text: "Yes, NEW tires are available Tomorrow" }], "abc123");
    expect(e.points[0]).toContain("NEW"); expect(e.transcript[0].text).toContain("Yes");
    expect(e.transcript[0].text).toContain("NEW"); expect(e.transcript[0].text).toContain("Tomorrow");
  });
  it("loads approved owner-layer characters only, never an invented default", () => {
    expect(() => secretaryCharacters({ documents: [] } as any)).toThrow("CHARACTER_UNAVAILABLE");
    const docs = SECRETARY_AGENTS.map(a => ({ text: JSON.stringify({ visualPassport: { roleId: a.agentId,
      character: characters[a.agentId] } }) }));
    expect(secretaryCharacters({ documents: docs } as any)).toEqual(characters);
  });
});
describe("Secretary chain, evidence and budget", () => {
  function harness() {
    let state = ready();
    const store: any = { read: async () => structuredClone(state), change: async (fn: any) => {
      const next = structuredClone(state), result = await fn(next); next.revision++; state = next; return result;
    } };
    queueSecretaryReview(state, "owner", "call", evidence(), characters, at);
    return { store, state: () => state };
  }
  it("the actual dispatcher executes all three models, uses 4000 for Toma and settles both wallets", async () => {
    const h = harness(), calls: any[] = [], outputs = [author, reviewer,
      '{"outcome":"price","agreed":["$150"],"remaining":[],"unverified":[]}'];
    const provider: any = { message: async (model: string, input: string, max: number) => {
      const i = calls.length; calls.push({ model, input, max });
      return { model, text: outputs[i], usage: { input_tokens: 10, output_tokens: 10 },
        http: { httpStatus: 200, requestId: `req_${i}` } };
    } };
    const runtime = new CrewRuntime(h.store, provider, "production", () => new Date(at));
    await runtime.tick(); await runtime.tick(); await runtime.tick();
    expect(calls.map(c => c.max)).toEqual([6000, 4000, 2000]);
    expect(calls.map(c => c.model)).toEqual(models);
    const s = h.state(); expect(s.runs.every(r => r.status === "done")).toBe(true);
    expect(s.secretaryBudget!["2026-11"]).toEqual({ spent: 480, reserved: 0, warning: false });
    expect(s.budget["2026-11-03"].spent).toBe(480);
    expect(s.tasks[0].secretaryReview!.status).toBe("reported");
    expect(s.control.enabled).toBe(true); // Continuous owner-approved department, not a one-off Hint pilot.
  });
  it("the dispatcher does not call a model without a monthly reserve and does not leave a spinning queue", async () => {
    const h = harness(); await h.store.change((s: any) => { s.secretarySettings.monthlyLimitMicroUsd = 1; });
    let called = 0;
    await new CrewRuntime(h.store, { message: async () => { called++; throw Error(); } } as any, "production", () => new Date(at)).tick();
    expect(called).toBe(0); expect(h.state().runs[0].status).toBe("discarded");
    expect(h.state().tasks[0].secretaryReview!.error).toBe("DEPARTMENT_MONTHLY_BUDGET");
  });
  it("a provider failure remains unknown with both reserves held; no second request", async () => {
    const h = harness(); let calls = 0;
    const r = new CrewRuntime(h.store, { message: async () => { calls++; throw Error("network"); } } as any,
      "production", () => new Date(at));
    await r.tick(); await r.tick();
    expect(calls).toBe(1); expect(h.state().runs[0].status).toBe("unknown");
    expect(h.state().secretaryBudget!["2026-11"].reserved).toBeGreaterThan(0);
    expect(h.state().budget["2026-11-03"].reserved).toBe(h.state().secretaryBudget!["2026-11"].reserved);
  });
  it("the dispatcher blocks changed evidence once, with no model call or endless queued retry", async () => {
    const h = harness(); await h.store.change((s: any) => s.tasks[0].secretaryReview.evidence.points.push("changed"));
    let calls = 0;
    const r = new CrewRuntime(h.store, { message: async () => { calls++; throw Error(); } } as any,
      "production", () => new Date(at));
    await r.tick(); await r.tick();
    expect(calls).toBe(0); expect(h.state().runs[0].status).toBe("discarded");
    expect(h.state().tasks[0].secretaryReview!.error).toBe("SECRETARY_PRECHECK_FAILED");
  });
  it("queues one attempt per owner/call, including blocked/unknown attempts", () => {
    const s = ready(), t = queueSecretaryReview(s, "owner", "CAprivate", evidence(), characters, at);
    expect(queueSecretaryReview(s, "owner", "CAprivate", evidence(), characters, at)).toBe(t);
    t.secretaryReview!.status = "blocked";
    expect(queueSecretaryReview(s, "owner", "CAprivate", evidence(), characters, at)).toBe(t);
    expect(s.runs).toHaveLength(1); expect(JSON.stringify(t)).not.toContain("CAprivate");
  });
  it("does not allow disabled/global OFF or an active Hint test series to queue", () => {
    const s = ready(); s.control.enabled = false;
    expect(() => queueSecretaryReview(s, "owner", "call", evidence(), characters, at)).toThrow("DISABLED");
    s.control.enabled = true; s.control.testSeriesId = "pilot";
    expect(() => queueSecretaryReview(s, "owner", "call", evidence(), characters, at)).toThrow("DISABLED");
  });
  it("freezes evidence canonically across jsonb key reordering and rejects real changes", () => {
    expect(secretaryHash({ b: 1, a: 2 })).toBe(secretaryHash({ a: 2, b: 1 }));
    const s = ready(), t = queueSecretaryReview(s, "owner", "call", evidence(), characters, at);
    expect(secretaryInput(s, t, SECRETARY_AGENTS[0].agentId, models[0])).toContain("ownerCharacter");
    t.secretaryReview!.evidence.points.push("changed");
    expect(() => secretaryInput(s, t, SECRETARY_AGENTS[0].agentId, models[0])).toThrow("EVIDENCE_CHANGED");
  });
  it("runs Leva → different-model Toma → Seva → Maria, without owner acceptance", () => {
    const s = ready(), t = queueSecretaryReview(s, "owner", "call", evidence(), characters, at);
    expect(SECRETARY_AGENTS[0].modelId).not.toBe(SECRETARY_AGENTS[1].modelId);
    for (const [i, text] of [author, reviewer, '{"outcome":"цена названа","agreed":["$150"],"remaining":[],"unverified":[]}'].entries()) {
      const run = s.runs[i]; run.status = "done"; run.modelId = models[i];
      const d = { id: `doc${i}`, taskId: t.id, runId: run.id, agentId: run.agentId, at, text, status: "proposed" as const };
      s.documents.push(d); finishSecretaryRun(s, t, d.id, text, at);
    }
    expect(t.secretaryReview!.status).toBe("reported"); expect(t.secretaryReview!.verdict).toBe("confirmed");
    expect(secretaryReviewComplete(s, t)).toBe(true); expect(t.steps.at(-1)!.holder).toBe("head-product");
    expect(t.phase).toBe("analysis"); expect(t.closed).toBe(false);
    expect(s.documents.every(d => d.status === "proposed")).toBe(true);
  });
  it.each([null, {}, { points: [null] }, { points: [{ index: 0, status: "выполнено", quote: "not in source", turn: 0, reason: "x" }] }])(
    "never certifies malformed author output %j", value => {
      const s = ready(), t = queueSecretaryReview(s, "owner", "call", evidence(), characters, at);
      finishSecretaryRun(s, t, "author", JSON.stringify(value), at);
      finishSecretaryRun(s, t, "review", reviewer, at);
      expect(t.secretaryReview!.verdict).toBe("not_confirmed");
    });
  it("will not confirm a formal review with no source quotes or with disagreements", () => {
    for (const review of [
      { verdict: "confirmed", checks: [{ index: 0, status: "не проверено", reason: "trust" }], disagreements: [] },
      { ...JSON.parse(reviewer), disagreements: ["wrong"] },
    ]) {
      const s = ready(), t = queueSecretaryReview(s, "owner", "call", evidence(), characters, at);
      finishSecretaryRun(s, t, "a", author, at); finishSecretaryRun(s, t, "r", JSON.stringify(review), at);
      expect(t.secretaryReview!.verdict).toBe("not_confirmed");
    }
  });
  it("rejects an unknown paid attempt, changed model/rates and self-review", () => {
    const s = ready(), t = queueSecretaryReview(s, "owner", "call", evidence(), characters, at);
    s.runs[0].status = "unknown";
    expect(() => secretaryInput(s, t, SECRETARY_AGENTS[0].agentId, models[0])).toThrow();
    expect(() => applyOwnerCommand(s, { kind: "advance", taskId: t.id, phase: "owner_decision",
      holder: "owner", note: "approve", laboratoryActor: "same", reviewerActor: "same" } as any, "owner", at, models)).toThrow();
  });
  it("keeps the monthly wallet and unknown reserves across process/day changes, separately from daily budget", () => {
    let s = ready(); expect(secretaryReserve(s, 15e6, "2026-11")).toBe(true);
    s = JSON.parse(JSON.stringify(s)); s.budget = {};
    expect(secretaryReserve(s, 6e6, "2026-11")).toBe(false);
    expect(s.secretaryBudget!["2026-11"].reserved).toBe(15e6);
    secretarySettle(s, "2026-11", 15e6, 16e6);
    expect(s.secretaryBudget!["2026-11"].warning).toBe(true);
    expect(secretaryReserve(s, 5e6, "2026-11")).toBe(false);
    expect(secretaryReserve(s, 1e6, "2026-12")).toBe(true);
  });
  it("a disable cancels queued work but never refunds unknown reserves or requeues old calls", () => {
    const s = ready(), t = queueSecretaryReview(s, "owner", "call", evidence(), characters, at);
    secretaryReserve(s, 123, "2026-11");
    configureSecretary(s, false, 20e6, "owner", at, []);
    expect(s.runs[0].status).toBe("discarded"); expect(t.secretaryReview!.status).toBe("blocked");
    expect(s.secretaryBudget!["2026-11"].reserved).toBe(123);
    expect(s.control.dailyLimitMicroUsd).toBe(1e6); // Department switch does not change global money.
  });
});
