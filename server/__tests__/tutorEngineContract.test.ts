// Task #160 — offline compatibility tests against FROZEN payload fixtures of
// the Tutor Engine public contract (docs/tutor-engine-consumer-contract.md).
//
// Rules under test:
//   - required fields + types of each consumed payload;
//   - classifier routing (the same source the page executes);
//   - the Engine may ADD unknown fields/events without breaking the client;
//   - canonical vs legacy naming: tutor.suggested_reply is canonical, the
//     legacy tutor.hint renders during migration but is marked LEGACY.
import { describe, it, expect, vi, afterEach } from "vitest";

// The offline contract suite must run WITHOUT real credentials: tutorEngine
// captures its API key at import time, so install a dummy key before the
// module is loaded (vi.hoisted runs ahead of hoisted ESM imports). The live
// probe (scripts/tutor-engine-contract-probe.ts) is the only
// credential-dependent check.
vi.hoisted(() => {
  if (!process.env.TUTOR_ENGINE_API_KEY && !process.env.API_KEY) {
    process.env.TUTOR_ENGINE_API_KEY = "offline-contract-test-dummy-key";
  }
});
import { classifyEngineEvent } from "../tutorRealtimeUi";
import {
  normalizeTutorEntry,
  getTutorEngineBase,
  buildSessionPayload,
  SIMULATION_ERROR_CODES,
  getCapabilities,
  completeTutorSession,
  startCallMemoryGeneration,
  fetchCallMemory,
} from "../tutorEngine";
import {
  FIXTURE_CAPABILITIES,
  FIXTURE_SIMULATION_INVALID_422,
  FIXTURE_SESSION_ERROR_CODES,
  FIXTURE_CALL_MEMORY_READY,
  FIXTURE_CALL_MEMORY_STATUSES,
  FIXTURE_TUTOR_CATALOG_ENTRY,
  FIXTURE_SESSION_CREATE_201,
  FIXTURE_SIMULATION_ECHO,
  FIXTURE_SUGGESTED_REPLY,
  FIXTURE_LEGACY_HINT,
  FIXTURE_CORRECTION,
  FIXTURE_TURN_STARTED_OPENING,
  FIXTURE_TURN_STATE_THINKING,
  FIXTURE_TEXT_FINAL,
  FIXTURE_TRANSCRIPT_NORMALIZED,
  FIXTURE_OPENING_IN_PROGRESS_ERROR,
  FIXTURE_OPENING_FLOW_EVENT_TYPES,
} from "./fixtures/tutorEngineContractFixtures";

describe("REST contract fixtures — required fields and types", () => {
  it("GET /v1/capabilities carries the fields TalkHint consumes, with the right types", () => {
    expect(typeof FIXTURE_CAPABILITIES.realtime_audio).toBe("boolean");
    expect(typeof FIXTURE_CAPABILITIES.avatar).toBe("boolean");
    expect(Array.isArray(FIXTURE_CAPABILITIES.code_switching)).toBe(true);
    expect(FIXTURE_CAPABILITIES.code_switching).toContain("ru-en");
    expect(typeof FIXTURE_CAPABILITIES.call_memory).toBe("boolean");
  });
  it("catalog entry has the required fields and normalizes to a client-safe entry", () => {
    const t = FIXTURE_TUTOR_CATALOG_ENTRY;
    expect(typeof t.tutor_id).toBe("string");
    expect(typeof t.display_name).toBe("string");
    expect(typeof t.avatar.glb_url).toBe("string");
    expect(["string", "number"]).toContain(typeof t.asset_version);
    const n = normalizeTutorEntry(t)!;
    expect(n).toMatchObject({ tutorId: "emma_us_01", name: "Emma", assetVersion: "1", body: "F" });
    expect(n.glbUrl).toBe(getTutorEngineBase() + t.avatar.glb_url);
  });
  it("session create 201 carries session_id + realtime credentials", () => {
    expect(typeof FIXTURE_SESSION_CREATE_201.session_id).toBe("string");
    expect(typeof FIXTURE_SESSION_CREATE_201.realtime.connection_url).toBe("string");
    expect(typeof FIXTURE_SESSION_CREATE_201.realtime.token).toBe("string");
  });
  it("simulation echo mirrors goal, roles and context source", () => {
    expect(typeof FIXTURE_SIMULATION_ECHO.goal).toBe("string");
    expect(typeof FIXTURE_SIMULATION_ECHO.roles.learner).toBe("string");
    expect(typeof FIXTURE_SIMULATION_ECHO.roles.tutor).toBe("string");
    expect(FIXTURE_SIMULATION_ECHO.context.source).toBe("none");
  });
});

