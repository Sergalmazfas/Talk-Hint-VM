// Component tests for the Hint column in GoalReturnRunDetail (Task #241).
//
// The Hint column is only shown when hintLabels are present on a call result.
// Hints are aligned to turns via spokenMatchTurnIdx (primary) or via
// utteranceId treated as a 1-based guest-utterance ordinal (fallback).
//
// Uses renderToStaticMarkup (no jsdom) following the pattern of
// goalReturnUiError.test.ts.

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// ---------------------------------------------------------------------------
// Module mocks (same set as goalReturnUiError.test.ts)
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  Link: ({ children }: any) => children,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false, error: null }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  QueryClient: class {},
  QueryClientProvider: ({ children }: any) => children,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token", isLoading: false }),
  AuthProvider: ({ children }: any) => children,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { GoalReturnRunDetail } from "../../client/src/pages/admin-diagnostics";

// ---------------------------------------------------------------------------
// Shared fixture builder
// ---------------------------------------------------------------------------

// Alternating guest/owner turns: idx 0=guest, 1=owner, 2=guest, 3=owner
const TURNS = [
  { idx: 0, role: "guest", text: "Hello, I need to cancel my subscription." },
  { idx: 1, role: "owner", text: "Sure, I can help with that." },
  { idx: 2, role: "guest", text: "Yes please, account number 123." },
  { idx: 3, role: "owner", text: "I'll process the cancellation now." },
];

const LABELS = TURNS.map((t) => ({
  idx: t.idx,
  segment: "on_goal",
  ownerMove: t.role === "owner" ? "neutral" : null,
  note: `turn ${t.idx} note`,
}));

function makeCallResult(overrides: {
  hints?: { text: string; utteranceId?: number }[];
  hintLabels?: {
    index: number;
    role: string;
    note: string;
    spokenMatchTurnIdx: number | null;
    spokenSimilarity: number | null;
  }[];
}) {
  return {
    title: "Test call",
    goal: "Cancel subscription",
    goalSource: "operator-supplied",
    turns: TURNS,
    labels: LABELS,
    ...overrides,
  };
}

