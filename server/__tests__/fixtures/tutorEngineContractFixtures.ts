// ---------------------------------------------------------------------------
// FROZEN representative payloads of the Tutor Engine PUBLIC contract, as
// consumed by TalkHint. Captured live from the production Engine 2026-08-13.
//
// SOURCE OF TRUTH: the Engine's published contract. These fixtures are a
// consumer copy for compatibility tests (docs/tutor-engine-consumer-contract.md).
// Update them FROM the Engine contract — never invent shapes here.
// ---------------------------------------------------------------------------

// --- REST -------------------------------------------------------------------

export const FIXTURE_CAPABILITIES = {
  realtime_audio: true,
  avatar: true,
  code_switching: ["ru-en"],
  call_memory: true,
};

export const FIXTURE_TUTOR_CATALOG_ENTRY = {
  tutor_id: "emma_us_01",
  display_name: "Emma",
  description: "Warm and supportive American English tutor.",
  preview_url: "/api/tutor-assets/previews/emma_us_01.png",
  avatar: { glb_url: "/api/tutor-assets/avatars/brunette_female_01.glb", body: "F" },
  asset_version: "1",
};

export const FIXTURE_SESSION_CREATE_201 = {
  session_id: "83c2fc86-467c-434a-b6da-eb5c89083cac",
  realtime: { connection_url: "/api/v1/realtime", token: "REDACTED_SHORT_LIVED" },
};

export const FIXTURE_SIMULATION_ECHO = {
  goal: "Call my lawyer to ask about my case",
  roles: { learner: "caller", tutor: "lawyer" },
  context: { source: "none" },
};

export const FIXTURE_SIMULATION_INVALID_422 = {
  error: { code: "SIMULATION_INVALID", message: "simulation.roles.learner is required and must be a non-empty string" },
};

// Fail-closed error-code table for POST /sessions (contract doc §sessions).
export const FIXTURE_SESSION_ERROR_CODES = [
  "SIMULATION_NOT_ALLOWED_FOR_MODE",
  "SIMULATION_REQUIRED",
  "SIMULATION_INVALID",
  "CALL_MEMORY_DISABLED",
  "CALL_MEMORY_NOT_FOUND",
  "CALL_MEMORY_NOT_CONFIRMED",
] as const;

// GET /sessions/:id/call-memory when generation is READY.
export const FIXTURE_CALL_MEMORY_READY = {
  status: "ready",
  call_memory_group_id: "3f6a1a20-0000-4000-8000-00000000cafe",
  latest: {
    version: 1,
    content: {
      objective: [{ text: "Reschedule the clinic appointment" }],
      facts: [{ text: "Appointment was on Friday at 10am" }],
      dates_times: [],
      questions: [{ text: "Is Dr. Smith available next week?" }],
      rehearsed_answers: [],
      vocabulary: [{ text: "appointment — приём" }],
      uncertain_facts: [],
    },
  },
};

export const FIXTURE_CALL_MEMORY_STATUSES = ["pending", "ready", "failed"] as const;

// --- Realtime events (tutor-realtime/1.0) -----------------------------------

// CANONICAL hint event — a suggested USER reply. Captured live 2026-08-13
// (simulation session). translation is required for ru-en sessions.
export const FIXTURE_SUGGESTED_REPLY = {
  type: "tutor.suggested_reply",
  turn_id: "23b9f3bf-ab05-44ef-8844-e7da8a78083b",
  text: "I want to know the status of my case.",
  translation: "Я хочу узнать статус моего дела.",
  carryover: false,
  seq: 20,
};

// LEGACY / COMPATIBILITY ONLY — the Engine's previous hint event name.
// Renders during the migration window; must NOT satisfy canonical tests.
export const FIXTURE_LEGACY_HINT = {
  type: "tutor.hint",
  hint: "Could you please help me with my documents?",
  mode: "assisted",
};

export const FIXTURE_CORRECTION = {
  type: "tutor.correction",
  mode: "teacher",
  correction: {
    user_said: "I want ask my lawyer.",
    better: "I want to ask my lawyer.",
    explanation: "После 'want' используется 'to + глагол'.",
    translation: "Я хочу спросить своего юриста.",
    category: "grammar",
  },
};

export const FIXTURE_TURN_STARTED_OPENING = { type: "turn.started", opening: true };
export const FIXTURE_TURN_STATE_THINKING = { type: "turn.state", state: "THINKING" };
export const FIXTURE_TEXT_FINAL = { type: "tutor.text.final", text: "Hi there! How's it going?" };
export const FIXTURE_TRANSCRIPT_NORMALIZED = {
  type: "transcript.normalized",
  turn_id: "9f0f2a34-0000-4000-8000-000000000001",
  text: "I would like to check my case status.",
};
export const FIXTURE_OPENING_IN_PROGRESS_ERROR = { type: "error", code: "OPENING_IN_PROGRESS" };

// The realtime event flow of a simulation opening turn, in observed order
// (captured live 2026-08-13). Used to assert TalkHint tolerates the full
// stream and that all canonical names are present in the frozen contract.
export const FIXTURE_OPENING_FLOW_EVENT_TYPES = [
  "session.ready",
  "turn.started",
  "turn.state",
  "tutor.text.delta",
  "turn.state",
  "avatar.lipsync",
  "tutor.audio.chunk",
  "turn.state",
  "tutor.suggested_reply",
  "tutor.text.final",
  "turn.completed",
] as const;
