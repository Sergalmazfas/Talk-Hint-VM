// Copilot-chain judge: per-dimension {score, explanation} parsing + fail-safe.
import { describe, it, expect } from "vitest";
import { judgeTurn, JUDGE_DIMENSIONS } from "../benchmark/judge";
import type { BrainEnvelopeInput, BrainEnvelopeOutput } from "../benchmark/types";

const ENV: BrainEnvelopeInput = {
  originalGoal: "Transfer number to eSIM",
  confirmedFacts: [],
  conversationSoFar: [],
  currentGuestTurn: { idx: 2, role: "guest", text: "Can I have your account number?" },
  lastOwnerTurn: { idx: 1, role: "owner", text: "I want to transfer my number." },
  previousHintsShown: ["Say: I want to move my number to the eSIM."],
  previousHintsRejected: [],
  currentCallState: "Confirmed: (none). So far: account number was requested or discussed.",
};
const OUT: BrainEnvelopeOutput = { should_suggest: true, suggested_reply: "Sure, it's on my Mint app — one second." };
const FIXTURE = { goal: ENV.originalGoal, referenceTurns: [], confirmedFacts: [], criticalEntities: { money: [], dates: [], digits: [], names: [], decisions: [] } as any };

function fakeFetch(body: any): any {
  return async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }),
    json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }),
  });
}

function chainBody(score: number) {
  const o: any = { rationale: "ok" };
  for (const d of JUDGE_DIMENSIONS) o[d] = { score, explanation: `because ${d}` };
  return o;
}

describe("copilot-chain judge parsing", () => {
  it("parses per-dimension scores AND explanations", async () => {
    const js = await judgeTurn("gpt-5.6-sol", "gpt-5.6-luna", ENV, OUT, FIXTURE as any, { fetchImpl: fakeFetch(chainBody(8)) as any });
    expect(js).not.toBeNull();
    for (const d of JUDGE_DIMENSIONS) {
      expect((js!.scores as any)[d]).toBe(8);
      expect((js!.explanations as any)[d]).toBe(`because ${d}`);
    }
    expect(js!.selfJudged).toBe(false);
  });

  it("marks selfJudged when judge model == candidate model, clamps out-of-range scores", async () => {
    const body = chainBody(15); // out of range → clamp to 10
    const js = await judgeTurn("gpt-5.6-sol", "gpt-5.6-sol", ENV, OUT, FIXTURE as any, { fetchImpl: fakeFetch(body) as any });
    expect(js!.selfJudged).toBe(true);
    expect(js!.scores.overall_live_copilot_quality).toBe(10);
  });

  it("legacy bare-int dims still parse (scores kept, explanations empty)", async () => {
    const o: any = { rationale: "legacy" };
    for (const d of JUDGE_DIMENSIONS) o[d] = 7;
    const js = await judgeTurn("gpt-5.6-sol", "x", ENV, OUT, FIXTURE as any, { fetchImpl: fakeFetch(o) as any });
    expect(js!.scores.goal_memory).toBe(7);
    expect(js!.explanations.goal_memory).toBe("");
  });

  it("judge API failure returns null (never throws into the harness)", async () => {
    const failing: any = async () => ({ ok: false, status: 500, text: async () => "boom", json: async () => ({}) });
    const js = await judgeTurn("gpt-5.6-sol", "x", ENV, OUT, FIXTURE as any, { fetchImpl: failing });
    expect(js).toBeNull();
  });
});

describe("generic call-state events (non-payment fixtures)", () => {
  it("telecom transcript produces number-transfer events, deterministic", async () => {
    const { buildCallState } = await import("../benchmark/brainEnvelope");
    const turns = [
      { idx: 0, role: "owner" as const, text: "I want to transfer my existing number to the SIM on my new iPhone and activate service." },
      { idx: 1, role: "guest" as const, text: "Sure. Can I have your account number and transfer PIN from your current carrier?" },
    ];
    const s1 = buildCallState(FIXTURE as any, turns as any, 1);
    expect(s1).toContain("transferring/porting a phone number");
    expect(s1).toContain("account number");
    expect(s1).toContain("transfer PIN");
    expect(buildCallState(FIXTURE as any, turns as any, 1)).toBe(s1);
  });
});