function makeRun(call: ReturnType<typeof makeCallResult>) {
  return {
    id: "run-1",
    runType: "goal_return" as const,
    status: "completed" as const,
    corpusHash: "abc",
    error: null,
    finishedAt: new Date().toISOString(),
    results: {
      judgeModel: "gpt-4o",
      calls: [call],
    },
    scorecard: { calls: [{ title: call.title, onGoalPct: 1, digressionCount: 0, returnRate: 1 }] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GoalReturnRunDetail — Hint column", () => {
  it("does NOT render the Hint column when hintLabels is absent", () => {
    const run = makeRun(makeCallResult({}));
    const html = renderToStaticMarkup(
      React.createElement(GoalReturnRunDetail, { run: run as any }),
    );
    // No hint header
    expect(html).not.toContain(">Hint<");
    // No hint cell test-ids
    expect(html).not.toMatch(/data-testid="gr-hint-cell-/);
  });

  it("does NOT render the Hint column when hintLabels is an empty array", () => {
    const run = makeRun(makeCallResult({ hints: [], hintLabels: [] }));
    const html = renderToStaticMarkup(
      React.createElement(GoalReturnRunDetail, { run: run as any }),
    );
    expect(html).not.toContain(">Hint<");
    expect(html).not.toMatch(/data-testid="gr-hint-cell-/);
  });

  it("renders the Hint column header when hintLabels are present", () => {
    const run = makeRun(
      makeCallResult({
        hints: [{ text: "I can cancel that right now." }],
        hintLabels: [
          { index: 0, role: "returns_to_goal", note: "good hint", spokenMatchTurnIdx: 1, spokenSimilarity: 0.9 },
        ],
      }),
    );
    const html = renderToStaticMarkup(
      React.createElement(GoalReturnRunDetail, { run: run as any }),
    );
    expect(html).toContain(">Hint<");
  });

  it("places a hint on the correct row via spokenMatchTurnIdx (turn idx=1)", () => {
    const run = makeRun(
      makeCallResult({
        hints: [{ text: "I can cancel that right now." }],
        hintLabels: [
          { index: 0, role: "returns_to_goal", note: "steers back", spokenMatchTurnIdx: 1, spokenSimilarity: 0.9 },
        ],
      }),
    );
    const html = renderToStaticMarkup(
      React.createElement(GoalReturnRunDetail, { run: run as any }),
    );
    // Hint label chip on turn row 1
    expect(html).toContain('data-testid="gr-hint-label-0-1-0"');
    // returns_to_goal label text present
    expect(html).toContain("returns_to_goal");
    // Turn rows with no hint should NOT have a hint chip
    expect(html).not.toMatch(/data-testid="gr-hint-label-0-0-/);
    expect(html).not.toMatch(/data-testid="gr-hint-label-0-2-/);
    expect(html).not.toMatch(/data-testid="gr-hint-label-0-3-/);
  });

  it("shows an em-dash placeholder on rows with no aligned hint", () => {
    const run = makeRun(
      makeCallResult({
        hints: [{ text: "Sure, I can help." }],
        hintLabels: [
          { index: 0, role: "neutral", note: "filler", spokenMatchTurnIdx: 1, spokenSimilarity: 0.6 },
        ],
      }),
    );
    const html = renderToStaticMarkup(
      React.createElement(GoalReturnRunDetail, { run: run as any }),
    );
    // Turn 0 cell exists but has no chip
    expect(html).toContain('data-testid="gr-hint-cell-0-0"');
    // Turn 1 cell has a chip
    expect(html).toContain('data-testid="gr-hint-label-0-1-0"');
  });

  it("aligns multiple hints to the same row when both point to the same turn", () => {
    const run = makeRun(
      makeCallResult({
        hints: [
          { text: "I can cancel that right now." },
          { text: "Let me look up your account." },
        ],
        hintLabels: [
          { index: 0, role: "returns_to_goal", note: "hint A", spokenMatchTurnIdx: 1, spokenSimilarity: 0.9 },
          { index: 1, role: "neutral", note: "hint B", spokenMatchTurnIdx: 1, spokenSimilarity: 0.5 },
        ],
      }),
    );
    const html = renderToStaticMarkup(
      React.createElement(GoalReturnRunDetail, { run: run as any }),
    );
    // Both chips appear on turn row 1
    expect(html).toContain('data-testid="gr-hint-label-0-1-0"');
    expect(html).toContain('data-testid="gr-hint-label-0-1-1"');
  });

  it("does not place a hint when spokenMatchTurnIdx is null and utteranceId is absent", () => {
    const run = makeRun(
      makeCallResult({
        hints: [{ text: "Some unmatched hint." }],
        hintLabels: [
          { index: 0, role: "drifts", note: "bad hint", spokenMatchTurnIdx: null, spokenSimilarity: null },
        ],
      }),
    );
    const html = renderToStaticMarkup(
      React.createElement(GoalReturnRunDetail, { run: run as any }),
    );
    // Column header appears (hintLabels non-empty)
    expect(html).toContain(">Hint<");
    // No chip anywhere (unmatched hint)
    expect(html).not.toMatch(/data-testid="gr-hint-label-/);
  });

  it("uses utteranceId (1-based guest ordinal) to place hint on the owner turn that follows the Nth guest", () => {
    // utteranceId=1 → 1st guest turn is idx=0 → nearest following turn is idx=1 (owner)
    const run = makeRun(
      makeCallResult({
        hints: [{ text: "Sure, I can help with that.", utteranceId: 1 }],
        hintLabels: [
          { index: 0, role: "supports_branch", note: "via utteranceId", spokenMatchTurnIdx: null, spokenSimilarity: null },
        ],
      }),
    );
    const html = renderToStaticMarkup(
      React.createElement(GoalReturnRunDetail, { run: run as any }),
    );
    // Hint should land on turn idx=1 (owner turn after the 1st guest turn)
    expect(html).toContain('data-testid="gr-hint-label-0-1-0"');
    // Should NOT appear on turn 0 (the guest turn itself)
    expect(html).not.toMatch(/data-testid="gr-hint-label-0-0-/);
  });

  it("uses utteranceId=2 to place hint on owner turn after the 2nd guest turn", () => {
    // utteranceId=2 → 2nd guest turn is idx=2 → nearest following turn is idx=3 (owner)
    const run = makeRun(
      makeCallResult({
        hints: [{ text: "I'll process the cancellation now.", utteranceId: 2 }],
        hintLabels: [
          { index: 0, role: "returns_to_goal", note: "via utteranceId 2", spokenMatchTurnIdx: null, spokenSimilarity: null },
        ],
      }),
    );
    const html = renderToStaticMarkup(
      React.createElement(GoalReturnRunDetail, { run: run as any }),
    );
    // Hint should land on turn idx=3 (owner turn after the 2nd guest turn)
    expect(html).toContain('data-testid="gr-hint-label-0-3-0"');
    expect(html).not.toMatch(/data-testid="gr-hint-label-0-2-/);
  });

  it("prefers spokenMatchTurnIdx over utteranceId when both are present", () => {
    // spokenMatchTurnIdx=3, utteranceId=1 (would resolve to turn 1) — must use 3
    const run = makeRun(
      makeCallResult({
        hints: [{ text: "I'll process the cancellation now.", utteranceId: 1 }],
        hintLabels: [
          { index: 0, role: "returns_to_goal", note: "primary wins", spokenMatchTurnIdx: 3, spokenSimilarity: 0.85 },
        ],
      }),
    );
    const html = renderToStaticMarkup(
      React.createElement(GoalReturnRunDetail, { run: run as any }),
    );
    // Must appear on turn 3 (spokenMatchTurnIdx wins)
    expect(html).toContain('data-testid="gr-hint-label-0-3-0"');
    // Must NOT appear on turn 1 (utteranceId fallback)
    expect(html).not.toMatch(/data-testid="gr-hint-label-0-1-/);
  });
});
