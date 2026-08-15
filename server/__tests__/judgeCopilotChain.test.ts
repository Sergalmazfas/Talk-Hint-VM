// Copilot-chain judge: per-dimension {score, explanation} parsing + fail-safe.
import { describe, it, expect } from "vitest";
import {
  judgeTurn,
  judgeTurnAggregated,
  pickSecondJudgeModel,
  JUDGE_DIMENSIONS,
  JUDGE_SAMPLES,
} from "../benchmark/judge";
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

describe("multi-sample judge aggregation (stable scores)", () => {
  it("defaults to N>=3 samples", () => {
    expect(JUDGE_SAMPLES).toBeGreaterThanOrEqual(3);
  });

  it("aggregates per-dimension MEDIAN over samples and reports std", async () => {
    // Samples return scores 4, 8, 9 → median 8, std > 0.
    const seq = [4, 8, 9];
    let i = 0;
    const fetchImpl: any = async () => {
      const body = chainBody(seq[i++ % seq.length]);
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }),
        json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }),
      };
    };
    const js = await judgeTurnAggregated("gpt-5.6-sol", "x", ENV, OUT, FIXTURE as any, { fetchImpl });
    expect(js).not.toBeNull();
    expect(js!.samples).toBe(3);
    expect(js!.scores.overall_live_copilot_quality).toBe(8);
    expect(js!.scoreStds!.overall_live_copilot_quality).toBeGreaterThan(0);
  });

  it("uses partial samples honestly and returns null only when ALL samples fail", async () => {
    let call = 0;
    const flaky: any = async () => {
      call++;
      if (call !== 2) return { ok: false, status: 500, text: async () => "boom", json: async () => ({}) };
      const body = chainBody(6);
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }),
        json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }),
      };
    };
    const js = await judgeTurnAggregated("gpt-5.6-sol", "x", ENV, OUT, FIXTURE as any, { fetchImpl: flaky });
    expect(js!.samples).toBe(1);
    expect(js!.scores.overall_live_copilot_quality).toBe(6);

    const allFail: any = async () => ({ ok: false, status: 500, text: async () => "boom", json: async () => ({}) });
    expect(await judgeTurnAggregated("gpt-5.6-sol", "x", ENV, OUT, FIXTURE as any, { fetchImpl: allFail })).toBeNull();
  });
});

