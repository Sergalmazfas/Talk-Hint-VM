import { describe, it, expect } from "vitest";
import {
  buildEnvelopeInputs,
  buildSystemPrompt,
  buildCallState,
  PROMPT_VERSION,
  type FixtureLike,
} from "../benchmark/brainEnvelope";
import {
  GOLD_CALL_TURNS,
  GOLD_CALL_GOAL,
  GOLD_CALL_CONFIRMED_FACTS,
  GOLD_CALL_CRITICAL_ENTITIES,
} from "../benchmark/goldCall";
import { runDeterministicChecks } from "../benchmark/brainChecks";
import { runBrainBenchmark } from "../benchmark/brainHarness";
import { chatStream } from "../benchmark/openaiClient";
import type {
  AvailabilityResult,
  BrainCandidate,
  BrainEnvelopeInput,
} from "../benchmark/types";

const FIXTURE: FixtureLike = {
  goal: GOLD_CALL_GOAL,
  referenceTurns: GOLD_CALL_TURNS,
  confirmedFacts: GOLD_CALL_CONFIRMED_FACTS,
  criticalEntities: GOLD_CALL_CRITICAL_ENTITIES,
};

describe("buildEnvelopeInputs on GOLD_CALL_TURNS", () => {
  it("skips IVR turns before the first owner turn", () => {
    const envelopes = buildEnvelopeInputs(FIXTURE);
    const firstOwnerIdx = GOLD_CALL_TURNS.findIndex((t) => t.role === "owner");
    // No envelope may reference a guest turn before the first owner turn.
    for (const env of envelopes) {
      expect(env.currentGuestTurn.idx).toBeGreaterThan(firstOwnerIdx);
    }
    // Every eligible envelope is a guest turn.
    for (const env of envelopes) {
      expect(env.currentGuestTurn.role).toBe("guest");
    }
  });

  it("produces one envelope per eligible guest turn", () => {
    const envelopes = buildEnvelopeInputs(FIXTURE);
    const firstOwnerIdx = GOLD_CALL_TURNS.findIndex((t) => t.role === "owner");
    const expected = GOLD_CALL_TURNS.filter(
      (t) => t.role === "guest" && t.idx > firstOwnerIdx,
    ).length;
    expect(envelopes.length).toBe(expected);
    expect(envelopes.length).toBeGreaterThan(0);
  });

  it("envelope contains exactly the frozen fields", () => {
    const [env] = buildEnvelopeInputs(FIXTURE);
    expect(Object.keys(env).sort()).toEqual(
      [
        "confirmedFacts",
        "conversationSoFar",
        "currentCallState",
        "currentGuestTurn",
        "lastOwnerTurn",
        "originalGoal",
        "previousHintsRejected",
        "previousHintsShown",
      ].sort(),
    );
    expect(env.originalGoal).toBe(GOLD_CALL_GOAL);
    expect(env.previousHintsShown).toEqual([]);
    expect(env.previousHintsRejected).toEqual([]);
  });

  it("currentCallState is deterministic across calls", () => {
    const a = buildEnvelopeInputs(FIXTURE).map((e) => e.currentCallState);
    const b = buildEnvelopeInputs(FIXTURE).map((e) => e.currentCallState);
    expect(a).toEqual(b);
    // buildCallState is a pure function of transcript + facts.
    const idx = GOLD_CALL_TURNS.findIndex((t) => t.role === "guest" && /august/i.test(t.text));
    const s1 = buildCallState(FIXTURE, GOLD_CALL_TURNS, idx);
    const s2 = buildCallState(FIXTURE, GOLD_CALL_TURNS, idx);
    expect(s1).toBe(s2);
  });

  it("PROMPT_VERSION and system prompt are stable / non-empty", () => {
    expect(PROMPT_VERSION).toBe("brain-v2");
    const p = buildSystemPrompt();
    expect(p.toLowerCase()).toContain("restraint");
    expect(p.toLowerCase()).toContain("american english");
    expect(p).toContain("should_suggest");
  });
});

function makeInput(guestText: string, nextRole: "owner" | "guest" = "owner"): BrainEnvelopeInput {
  return {
    originalGoal: FIXTURE.goal,
    confirmedFacts: FIXTURE.confirmedFacts,
    conversationSoFar: [],
    currentGuestTurn: { idx: 5, role: "guest", text: guestText },
    lastOwnerTurn: null,
    previousHintsShown: [],
    previousHintsRejected: [],
    currentCallState: "state",
  };
}

