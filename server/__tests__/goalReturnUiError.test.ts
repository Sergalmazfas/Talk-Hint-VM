// UI rendering test for Task #240: GoalReturnTab shows data-testid="gr-error"
// when the detail run has failed.
//
// Imports the REAL GoalReturnRunDetail export from admin-diagnostics.tsx so
// that any change to the production gr-error condition or testid breaks these
// tests — a clone would not provide that guarantee.
//
// react-dom/server renderToStaticMarkup runs in Node without jsdom; it renders
// the full component tree synchronously with no hooks or effects.

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// ---------------------------------------------------------------------------
// Mock hook/router modules that are imported by admin-diagnostics.tsx but are
// not called by the pure-presentational GoalReturnRunDetail component.
// The mocks only need to export valid shapes so the module loads; they are
// never invoked during renderToStaticMarkup of GoalReturnRunDetail.
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

// ---------------------------------------------------------------------------
// Import the real component under test.
// ---------------------------------------------------------------------------
import { GoalReturnRunDetail } from "../../client/src/pages/admin-diagnostics";

// Minimal BenchmarkRun shape (mirrors the interface in admin-diagnostics.tsx).
type RunStatus = "running" | "completed" | "failed";
function makeRun(overrides: { status: RunStatus; error?: string | null; finishedAt?: string | null }) {
  return {
    id: "run-id-1",
    runType: "goal_return" as const,
    status: overrides.status,
    corpusHash: "abc",
    error: overrides.error ?? null,
    finishedAt: overrides.finishedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GoalReturnRunDetail (real component) — gr-error block", () => {
  it("renders data-testid='gr-error' when the run has status='failed' with an error", () => {
    const run = makeRun({
      status: "failed",
      error: "no judge model available — goal-return analysis cannot run",
      finishedAt: new Date().toISOString(),
    });

    const html = renderToStaticMarkup(
      React.createElement(GoalReturnRunDetail, { run: run as any }),
    );

    expect(html).toContain('data-testid="gr-error"');
    expect(html).toContain("no judge model available");
  });

  it("does NOT render gr-error when the run completed with no error", () => {
    const run = makeRun({
      status: "completed",
      error: null,
      finishedAt: new Date().toISOString(),
    });

    const html = renderToStaticMarkup(
      React.createElement(GoalReturnRunDetail, { run: run as any }),
    );

    expect(html).not.toContain('data-testid="gr-error"');
  });

  it("does NOT render gr-error when the run is still running", () => {
    const run = makeRun({ status: "running", error: null, finishedAt: null });

    const html = renderToStaticMarkup(
      React.createElement(GoalReturnRunDetail, { run: run as any }),
    );

    expect(html).not.toContain('data-testid="gr-error"');
  });

  it("renders the full error text verbatim inside the gr-error block", () => {
    const errorMsg =
      "no judge model available — goal-return analysis cannot run";
    const run = makeRun({ status: "failed", error: errorMsg });

    const html = renderToStaticMarkup(
      React.createElement(GoalReturnRunDetail, { run: run as any }),
    );

    // Error text must appear inside the block so admins can read WHY it failed.
    expect(html).toContain(errorMsg);
    // The block must appear before the error text (not somewhere else in the DOM).
    const errorBlockIdx = html.indexOf('data-testid="gr-error"');
    const errorTextIdx = html.indexOf(errorMsg);
    expect(errorBlockIdx).toBeGreaterThan(-1);
    expect(errorTextIdx).toBeGreaterThan(errorBlockIdx);
  });
});
