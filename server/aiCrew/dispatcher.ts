// No exception text/stack, credentials, excerpts or arbitrary identifiers in
// operational logs. Unknown errors retain a static code, not String(error).
const safeCodes = new Set(["CREW_NOT_INITIALIZED", "DATABASE_UNAVAILABLE", "EVIDENCE_CHANGED",
  "PILOT_ASSIGNMENT_CHANGED", "AUTHOR_PROPOSAL_REQUIRED", "TASK_TOO_LARGE", "UNPRICED_AGENT"]);
export function dispatcherErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return safeCodes.has(message) ? message : "DISPATCH_FAILED";
}
export function crewDiagnostic(event: string, detail: Record<string, string | number> = {}) {
  console.info("[AI Crew]", JSON.stringify({ event, ...detail }));
}

/** Observability only: never reset a busy latch or retry a paid request. */
export function startCrewDispatcher(options: {
  environment: string;
  observePublication: () => Promise<void>;
  tick: () => Promise<void>;
  report?: typeof crewDiagnostic;
  now?: () => number;
}) {
  if (options.environment !== "production") return;
  const report = options.report ?? crewDiagnostic, now = options.now ?? Date.now;
  let busy = false, observed = false, healthyReported = false, startedAt = 0, lastBusyReport = 0;
  report("dispatcher_started", { intervalMs: 15000 });
  const timer = setInterval(async () => {
    if (busy) {
      if (now() - startedAt >= 60000 && now() - lastBusyReport >= 60000) {
        report("dispatcher_busy", { elapsedMs: now() - startedAt }); lastBusyReport = now();
      }
      return;
    }
    busy = true; startedAt = now();
    let phase = "publication";
    try {
      if (!observed) { await options.observePublication(); observed = true; }
      phase = "tick"; await options.tick();
      if (!healthyReported) { report("dispatcher_tick_ok"); healthyReported = true; }
    } catch (error) {
      report("dispatcher_failed", { phase, code: dispatcherErrorCode(error) });
      // Missing DB/schema or invalid evidence still fail closed.
    } finally { busy = false; }
  }, 15000);
  timer.unref();
  return timer;
}
