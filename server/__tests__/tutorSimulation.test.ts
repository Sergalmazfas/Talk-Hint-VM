// Goal-Driven Simulation (Engine contract v1, 2026-08-13) — session-create
// payload shapes, the fail-closed error matrix, request validation, and the
// page's opening-turn behavior (contract §3). No silent fallback anywhere.
import { describe, it, expect } from "vitest";
import { buildSessionPayload, simulationErrorCode, TutorEngineError, SIMULATION_ERROR_CODES } from "../tutorEngine";
import { validateSimulationRequest, buildSimulationParams, mapSimulationEngineError, simulationEchoMatches } from "../tutorSimulation";
import { classifyEngineEvent } from "../tutorRealtimeUi";
import { TUTOR_AVATAR_PAGE_HTML } from "../tutorAvatarPage";

describe("session payloads — practice unchanged, simulation per contract §1", () => {
  it("practice payload keeps the verified schema and NEVER carries a simulation field", () => {
    const p = buildSessionPayload("u1");
    expect(p).toEqual({
      user_id: "u1",
      scenario_id: "english_free_talk",
      tutor_id: "emma_us_01",
      mode: "practice",
      target_language: "en",
      native_language: "ru",
    });
    expect("simulation" in p).toBe(false);
  });
  it("simulation payload matches the contract exactly (source: none)", () => {
    const p = buildSessionPayload("u1", {
      goal: "book a doctor appointment",
      learnerRole: "caller",
      tutorRole: "clinic receptionist",
      context: { source: "none" },
    });
    expect(p).toEqual({
      user_id: "u1",
      scenario_id: "english_free_talk",
      tutor_id: "emma_us_01",
      mode: "simulation",
      language: { target: "en", native: "ru" },
      simulation: {
        goal: "book a doctor appointment",
        roles: { learner: "caller", tutor: "clinic receptionist" },
        context: { source: "none" },
      },
    });
  });
  it("call-memory context goes BY REFERENCE only (group id + version, no inline facts)", () => {
    const p: any = buildSessionPayload("u1", {
      goal: "g", learnerRole: "client", tutorRole: "lawyer",
      context: { source: "call_memory", callMemoryGroupId: "grp-1", version: 3 },
    });
    expect(p.simulation.context).toEqual({ source: "call_memory", call_memory_group_id: "grp-1", version: 3 });
    const json = JSON.stringify(p);
    expect(json).not.toContain("facts");
    expect(json).not.toContain("questions");
  });
  it("simulation payload never carries app/org ids or derived goal internals", () => {
    const json = JSON.stringify(buildSessionPayload("u1", {
      goal: "g", learnerRole: "a", tutorRole: "b", context: { source: "none" },
    }));
    for (const banned of ["application_id", "organization_id", "keywords", "slots", "goalAchieved", "objective"]) {
      expect(json).not.toContain(banned);
    }
  });
});