describe("session request payloads — the exact wire shapes TalkHint sends", () => {
  it("practice payload is flat and NEVER carries a simulation field", () => {
    const p: any = buildSessionPayload("u1");
    expect(p.mode).toBe("practice");
    expect(p.target_language).toBe("en");
    expect(p.native_language).toBe("ru");
    expect(p.simulation).toBeUndefined();
    expect(p.language).toBeUndefined();
    expect(p.application_id).toBeUndefined(); // tenancy from API key only
    expect(p.organization_id).toBeUndefined();
  });
  it("simulation payload nests language + simulation with roles object and by-reference context", () => {
    const p: any = buildSessionPayload("u1", {
      goal: "g", learnerRole: "caller", tutorRole: "lawyer",
      context: { source: "call_memory", callMemoryGroupId: "grp-1", version: 2 },
    });
    expect(p.mode).toBe("simulation");
    expect(p.language).toEqual({ target: "en", native: "ru" });
    expect(p.target_language).toBeUndefined();
    expect(p.simulation).toEqual({
      goal: "g",
      roles: { learner: "caller", tutor: "lawyer" },
      context: { source: "call_memory", call_memory_group_id: "grp-1", version: 2 },
    });
  });
  it("fail-closed error-code table matches the client's known simulation error codes", () => {
    for (const code of FIXTURE_SESSION_ERROR_CODES) {
      if (code.startsWith("SIMULATION")) expect(SIMULATION_ERROR_CODES).toContain(code);
    }
    expect(FIXTURE_SIMULATION_INVALID_422.error.code).toBe("SIMULATION_INVALID");
    expect(typeof FIXTURE_SIMULATION_INVALID_422.error.message).toBe("string");
  });
});

describe("mocked client wire behavior — the real client against frozen responses", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks(); });

  function stubFetch(status: number, body: unknown) {
    const spy = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    global.fetch = spy as any;
    return spy;
  }

  it("getCapabilities hits GET /api/v1/capabilities with Bearer auth and returns the consumed fields", async () => {
    const spy = stubFetch(200, FIXTURE_CAPABILITIES);
    const caps = await getCapabilities();
    expect(caps).toEqual(FIXTURE_CAPABILITIES);
    const [url, init] = spy.mock.calls[0] as any;
    expect(String(url)).toBe(`${getTutorEngineBase()}/api/v1/capabilities`);
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toMatch(/^Bearer .+/);
  });

  it("completeTutorSession POSTs to the documented completion endpoint", async () => {
    const spy = stubFetch(200, { ok: true });
    await completeTutorSession("sess-1");
    const [url, init] = spy.mock.calls[0] as any;
    expect(String(url)).toBe(`${getTutorEngineBase()}/api/v1/sessions/sess-1/complete`);
    expect(init.method).toBe("POST");
  });

  it("startCallMemoryGeneration maps 409 NO_COMPLETED_TURNS to noTurns (not an error)", async () => {
    stubFetch(409, { error: { code: "NO_COMPLETED_TURNS" } });
    await expect(startCallMemoryGeneration("sess-1")).resolves.toEqual({ started: false, noTurns: true });
  });

  it("startCallMemoryGeneration treats 409 ALREADY/IN_PROGRESS as generation-exists → poll", async () => {
    stubFetch(409, { error: { code: "ALREADY_GENERATED" } });
    await expect(startCallMemoryGeneration("sess-1")).resolves.toEqual({ started: true, noTurns: false });
  });

  it("fetchCallMemory: ready — the frozen fixture flows end-to-end through normalization (objective included)", async () => {
    stubFetch(200, FIXTURE_CALL_MEMORY_READY);
    const r = await fetchCallMemory("sess-1");
    expect(r.status).toBe("ready");
    if (r.status === "ready") {
      expect(r.groupId).toBe(FIXTURE_CALL_MEMORY_READY.call_memory_group_id);
      expect(r.version).toBe(FIXTURE_CALL_MEMORY_READY.latest.version);
      expect(r.memory).not.toBeNull();
      expect(r.memory!.objective).toBe("Reschedule the clinic appointment");
      expect(r.memory!.facts).toContain("Appointment was on Friday at 10am");
      expect(r.memory!.questions).toContain("Is Dr. Smith available next week?");
      expect(r.memory!.vocabulary).toContain("appointment — приём");
    }
  });

  it("fetchCallMemory: pending / failed / not_started statuses", async () => {
    stubFetch(200, { status: "pending" });
    await expect(fetchCallMemory("s")).resolves.toEqual({ status: "pending" });
    stubFetch(200, { status: "failed", retriable: false });
    await expect(fetchCallMemory("s")).resolves.toEqual({ status: "failed", retriable: false });
    stubFetch(404, { error: { code: "CALL_MEMORY_NOT_GENERATED" } });
    await expect(fetchCallMemory("s")).resolves.toEqual({ status: "not_started" });
  });
});