describe("runDeterministicChecks", () => {
  it("catches hallucinated money amount not in critical entities", () => {
    const input = makeInput("How much do I owe?");
    const checks = runDeterministicChecks(
      input,
      { should_suggest: true, suggested_reply: "I need to pay $999.99 today.", strategy: "answer" },
      { criticalEntities: FIXTURE.criticalEntities, rejectedStrategies: [] },
    );
    expect(checks.mentionsCriticalEntityWhenExpected).toBe(false);
    expect(checks.notes.some((n) => n.includes("hallucinated"))).toBe(true);
  });

  it("passes a known money amount", () => {
    const input = makeInput("How much do I owe?");
    const checks = runDeterministicChecks(
      input,
      { should_suggest: true, suggested_reply: "I only owe $317.80.", strategy: "answer" },
      { criticalEntities: FIXTURE.criticalEntities, rejectedStrategies: [] },
    );
    expect(checks.mentionsCriticalEntityWhenExpected).toBe(true);
  });

  it("catches a repeated rejected strategy", () => {
    const input = makeInput("Please explain again.");
    const checks = runDeterministicChecks(
      input,
      { should_suggest: true, suggested_reply: "But it was my first payment.", strategy: "challenge" },
      { criticalEntities: FIXTURE.criticalEntities, rejectedStrategies: ["challenge"] },
    );
    expect(checks.nonRepetition).toBe(false);
    expect(checks.notes.some((n) => n.includes("repeated rejected strategy"))).toBe(true);
  });

  it("detects side-topic SSN request handling", () => {
    const input = makeInput("What is your Social Security number?");
    const ok = runDeterministicChecks(
      input,
      { should_suggest: true, suggested_reply: "My social is 101294556.", strategy: "answer" },
      { criticalEntities: FIXTURE.criticalEntities, rejectedStrategies: [] },
    );
    expect(ok.sideTopicHandled).toBe(true);
    const bad = runDeterministicChecks(
      input,
      { should_suggest: true, suggested_reply: "Can you check my balance?", strategy: "clarify" },
      { criticalEntities: FIXTURE.criticalEntities, rejectedStrategies: [] },
    );
    expect(bad.sideTopicHandled).toBe(false);
  });

  it("valid output with no issues passes", () => {
    const input = makeInput("Is that correct?");
    const checks = runDeterministicChecks(
      input,
      { should_suggest: true, suggested_reply: "Yes, that is correct.", strategy: "confirm" },
      { criticalEntities: FIXTURE.criticalEntities, rejectedStrategies: ["challenge"] },
    );
    expect(checks.schemaValid).toBe(true);
    expect(checks.strategyValid).toBe(true);
    expect(checks.nonRepetition).toBe(true);
  });

  it("null output => schemaValid false", () => {
    const input = makeInput("hello");
    const checks = runDeterministicChecks(input, null, {
      criticalEntities: FIXTURE.criticalEntities,
      rejectedStrategies: [],
    });
    expect(checks.schemaValid).toBe(false);
  });
});

// --- Mocked harness (no network). fetchImpl returns a fake SSE stream. -------

function sseResponse(body: string) {
  // Build a web ReadableStream of the SSE bytes.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    body: stream,
    text: async () => body,
    json: async () => ({}),
  };
}

function envelopeChunks(obj: any): string {
  const json = JSON.stringify(obj);
  // Split into a couple of deltas + usage + DONE.
  const mid = Math.floor(json.length / 2);
  return (
    `data: ${JSON.stringify({ choices: [{ delta: { content: json.slice(0, mid) } }] })}\n` +
    `data: ${JSON.stringify({ choices: [{ delta: { content: json.slice(mid) } }] })}\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n` +
    `data: [DONE]\n`
  );
}