describe("fail-closed error matrix — every engine code maps to an explicit response", () => {
  it("simulationErrorCode extracts each contract code from the engine body", () => {
    for (const code of SIMULATION_ERROR_CODES) {
      const err = new TutorEngineError("x", 422, "http", `{"error":"${code}","message":"…"}`);
      expect(simulationErrorCode(err)).toBe(code);
    }
  });
  it("returns null for unrelated errors (they take the generic path)", () => {
    expect(simulationErrorCode(new TutorEngineError("x", 500, "http", "boom"))).toBeNull();
    expect(simulationErrorCode(new Error("network"))).toBeNull();
  });
  it("CALL_MEMORY_DISABLED is recognized even via the 403 auth path", () => {
    const err = new TutorEngineError("auth", 403, "auth", '{"error":"CALL_MEMORY_DISABLED"}');
    expect(simulationErrorCode(err)).toBe("CALL_MEMORY_DISABLED");
  });
  it("every code maps to a non-2xx status with a user-facing message — no fallback signal anywhere", () => {
    for (const code of SIMULATION_ERROR_CODES) {
      const m = mapSimulationEngineError(code);
      expect(m.status).toBeGreaterThanOrEqual(400);
      expect(m.error.length).toBeGreaterThan(0);
      expect(m.message.length).toBeGreaterThan(0);
    }
    // 422×3 of the contract table:
    expect(mapSimulationEngineError("SIMULATION_INVALID").status).toBe(422);
    expect(mapSimulationEngineError("CALL_MEMORY_NOT_FOUND").status).toBe(404);
    expect(mapSimulationEngineError("CALL_MEMORY_NOT_CONFIRMED").status).toBe(409);
    expect(mapSimulationEngineError("CALL_MEMORY_DISABLED").status).toBe(403);
  });
  it("the route rejects a failed simulation create — never synthesizes practice", () => {
    // Structural: the page reopens the simulation form on failure instead of
    // silently connecting in practice mode.
    expect(TUTOR_AVATAR_PAGE_HTML).toMatch(/if \(simulation\) \{[\s\S]{0,200}openSimSheet\(e\.message\)/);
    expect(TUTOR_AVATAR_PAGE_HTML).not.toMatch(/catch[\s\S]{0,120}simulation = null;[\s\S]{0,120}connect\(/);
  });
});

describe("simulation echo verification (contract §1: verify before connecting)", () => {
  const sim = {
    goal: "book it", learnerRole: "caller", tutorRole: "receptionist",
    context: { source: "none" } as const,
  };
  it("accepts an exact echo", () => {
    expect(simulationEchoMatches(sim, {
      goal: "book it", roles: { learner: "caller", tutor: "receptionist" }, context: { source: "none" },
    })).toBe(true);
  });
  it("rejects missing/truthy-but-unrelated echoes and mismatched fields", () => {
    expect(simulationEchoMatches(sim, null)).toBe(false);
    expect(simulationEchoMatches(sim, { enabled: true })).toBe(false);
    expect(simulationEchoMatches(sim, { goal: "other", roles: { learner: "caller", tutor: "receptionist" }, context: { source: "none" } })).toBe(false);
    expect(simulationEchoMatches(sim, { goal: "book it", roles: { learner: "caller", tutor: "someone else" }, context: { source: "none" } })).toBe(false);
    expect(simulationEchoMatches(sim, { goal: "book it", roles: { learner: "caller", tutor: "receptionist" }, context: { source: "call_memory" } })).toBe(false);
  });
  it("call-memory echo must match group id AND version", () => {
    const simCm = { ...sim, context: { source: "call_memory", callMemoryGroupId: "g1", version: 3 } as const };
    const ok = { goal: "book it", roles: { learner: "caller", tutor: "receptionist" }, context: { source: "call_memory", call_memory_group_id: "g1", version: 3 } };
    expect(simulationEchoMatches(simCm, ok)).toBe(true);
    expect(simulationEchoMatches(simCm, { ...ok, context: { ...ok.context, version: 2 } })).toBe(false);
    expect(simulationEchoMatches(simCm, { ...ok, context: { ...ok.context, call_memory_group_id: "g2" } })).toBe(false);
  });
});

describe("request validation — limits mirror the contract", () => {
  it("accepts a minimal valid request and defaults learner role", () => {
    const v = validateSimulationRequest({ goal: " book it ", tutorRole: "receptionist" });
    expect(v).toEqual({ ok: true, goal: "book it", learnerRole: "caller", tutorRole: "receptionist", memoryId: null });
  });
  it("rejects empty goal, >500 goal, missing/long roles", () => {
    expect(validateSimulationRequest({ tutorRole: "x" })).toMatchObject({ ok: false, error: "simulation_goal_required" });
    expect(validateSimulationRequest({ goal: "a".repeat(501), tutorRole: "x" })).toMatchObject({ ok: false, error: "simulation_goal_too_long" });
    expect(validateSimulationRequest({ goal: "g" })).toMatchObject({ ok: false, error: "simulation_role_required" });
    expect(validateSimulationRequest({ goal: "g", tutorRole: "x".repeat(121) })).toMatchObject({ ok: false, error: "simulation_role_too_long" });
  });
  it("buildSimulationParams uses the reference when given, source none otherwise", () => {
    const v = validateSimulationRequest({ goal: "g", tutorRole: "t", memoryId: "m1" }) as any;
    expect(buildSimulationParams(v, { groupId: "grp", version: 2 }).context)
      .toEqual({ source: "call_memory", callMemoryGroupId: "grp", version: 2 });
    expect(buildSimulationParams(v, null).context).toEqual({ source: "none" });
  });
});

describe("opening turn (contract §3) — engine-initiated, mic gated, no PTT drive", () => {
  it("classifier consumes turn.started with the opening flag", () => {
    expect(classifyEngineEvent({ type: "turn.started", opening: true })).toEqual({ kind: "turnStarted", opening: true });
    expect(classifyEngineEvent({ type: "turn.started" })).toEqual({ kind: "turnStarted", opening: false });
    expect(classifyEngineEvent({ type: "turn.started", opening: "yes" })).toEqual({ kind: "turnStarted", opening: false });
  });
  it("page gates the mic while the opening is pending and never dispatches PTT events from it", () => {
    const m = TUTOR_AVATAR_PAGE_HTML.match(/act\.kind === "turnStarted"\) \{([\s\S]*?)\n    \}/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain("openingPending = true");
    expect(m![1]).not.toContain("dispatch(");
    expect(TUTOR_AVATAR_PAGE_HTML).toContain("micBtn.disabled = openingPending ||");
    expect(TUTOR_AVATAR_PAGE_HTML).toMatch(/if \(openingPending\) \{ showToast\(L\.openingWait\); return; \}/);
  });
  it("the opening gate is released by turn.completed", () => {
    expect(TUTOR_AVATAR_PAGE_HTML).toMatch(/turn\.completed[\s\S]{0,500}openingPending = false/);
  });
  it("OPENING_IN_PROGRESS is treated as benign & retriable — no error state", () => {
    const m = TUTOR_AVATAR_PAGE_HTML.match(/msg\.code === "OPENING_IN_PROGRESS"[\s\S]{0,600}?return;/);
    expect(m).toBeTruthy();
    expect(m![0]).toContain("turnOpen = false");
    expect(m![0]).not.toContain('dispatch("error")');
    // Race recovery: capture stops immediately and a stuck RECORDING moves to
    // PROCESSING so the opening's turn.completed can release the mic.
    expect(m![0]).toContain("stopMic()");
    expect(m![0]).toContain('if (state === "RECORDING") state = "PROCESSING"');
  });
  it("stale socket callbacks are ignored via a connection generation guard", () => {
    expect(TUTOR_AVATAR_PAGE_HTML).toContain("const gen = ++wsGen;");
    expect(TUTOR_AVATAR_PAGE_HTML).toMatch(/sock\.onmessage = \(e\) => \{ if \(gen === wsGen\) onWsMessage\(e\); \}/);
    expect(TUTOR_AVATAR_PAGE_HTML).toMatch(/sock\.onclose = \(e\) => \{ if \(gen !== wsGen\) return;/);
  });
  it("a text-first opening turn still streams into a tutor bubble (delta creates the card)", () => {
    expect(TUTOR_AVATAR_PAGE_HTML).toMatch(/tutor\.text\.delta[\s\S]{0,300}if \(!tutorCard\) tutorCard = addCard\("tutor streaming"\)/);
  });
  it("simulation is a deliberate user choice — practice stays the default flow", () => {
    // Start chooser exists; practice payload path posts no simulation body.
    expect(TUTOR_AVATAR_PAGE_HTML).toContain('id="startSheet"');
    expect(TUTOR_AVATAR_PAGE_HTML).toContain("simulation ? JSON.stringify({ simulation: simulation }) : undefined");
  });
});