describe("fail-closed judge validation (no fabricated scores)", () => {
  it("returns null when a dimension is missing", async () => {
    const o = chainBody(8);
    delete (o as any).tried_memory;
    const js = await judgeTurn("gpt-5.6-sol", "x", ENV, OUT, FIXTURE as any, { fetchImpl: fakeFetch(o) as any });
    expect(js).toBeNull();
  });

  it("returns null when a dimension object is malformed (score not a number / explanation missing)", async () => {
    const o1 = chainBody(8);
    (o1 as any).goal_memory = { score: "high", explanation: "x" };
    expect(await judgeTurn("gpt-5.6-sol", "x", ENV, OUT, FIXTURE as any, { fetchImpl: fakeFetch(o1) as any })).toBeNull();
    const o2 = chainBody(8);
    (o2 as any).goal_memory = { score: 8 }; // no explanation
    expect(await judgeTurn("gpt-5.6-sol", "x", ENV, OUT, FIXTURE as any, { fetchImpl: fakeFetch(o2) as any })).toBeNull();
  });
});

describe("judge receives candidate-specific causal history", () => {
  it("later-turn judge request contains the candidate's own previousHintsShown", async () => {
    const { runBrainBenchmark } = await import("../benchmark/brainHarness");
    const gc = await import("../benchmark/goldCall");
    const goldFixture = {
      goal: gc.GOLD_CALL_GOAL,
      confirmedFacts: gc.GOLD_CALL_CONFIRMED_FACTS,
      criticalEntities: gc.GOLD_CALL_CRITICAL_ENTITIES,
      referenceTurns: gc.GOLD_CALL_TURNS,
    };
    const encoder = new TextEncoder();
    const sse = (obj: any) => {
      const json = JSON.stringify(obj);
      const body = `data: ${JSON.stringify({ choices: [{ delta: { content: json } }] })}\ndata: [DONE]\n`;
      return {
        ok: true, status: 200,
        body: new ReadableStream({ start(c) { c.enqueue(encoder.encode(body)); c.close(); } }),
        text: async () => body, json: async () => ({}),
      };
    };
    const judgeUsers: string[] = [];
    let hintN = 0;
    const fetchImpl = async (_url: string, init: any) => {
      const req = JSON.parse(init.body);
      const isJudge = req.response_format?.json_schema?.name === "judge_scores";
      if (isJudge) {
        judgeUsers.push(req.messages.find((m: any) => m.role === "user")?.content ?? "");
        return {
          ok: true, status: 200,
          text: async () => "",
          json: async () => ({ choices: [{ message: { content: JSON.stringify(chainBody(7)) } }] }),
        };
      }
      hintN++;
      return sse({ should_suggest: true, suggested_reply: `Unique hint number ${hintN}.`, strategy: "answer" });
    };
    const clock = { t: 0 };
    const res = await runBrainBenchmark({
      fixture: goldFixture as any,
      candidates: [{ id: "mock-cand", label: "Mock", model: "gpt-5.6-sol", reasoningEffort: "none" } as any],
      availability: [{ candidateId: "mock-cand", status: "AVAILABLE", checkedAt: "2026-01-01T00:00:00Z", detail: "ok" } as any],
      judgeEnabled: true,
      fetchImpl: fetchImpl as any,
      nowMs: () => (clock.t += 10),
    } as any);
    expect(judgeUsers.length).toBeGreaterThan(1);
    // First judged turn: no history yet.
    expect(judgeUsers[0]).toContain("PREVIOUS HINTS SHOWN: (none)");
    // A later judged turn MUST carry the candidate's own earlier hint.
    const last = judgeUsers[judgeUsers.length - 1];
    expect(last).toContain("Unique hint number 1.");
    expect(last).not.toContain("PREVIOUS HINTS SHOWN: (none)");
    expect(res.turnResults.filter((t: any) => t.judge).length).toBeGreaterThan(1);
  });
});