describe("runBrainBenchmark (mocked, no network)", () => {
  const candidate: BrainCandidate = {
    id: "mock-cand",
    label: "Mock",
    model: "gpt-4.1-mini",
    reasoningEffort: "n/a",
  };
  const availability: AvailabilityResult[] = [
    { candidateId: "mock-cand", status: "AVAILABLE", checkedAt: "2026-01-01T00:00:00Z", detail: "ok" },
  ];

  it("counts continuity + handles malformed JSON mid-run", async () => {
    let call = 0;
    const clock = { t: 0 };
    const nowMs = () => (clock.t += 10);

    const fetchImpl = async (_url: string) => {
      call++;
      // Make the 2nd turn return malformed JSON; all others valid.
      if (call === 2) return sseResponse(`data: {"choices":[{"delta":{"content":"NOT JSON"}}]}\ndata: [DONE]\n`);
      return sseResponse(
        envelopeChunks({
          should_suggest: true,
          suggested_reply: "I only owe $317.80.",
          strategy: "answer",
        }),
      );
    };

    const res = await runBrainBenchmark({
      fixture: FIXTURE,
      candidates: [candidate],
      availability,
      judgeEnabled: false,
      fetchImpl: fetchImpl as any,
      nowMs,
    });

    const cont = res.continuity["mock-cand"];
    expect(cont.eligibleGuestTurns).toBeGreaterThan(0);
    expect(cont.hintsRequested).toBe(cont.eligibleGuestTurns);
    // Exactly one malformed turn => one miss, generated = requested - 1.
    expect(cont.hintsMissed).toBe(1);
    expect(cont.hintsGenerated).toBe(cont.hintsRequested - 1);
    expect(cont.maxConsecutiveMissedHints).toBe(1);
    // The malformed turn is recorded as a 'brain' stage miss.
    expect(cont.misses[0].stage).toBe("brain");

    // Scorecard present with cost estimate (gpt-4.1-mini has known pricing).
    const entry = res.scorecard.candidates[0];
    expect(entry.candidateId).toBe("mock-cand");
    expect(entry.estCostPer10MinCall).not.toBeNull();
    expect(entry.costNote).toBeNull();
    expect(entry.clientRenderEstimated).toBe(true);
  });

  it("consecutive malformed turns raise maxConsecutiveMissedHints", async () => {
    let call = 0;
    const clock = { t: 0 };
    const nowMs = () => (clock.t += 10);
    const fetchImpl = async (_url: string) => {
      call++;
      if (call <= 3) return sseResponse(`data: {"choices":[{"delta":{"content":"NOPE"}}]}\ndata: [DONE]\n`);
      return sseResponse(
        envelopeChunks({ should_suggest: false }),
      );
    };
    const res = await runBrainBenchmark({
      fixture: FIXTURE,
      candidates: [candidate],
      availability,
      fetchImpl: fetchImpl as any,
      nowMs,
    });
    expect(res.continuity["mock-cand"].maxConsecutiveMissedHints).toBe(3);
  });

  it("skips candidates that are not AVAILABLE", async () => {
    const res = await runBrainBenchmark({
      fixture: FIXTURE,
      candidates: [candidate],
      availability: [
        { candidateId: "mock-cand", status: "UNAVAILABLE", checkedAt: "x", detail: "nope" },
      ],
      fetchImpl: (async () => {
        throw new Error("should not be called");
      }) as any,
      nowMs: () => 0,
    });
    expect(res.turnResults.length).toBe(0);
    expect(res.notes.some((n) => n.includes("not AVAILABLE"))).toBe(true);
  });

  it("records a brain-stage miss (never hangs) when a turn throws mid-stream", async () => {
    let call = 0;
    const clock = { t: 0 };
    const nowMs = () => (clock.t += 10);
    // 2nd turn: fetch resolves ok but the reader throws when read.
    const fetchImpl = async (_url: string) => {
      call++;
      if (call === 2) {
        const throwingStream = {
          getReader() {
            return {
              read: async () => {
                throw new Error("boom: transport exploded");
              },
              cancel: async () => {},
            };
          },
        };
        return { ok: true, status: 200, body: throwingStream, text: async () => "", json: async () => ({}) };
      }
      return sseResponse(envelopeChunks({ should_suggest: false }));
    };
    const res = await runBrainBenchmark({
      fixture: FIXTURE,
      candidates: [candidate],
      availability,
      fetchImpl: fetchImpl as any,
      nowMs,
    });
    const cont = res.continuity["mock-cand"];
    // Exactly one thrown turn => one miss, recorded as a 'brain' stage miss.
    expect(cont.hintsMissed).toBe(1);
    expect(cont.misses[0].stage).toBe("brain");
    // The rest of the chain still ran to completion.
    expect(cont.hintsGenerated).toBe(cont.hintsRequested - 1);
    expect(res.turnResults.length).toBe(cont.eligibleGuestTurns);
  });
});

describe("chatStream timeout covers body consumption (no network)", () => {
  it("aborts and returns a bounded timeout when the SSE body stalls forever", async () => {
    // A never-ending body: the reader only resolves when the abort signal fires
    // (mirrors how a real fetch reader rejects/ends on AbortController.abort()).
    const stalledFetch = async (_url: string, init: any) => {
      const signal: AbortSignal | undefined = init?.signal;
      const body = {
        getReader() {
          return {
            read: () =>
              new Promise((_resolve, reject) => {
                if (signal) {
                  const onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
                  if (signal.aborted) onAbort();
                  else signal.addEventListener("abort", onAbort, { once: true });
                }
                // Never resolves on its own — only the abort ends it.
              }),
            cancel: async () => {},
          };
        },
      };
      return { ok: true, status: 200, body, text: async () => "", json: async () => ({}) };
    };

    const start = Date.now();
    const res = await chatStream({
      model: "gpt-4.1-mini",
      system: "s",
      user: "u",
      maxTokens: 10,
      timeoutMs: 150,
      fetchImpl: stalledFetch as any,
      nowMs: () => Date.now(),
    });
    const elapsed = Date.now() - start;

    expect(res.ok).toBe(false);
    expect(res.errorText).toMatch(/timeout/);
    // The bound was actually enforced during body reading (not left to hang).
    expect(elapsed).toBeGreaterThanOrEqual(120);
    expect(elapsed).toBeLessThan(2000);
  });
});