describe("pickSecondJudgeModel (cross-check for self-judged)", () => {
  const av = (id: string): any => ({ candidateId: id, status: "AVAILABLE", checkedAt: "x", detail: "ok" });
  it("returns the first available preference distinct from the primary judge", () => {
    const cands: any = [
      { id: "a", model: "gpt-5.6-sol" },
      { id: "b", model: "gpt-5.2" },
    ];
    expect(pickSecondJudgeModel(cands, [av("a"), av("b")], "gpt-5.6-sol")).toBe("gpt-5.2");
  });
  it("fail-closed: returns null when only the primary judge model is available", () => {
    const cands: any = [{ id: "a", model: "gpt-5.6-sol" }];
    expect(pickSecondJudgeModel(cands, [av("a")], "gpt-5.6-sol")).toBeNull();
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

describe("self-judged cross-check by a second judge (harness)", () => {
  async function runHarness(secondJudgeFails: boolean, includeSecondCandidate: boolean) {
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
    const judgeModelsUsed: string[] = [];
    const fetchImpl = async (_url: string, init: any) => {
      const req = JSON.parse(init.body);
      const isJudge = req.response_format?.json_schema?.name === "judge_scores";
      if (isJudge) {
        judgeModelsUsed.push(req.model);
        // Primary judge = gpt-5.6-sol scores 9; second judge = gpt-5.2 scores 5.
        if (req.model === "gpt-5.2" && secondJudgeFails) {
          return { ok: false, status: 500, text: async () => "boom", json: async () => ({}) };
        }
        const body = chainBody(req.model === "gpt-5.2" ? 5 : 9);
        return {
          ok: true, status: 200,
          text: async () => "",
          json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }),
        };
      }
      return sse({ should_suggest: true, suggested_reply: "Hi there.", strategy: "answer" });
    };
    const clock = { t: 0 };
    const candidates: any[] = [
      { id: "sol-cand", label: "Sol", model: "gpt-5.6-sol", reasoningEffort: "none" },
    ];
    const availability: any[] = [
      { candidateId: "sol-cand", status: "AVAILABLE", checkedAt: "x", detail: "ok" },
    ];
    if (includeSecondCandidate) {
      candidates.push({ id: "52-cand", label: "5.2", model: "gpt-5.2", reasoningEffort: "none" });
      availability.push({ candidateId: "52-cand", status: "AVAILABLE", checkedAt: "x", detail: "ok" });
    }
    const res = await runBrainBenchmark({
      fixture: goldFixture as any,
      candidates,
      availability,
      judgeEnabled: true,
      fetchImpl: fetchImpl as any,
      nowMs: () => (clock.t += 10),
    } as any);
    return { res, judgeModelsUsed };
  }

  it("self-judged turns get an additional second-judge cross-check", async () => {
    const { res, judgeModelsUsed } = await runHarness(false, true);
    expect(res.judgeModel).toBe("gpt-5.6-sol");
    expect(res.secondJudgeModel).toBe("gpt-5.2");
    // Self-judged candidate: every judged turn has crossJudge from gpt-5.2.
    const selfTurns = res.turnResults.filter((t: any) => t.candidateId === "sol-cand" && t.judge);
    expect(selfTurns.length).toBeGreaterThan(0);
    for (const t of selfTurns as any[]) {
      expect(t.judge.selfJudged).toBe(true);
      expect(t.judge.crossJudge).toBeTruthy();
      expect(t.judge.crossJudge.judgeModel).toBe("gpt-5.2");
      expect(t.judge.crossJudge.scores.overall_live_copilot_quality).toBe(5);
    }
    // Non-self-judged candidate gets NO crossJudge.
    const otherTurns = res.turnResults.filter((t: any) => t.candidateId === "52-cand" && t.judge);
    for (const t of otherTurns as any[]) expect(t.judge.crossJudge).toBeUndefined();
    expect(judgeModelsUsed).toContain("gpt-5.2");
    // Scorecard exposes std + cross-judge averages for the self-judged entry.
    const solEntry = res.scorecard.candidates.find((c: any) => c.candidateId === "sol-cand")!;
    expect(solEntry.judgeStds).toBeTruthy();
    expect(solEntry.crossJudgeModel).toBe("gpt-5.2");
    expect(solEntry.crossJudgeAverages!.overall_live_copilot_quality).toBe(5);
  });

  it("fail-closed: second judge failure => crossJudge null + note, never substituted", async () => {
    const { res } = await runHarness(true, true);
    const selfTurns = res.turnResults.filter((t: any) => t.candidateId === "sol-cand" && t.judge);
    expect(selfTurns.length).toBeGreaterThan(0);
    for (const t of selfTurns as any[]) {
      expect(t.judge.crossJudge).toBeNull();
      // Primary score is untouched.
      expect(t.judge.scores.overall_live_copilot_quality).toBe(9);
    }
    expect(res.notes.some((n: string) => n.includes("second judge") && n.includes("honest self-judged mark stays"))).toBe(true);
  });

  it("fail-closed: no distinct second judge available => honest mark stays + note", async () => {
    const { res } = await runHarness(false, false);
    expect(res.secondJudgeModel).toBeNull();
    const selfTurns = res.turnResults.filter((t: any) => t.judge);
    for (const t of selfTurns as any[]) expect(t.judge.crossJudge).toBeUndefined();
    expect(res.notes.some((n: string) => n.includes("no second judge available"))).toBe(true);
  });
});
