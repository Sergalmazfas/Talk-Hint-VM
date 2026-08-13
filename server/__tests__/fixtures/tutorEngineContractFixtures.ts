// ---------------------------------------------------------------------------
// FROZEN representative payloads of the Tutor Engine PUBLIC contract, as
// consumed by TalkHint.
//
// SOURCE OF TRUTH: Tutor Engine Public Contract v1 (tutor-engine 1.0.0,
// tutor-realtime/1.0) — consumer copy of the published document:
// docs/tutor-engine-public-contract-v1.md; TalkHint consumer notes:
// docs/tutor-engine-consumer-contract.md.
// Fixtures updated FROM the published contract 2026-08-13 — never invent
// shapes here.
// ---------------------------------------------------------------------------

// --- Contract / discovery metadata (contract §"Compatibility rule") ---------
// GET /v1/capabilities (unauthenticated) is the authoritative pre-session
// compatibility handshake. TalkHint pins the MAJOR + realtime protocol.
export const FIXTURE_CONTRACT_META = {
  engine_version: "tutor-engine/0.9.0",
  contract: {
    name: "tutor-engine",
    version: "1.0.0",
    major: 1,
    hash: "d1f639cc8f5d2c86b492d2e76643164f8526cf8f1eb2de96f2d7d5bc0719dfd6",
  },
  realtime: { protocol: "tutor-realtime", version: "1.0", protocol_version: "tutor-realtime/1.0" },
} as const;

// The 20 canonical server→client events of tutor-realtime/1.0 (contract §4.1).
export const CANONICAL_SERVER_EVENTS = [
  "session.ready",
  "turn.started",
  "turn.state",
  "speech.started",
  "speech.partial",
  "speech.final",
  "transcript.raw",
  "transcript.normalized",
  "tutor.text.delta",
  "tutor.text.final",
  "avatar.lipsync",
  "tutor.audio.chunk",
  "tutor.correction",
  "tutor.hint",
  "tutor.suggested_reply",
  "teaching.mode_changed",
  "teaching.preference_changed",
  "turn.completed",
  "error",
  "session.ended",
] as const;

// The 7 canonical client→server messages (contract §4.2).
export const CANONICAL_CLIENT_MESSAGES = [
  "auth",
  "turn.start",
  "audio.chunk",
  "audio.end",
  "playback.started",
  "turn.cancel",
  "session.end",
] as const;

// --- REST -------------------------------------------------------------------

export const FIXTURE_CAPABILITIES = {
  realtime_audio: true,
  avatar: true,
  code_switching: ["ru-en"],
  call_memory: true,
  engine_version: FIXTURE_CONTRACT_META.engine_version,
  contract: FIXTURE_CONTRACT_META.contract,
  realtime: FIXTURE_CONTRACT_META.realtime,
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

// Fail-closed error-code table for POST /sessions (contract §3).
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

// tutor.suggested_reply — suggested USER reply (contract §2/§4.1): the literal
// next phrase the STUDENT may say. Payload: text (string), translation
// (string|null), carryover (boolean). Never reaches TTS.
export const FIXTURE_SUGGESTED_REPLY = {
  type: "tutor.suggested_reply",
  turn_id: "23b9f3bf-ab05-44ef-8844-e7da8a78083b",
  text: "I want to know the status of my case.",
  translation: "Я хочу узнать статус моего дела.",
  carryover: false,
  seq: 20,
};

// tutor.hint — TEACHING hint (contract §2/§4.1): guidance ABOUT the learner's
// language from the lesson pipeline. A DISTINCT stable event — NOT an alias
// of tutor.suggested_reply. Payload: hint (string), mode (string).
export const FIXTURE_TEACHING_HINT = {
  type: "tutor.hint",
  turn_id: "23b9f3bf-ab05-44ef-8844-e7da8a78083b",
  hint: "Try using the past tense: 'I called' instead of 'I call'.",
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
// (verified against contract §4.1). Used to assert TalkHint tolerates the
// full stream and that all names are canonical.
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