describe("call-memory contract fixtures", () => {
  it("ready response carries status, group id and categorized content", () => {
    expect(FIXTURE_CALL_MEMORY_STATUSES).toContain(FIXTURE_CALL_MEMORY_READY.status);
    expect(typeof FIXTURE_CALL_MEMORY_READY.call_memory_group_id).toBe("string");
    expect(typeof FIXTURE_CALL_MEMORY_READY.latest.version).toBe("number");
    const c = FIXTURE_CALL_MEMORY_READY.latest.content as Record<string, unknown>;
    for (const cat of ["objective", "facts", "dates_times", "questions", "rehearsed_answers", "vocabulary", "uncertain_facts"]) {
      expect(Array.isArray(c[cat])).toBe(true);
    }
  });
  it("every documented status literal is frozen", () => {
    expect([...FIXTURE_CALL_MEMORY_STATUSES]).toEqual(["pending", "ready", "failed"]);
  });
});

describe("canonical realtime events — classifier routing on frozen payloads", () => {
  it("tutor.suggested_reply (CANONICAL) → hint action with required text + translation", () => {
    expect(typeof FIXTURE_SUGGESTED_REPLY.text).toBe("string");
    expect(typeof FIXTURE_SUGGESTED_REPLY.translation).toBe("string");
    expect(classifyEngineEvent(FIXTURE_SUGGESTED_REPLY)).toEqual({
      kind: "hint",
      text: FIXTURE_SUGGESTED_REPLY.text,
      translation: FIXTURE_SUGGESTED_REPLY.translation,
    });
  });
  it("tutor.correction → correction action with the required 'better' field", () => {
    expect(typeof FIXTURE_CORRECTION.correction.better).toBe("string");
    expect(classifyEngineEvent(FIXTURE_CORRECTION)).toMatchObject({ kind: "correction", better: FIXTURE_CORRECTION.correction.better });
  });
  it("turn.started opening:true → mic-gating action (boolean semantics)", () => {
    expect(classifyEngineEvent(FIXTURE_TURN_STARTED_OPENING)).toEqual({ kind: "turnStarted", opening: true });
    // opening must be a strict boolean — a truthy string is NOT an opening turn
    expect(classifyEngineEvent({ type: "turn.started", opening: "yes" })).toEqual({ kind: "turnStarted", opening: false });
  });
  it("turn.state / tutor.text.final / transcript.normalized route with required string fields", () => {
    expect(classifyEngineEvent(FIXTURE_TURN_STATE_THINKING)).toEqual({ kind: "turnState", state: "thinking" });
    expect(classifyEngineEvent(FIXTURE_TEXT_FINAL)).toEqual({ kind: "finalText", text: FIXTURE_TEXT_FINAL.text });
    expect(classifyEngineEvent(FIXTURE_TRANSCRIPT_NORMALIZED)).toEqual({ kind: "normalized", text: FIXTURE_TRANSCRIPT_NORMALIZED.text });
  });
  it("every canonical event type of the opening flow is either consumed or safely ignored", () => {
    for (const type of FIXTURE_OPENING_FLOW_EVENT_TYPES) {
      // Must never throw — consumed types produce an action, the rest null.
      expect(() => classifyEngineEvent({ type })).not.toThrow();
    }
  });
  it("OPENING_IN_PROGRESS error fixture keeps its required code field", () => {
    expect(FIXTURE_OPENING_IN_PROGRESS_ERROR).toEqual({ type: "error", code: "OPENING_IN_PROGRESS" });
  });
});

describe("forward compatibility — additions never break the client", () => {
  it("unknown ADDED fields on a known event do not change routing", () => {
    const withExtras = { ...FIXTURE_SUGGESTED_REPLY, confidence: 0.93, experimental: { a: 1 }, tags: ["x"] };
    expect(classifyEngineEvent(withExtras)).toEqual(classifyEngineEvent(FIXTURE_SUGGESTED_REPLY));
  });
  it("unknown FUTURE event types are ignored, never fatal", () => {
    expect(classifyEngineEvent({ type: "tutor.emotion", value: "happy" })).toBeNull();
    expect(classifyEngineEvent({ type: "session.metrics.v2", data: {} })).toBeNull();
  });
});

describe("canonical vs legacy — tutor.hint is LEGACY / COMPATIBILITY ONLY", () => {
  it("the legacy alias still renders during the migration window", () => {
    expect(classifyEngineEvent(FIXTURE_LEGACY_HINT)).toEqual({
      kind: "hint",
      text: FIXTURE_LEGACY_HINT.hint,
      translation: null,
    });
  });
  it("field validation is name-specific — no silent cross-shape acceptance", () => {
    // Canonical event with only the legacy field is malformed → rejected:
    expect(classifyEngineEvent({ type: "tutor.suggested_reply", hint: "text via legacy field" })).toBeNull();
    // Legacy event with only the canonical field is malformed → rejected:
    expect(classifyEngineEvent({ type: "tutor.hint", text: "text via canonical field" })).toBeNull();
    // Legacy event never yields a translation (its documented shape is {hint} only):
    expect(classifyEngineEvent({ type: "tutor.hint", hint: "h", translation: "т" })).toEqual({ kind: "hint", text: "h", translation: null });
  });
});
