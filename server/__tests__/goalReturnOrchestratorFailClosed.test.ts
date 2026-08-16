// Tests for Task #240: Goal-Return orchestrator fails loudly when no judge model
// is available (fail-closed path in startGoalReturnRun lines 173-178).
//
// Strategy: mock the db and all dynamically-imported benchmark modules so the
// background IIFE completes synchronously. A deferred-promise pattern lets the
// test await the finishRun call that happens inside the fire-and-forget IIFE.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mutable state — set before each test so vi.mock factory can reach it.
// ---------------------------------------------------------------------------
const _finish: { patch: any; resolve: (() => void) | null } = { patch: null, resolve: null };

// ---------------------------------------------------------------------------
// Module mocks (hoisted before imports)
// ---------------------------------------------------------------------------

vi.mock("../db", () => {
  const mockUpdate = {
    set: (patch: any) => ({
      where: () => {
        _finish.patch = patch;
        _finish.resolve?.();
        return Promise.resolve();
      },
    }),
  };
  return {
    db: {
      insert: () => ({
        values: () => ({
          returning: async () => [
            {
              id: "test-run-id",
              runType: "goal_return",
              status: "running",
              corpusHash: "abc",
              fixtureIds: [],
              config: {},
              promptVersion: "v1",
              startedAt: new Date(),
              finishedAt: null,
              availability: null,
              results: null,
              scorecard: null,
              report: null,
              error: null,
            },
          ],
        }),
      }),
      update: () => mockUpdate,
      select: () => ({ from: () => ({ where: async () => [] }) }),
    },
  };
});

vi.mock("../benchmark/seed", () => ({
  corpusHash: () => "test-hash",
}));

vi.mock("../benchmark/candidates", () => ({
  BRAIN_CANDIDATES: [
    { id: "candidate-1", model: "gpt-test", label: "Test Candidate", reasoningEffort: "none", baseline: true },
  ],
  EARS_CANDIDATES: [],
  JUDGE_PREFERENCE: ["gpt-test"],
}));

// checkBrainAvailability returns a single UNAVAILABLE result.
vi.mock("../benchmark/brainAvailability", () => ({
  checkBrainAvailability: async () => [
    {
      candidateId: "candidate-1",
      status: "UNAVAILABLE",
      checkedAt: new Date().toISOString(),
      detail: "simulated unavailability for test",
    },
  ],
}));

// pickJudgeModel returns null — no judge is reachable.
vi.mock("../benchmark/judge", () => ({
  pickJudgeModel: () => null,
  pickSecondJudgeModel: () => null,
}));

// goalReturn module — should never be called when no judge is available; mock
// anyway to guard against accidental invocation.
vi.mock("../benchmark/goalReturn", () => ({
  parseTranscriptTurns: vi.fn(() => { throw new Error("should not be called when no judge"); }),
  judgeGoalReturn: vi.fn(() => { throw new Error("should not be called when no judge"); }),
  computeGoalReturnMetrics: vi.fn(() => { throw new Error("should not be called when no judge"); }),
  judgeDeliveredHints: vi.fn(() => { throw new Error("should not be called when no judge"); }),
  computeHintMetrics: vi.fn(() => { throw new Error("should not be called when no judge"); }),
  generateGoalReturnReport: vi.fn(() => { throw new Error("should not be called when no judge"); }),
}));

// drizzle-orm: preserve real exports (sql, pgTable, etc.) but stub eq/desc.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: () => "eq-stub",
    desc: () => "desc-stub",
  };
});

// ---------------------------------------------------------------------------
// Import the SUT after mocks are registered.
// ---------------------------------------------------------------------------
import { startGoalReturnRun } from "../benchmark/orchestrator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Two minimal valid calls (batch requires ≥2 entries). */
const TWO_VALID_CALLS = [
  {
    title: "Call A",
    goal: "Activate the customer's online banking account",
    goalSource: "operator-supplied",
    transcript: "Guest: Hello. Owner: Let me help.",
    hintStats: null,
    hints: null,
  },
  {
    title: "Call B",
    goal: "Verify the customer identity",
    goalSource: "operator-supplied",
    transcript: "Guest: Hi. Owner: Can I get your name?",
    hintStats: null,
    hints: null,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startGoalReturnRun — fail-closed when no judge model is available", () => {
  beforeEach(() => {
    _finish.patch = null;
    _finish.resolve = null;
  });

  it("sets status='failed' with a non-empty error when all brain candidates are UNAVAILABLE", async () => {
    // Arm the deferred promise BEFORE calling startGoalReturnRun so the IIFE
    // can see _finish.resolve when it calls finishRun.
    const finishCalled = new Promise<void>((resolve) => {
      _finish.resolve = resolve;
    });

    // startGoalReturnRun returns immediately with a runId; the actual analysis
    // runs in a background fire-and-forget IIFE.
    const { runId } = await startGoalReturnRun(TWO_VALID_CALLS);
    expect(runId).toBe("test-run-id");

    // Wait for the background IIFE to call finishRun (our db.update mock).
    await finishCalled;

    const patch = _finish.patch;
    expect(patch).not.toBeNull();
    expect(patch.status).toBe("failed");
    expect(typeof patch.error).toBe("string");
    expect(patch.error.trim().length).toBeGreaterThan(0);
  });

  it("error message mentions judge model unavailability", async () => {
    const finishCalled = new Promise<void>((resolve) => {
      _finish.resolve = resolve;
    });

    await startGoalReturnRun(TWO_VALID_CALLS);
    await finishCalled;

    const patch = _finish.patch;
    // The error message must make the root cause clear — not a generic "failed".
    expect(patch.error.toLowerCase()).toMatch(/judge|model|available/);
  });

  it("availability data is recorded alongside the failure", async () => {
    const finishCalled = new Promise<void>((resolve) => {
      _finish.resolve = resolve;
    });

    await startGoalReturnRun(TWO_VALID_CALLS);
    await finishCalled;

    const patch = _finish.patch;
    // The availability snapshot must be persisted so admins can see WHY no
    // judge was reachable (fail-closed is only useful if the cause is visible).
    expect(patch.availability).toBeDefined();
    expect(Array.isArray(patch.availability?.brain)).toBe(true);
    expect(patch.availability.brain.length).toBeGreaterThan(0);
    expect(patch.availability.brain[0].status).toBe("UNAVAILABLE");
  });

  it("goalReturn analysis functions are never called when no judge is available", async () => {
    const finishCalled = new Promise<void>((resolve) => {
      _finish.resolve = resolve;
    });

    // The goalReturn module functions are mocked to throw — if any are called
    // this test will fail with an error, proving the guard works.
    await startGoalReturnRun(TWO_VALID_CALLS);
    await finishCalled;

    // If we reached here without an error, no goalReturn functions were called.
    expect(_finish.patch.status).toBe("failed");
  });
});
