// ---------------------------------------------------------------------------
// Tutor Engine client — TalkHint is an API CLIENT of the external AI Tutor
// Engine. All engine calls carry the backend-only API key and run server-side;
// the iOS/web client only ever receives client-safe data (asset URLs, session
// id, short-lived realtime token). No STT/LLM/TTS/teaching logic lives here.
// ---------------------------------------------------------------------------

const TUTOR_ENGINE_BASE = (process.env.TUTOR_ENGINE_BASE || "https://ai-tutor-engine.replit.app").replace(/\/+$/, "");
// Preferred secret name is TUTOR_ENGINE_API_KEY; API_KEY is accepted as a
// fallback because the key was initially saved under that generic name.
const TUTOR_ENGINE_API_KEY = process.env.TUTOR_ENGINE_API_KEY || process.env.API_KEY || "";
const TUTOR_ID = process.env.TUTOR_ENGINE_TUTOR_ID || "emma_us_01";
const SCENARIO_ID = process.env.TUTOR_ENGINE_SCENARIO_ID || "english_free_talk";

if (!process.env.TUTOR_ENGINE_API_KEY && process.env.API_KEY) {
  console.warn("[TutorEngine] Using API_KEY secret as the engine key — please rename it to TUTOR_ENGINE_API_KEY.");
}

export function tutorEngineConfigured(): boolean {
  return !!TUTOR_ENGINE_API_KEY;
}

// VERIFIED production contract (2026-08-10): the REST namespace is /api/v1 and
// tenancy is derived EXCLUSIVELY from the API key. The engine explicitly
// rejects application_id/organization_id in requests ("are not accepted;
// tenancy is derived from the API key"), so TUTOR_ENGINE_APP_ID is kept only
// as stored reference and MUST NOT be sent.
const API_PREFIX = "/api/v1";

export function getTutorEngineAppId(): string {
  return (process.env.TUTOR_ENGINE_APP_ID || "").trim();
}

// Kept for reference/tests: the app id secret may exist but is never sent.
export function checkTutorEngineAppIdConfigured(): boolean {
  return !!getTutorEngineAppId();
}

export function getTutorEngineBase(): string {
  return TUTOR_ENGINE_BASE;
}

export function getTutorId(): string {
  return TUTOR_ID;
}

export class TutorEngineError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public kind: "auth" | "not_json" | "http" | "network" | "not_configured",
    public body?: string,
  ) {
    super(message);
  }
}

// Fetch an engine endpoint with the backend key. The engine's production URL
// currently falls back to serving its old SPA (HTML) for unknown paths — that
// means "engine not republished yet", which we surface distinctly so the
// operator knows the fix is on the engine side, not ours.
async function engineFetch(path: string, init?: { method?: string; body?: unknown }): Promise<any> {
  if (!TUTOR_ENGINE_API_KEY) {
    throw new TutorEngineError("Tutor Engine API key is not configured (TUTOR_ENGINE_API_KEY)", null, "not_configured");
  }
  const url = `${TUTOR_ENGINE_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method || "GET",
      headers: {
        Authorization: `Bearer ${TUTOR_ENGINE_API_KEY}`,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err: any) {
    throw new TutorEngineError(`Tutor Engine unreachable: ${err?.message ?? err}`, null, "network");
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    // Full details go to the backend log ONLY; callers show a safe message.
    console.error(`[TutorEngine] AUTH ${res.status} on ${path}: ${text.slice(0, 500)}`);
    throw new TutorEngineError("Tutor Engine authorization failed", res.status, "auth", text.slice(0, 500));
  }
  if (!res.ok) {
    console.error(`[TutorEngine] HTTP ${res.status} on ${path}: ${text.slice(0, 500)}`);
    throw new TutorEngineError(`Tutor Engine error ${res.status}`, res.status, "http", text.slice(0, 500));
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("<")) {
    throw new TutorEngineError(
      `Tutor Engine returned HTML for ${path} — the engine's /v1 API is not deployed at ${TUTOR_ENGINE_BASE} (engine likely needs Republish)`,
      res.status,
      "not_json",
      trimmed.slice(0, 200),
    );
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new TutorEngineError(`Tutor Engine returned non-JSON for ${path}`, res.status, "not_json", trimmed.slice(0, 200));
  }
}

export interface TutorCapabilities {
  realtime_audio?: boolean;
  avatar?: boolean;
  code_switching?: string[];
  call_memory?: boolean;
  [k: string]: unknown;
}

export async function getCapabilities(): Promise<TutorCapabilities> {
  return engineFetch(`${API_PREFIX}/capabilities`);
}

// Raw tutor catalog from the engine — the DYNAMIC source of truth for tutor
// availability (allow-list driven; ids must never be hardcoded client-side).
export async function getTutorCatalog(): Promise<any[]> {
  const data = await engineFetch(`${API_PREFIX}/tutors`);
  return Array.isArray(data) ? data : Array.isArray(data?.tutors) ? data.tutors : [];
}

// Client-safe normalized catalog entry (no engine internals leak through).
export interface TutorCatalogEntry {
  tutorId: string;
  name: string;
  description: string | null;
  previewUrl: string | null;
  glbUrl: string | null;
  body: string | null;
  assetVersion: string | null;
}

// Asset URLs may arrive as absolute-path ("/api/tutor-assets/…") or fully
// qualified — normalize to a full URL against the engine base.
function absoluteAssetUrl(u: unknown): string | null {
  if (typeof u !== "string" || !u) return null;
  return u.startsWith("/") ? `${TUTOR_ENGINE_BASE}${u}` : u;
}

export function normalizeTutorEntry(t: any): TutorCatalogEntry | null {
  if (!t || typeof t.tutor_id !== "string" || !t.tutor_id) return null;
  return {
    tutorId: t.tutor_id,
    name: t.display_name ?? t.name ?? t.tutor_id,
    description: typeof t.description === "string" ? t.description : null,
    previewUrl: absoluteAssetUrl(t.preview_url ?? t.avatar?.preview_url),
    glbUrl: absoluteAssetUrl(t.avatar?.glb_url ?? t.glb_url),
    body: t.avatar?.body ?? null,
    assetVersion: t.asset_version != null ? String(t.asset_version) : t.avatar?.asset_version != null ? String(t.avatar.asset_version) : null,
  };
}

export async function getTutorManifest(tutorId?: string): Promise<any> {
  const id = tutorId || TUTOR_ID;
  const list = await getTutorCatalog();
  const tutor = list.find((t: any) => t?.tutor_id === id);
  if (!tutor) throw new TutorEngineError(`Tutor ${id} not found in engine manifest`, 200, "http");
  return tutor;
}

// --- Goal-Driven Simulation (Engine contract v1, 2026-08-13) ----------------
// Simulation sessions carry a `simulation` block and mode:"simulation". The
// contract is fail-closed: a simulation create that fails is surfaced to the
// user — TalkHint NEVER silently falls back to a practice session.
export interface TutorSimulationParams {
  goal: string; // literal user-entered goal text, ≤500 chars — no keywords/slots/flags
  learnerRole: string; // ≤120 chars
  tutorRole: string; // ≤120 chars — who Emma plays from turn 0
  context:
    | { source: "none" }
    | { source: "call_memory"; callMemoryGroupId: string; version: number };
}

// Exported for tests: exact payload shapes for both modes. The practice
// payload keeps the VERIFIED production schema and must NEVER carry a
// `simulation` field (engine hard-422s it for non-simulation modes). The
// simulation payload follows the contract doc exactly (language object).
export function buildSessionPayload(userId: string, sim?: TutorSimulationParams, tutorId?: string): Record<string, unknown> {
  // Only the selected tutor_id is sent — avatar/voice/persona internals are
  // frozen by the engine at creation and must never be passed by the client.
  const tid = tutorId || TUTOR_ID;
  if (!sim) {
    return {
      user_id: userId,
      scenario_id: SCENARIO_ID,
      tutor_id: tid,
      mode: "practice",
      target_language: "en",
      native_language: "ru",
    };
  }
  return {
    user_id: userId,
    scenario_id: SCENARIO_ID,
    tutor_id: tid,
    mode: "simulation",
    language: { target: "en", native: "ru" },
    simulation: {
      goal: sim.goal,
      roles: { learner: sim.learnerRole, tutor: sim.tutorRole },
      context:
        sim.context.source === "call_memory"
          ? { source: "call_memory", call_memory_group_id: sim.context.callMemoryGroupId, version: sim.context.version }
          : { source: "none" },
    },
  };
}

// Simulation-create error codes from the engine contract (fail-closed table).
export const SIMULATION_ERROR_CODES = [
  "SIMULATION_NOT_ALLOWED_FOR_MODE",
  "SIMULATION_REQUIRED",
  "SIMULATION_INVALID",
  "CALL_MEMORY_DISABLED",
  "CALL_MEMORY_NOT_FOUND",
  "CALL_MEMORY_NOT_CONFIRMED",
] as const;
export type SimulationErrorCode = (typeof SIMULATION_ERROR_CODES)[number];

export function simulationErrorCode(err: unknown): SimulationErrorCode | null {
  if (!(err instanceof TutorEngineError) || !err.body) return null;
  return SIMULATION_ERROR_CODES.find((c) => err.body!.includes(c)) ?? null;
}

// Create a practice session with the VERIFIED production schema, or — when
// `sim` is provided — a goal-driven simulation session (contract v1). Tenancy
// is derived from the API key — application_id/organization_id are rejected
// by the engine and must never be sent. POST /sessions is non-idempotent:
// never auto-retry on timeout (contract §1).
export async function createTutorSession(userId: string, sim?: TutorSimulationParams, tutorId?: string): Promise<any> {
  return engineFetch(`${API_PREFIX}/sessions`, { method: "POST", body: buildSessionPayload(userId, sim, tutorId) });
}

// Complete a practice session — the ONLY documented completion endpoint.
export async function completeTutorSession(engineSessionId: string): Promise<any> {
  return engineFetch(`${API_PREFIX}/sessions/${encodeURIComponent(engineSessionId)}/complete`, { method: "POST" });
}

// Explicitly start Call Memory generation (POST); GET never triggers it.
// 409 NO_COMPLETED_TURNS means the practice had no finished turns — surfaced
// as "no memory available", not an internal error.
export async function startCallMemoryGeneration(
  engineSessionId: string,
): Promise<{ started: boolean; noTurns: boolean }> {
  try {
    await engineFetch(`${API_PREFIX}/sessions/${encodeURIComponent(engineSessionId)}/call-memory`, { method: "POST" });
    return { started: true, noTurns: false };
  } catch (err: any) {
    if (err instanceof TutorEngineError && err.status === 409) {
      const body = err.body || "";
      if (body.includes("NO_COMPLETED_TURNS")) return { started: false, noTurns: true };
      // "already generating/generated" conflicts mean generation exists → poll.
      if (/ALREADY|IN_PROGRESS|EXISTS/i.test(body)) return { started: true, noTurns: false };
      throw err; // unrelated conflict — surface, don't pretend it started
    }
    throw err;
  }
}

export interface EngineCallMemory {
  objective: string;
  facts: string[];
  questions: string[];
  rehearsed_answers: string[];
  vocabulary: string[];
  uncertain_facts: string[];
}

// Engine content items are objects like {id, text, status, provenance}; older
// shapes may be plain strings. Normalize both to plain strings.
// NOTE on item status: engine drafts mark EVERY item "unconfirmed" — that
// means "awaiting user confirmation in TalkHint", which our mandatory
// review/edit/confirm step provides for the memory as a whole. Genuinely
// dubious content arrives in the separate uncertain_facts category, which we
// keep separate and render as "never assert" in the live-hint block.
function itemTexts(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any) => (typeof x === "string" ? x : typeof x?.text === "string" ? x.text : ""))
    .filter((s) => s.trim().length > 0);
}

function normalizeMemory(raw: any): EngineCallMemory | null {
  if (!raw || typeof raw !== "object") return null;
  const mem: EngineCallMemory = {
    // objective arrives either as a plain string or as an item array like the
    // other categories — accept both (consumer contract doc, call-memory §).
    objective: typeof raw.objective === "string" ? raw.objective : itemTexts(raw.objective).join(" "),
    // dates_times are facts for the purposes of the live-hint context.
    facts: [...itemTexts(raw.facts), ...itemTexts(raw.dates_times)],
    questions: itemTexts(raw.questions),
    rehearsed_answers: itemTexts(raw.rehearsed_answers),
    vocabulary: itemTexts(raw.vocabulary),
    uncertain_facts: itemTexts(raw.uncertain_facts),
  };
  const hasContent =
    mem.objective.trim().length > 0 ||
    mem.facts.length + mem.questions.length + mem.rehearsed_answers.length + mem.vocabulary.length > 0;
  return hasContent ? mem : null;
}

export type CallMemoryPoll =
  | { status: "pending" }
  | { status: "ready"; memory: EngineCallMemory | null; groupId: string | null; version: number | null }
  | { status: "failed"; retriable: boolean }
  | { status: "not_started" };

// Fetch the Call Memory state for a completed session (documented endpoint:
// GET /api/v1/sessions/:id/call-memory). GET is read-only — generation is
// started separately via startCallMemoryGeneration(). We NEVER summarize the
// transcript ourselves.
export async function fetchCallMemory(engineSessionId: string): Promise<CallMemoryPoll> {
  let data: any;
  try {
    data = await engineFetch(`${API_PREFIX}/sessions/${encodeURIComponent(engineSessionId)}/call-memory`);
  } catch (err: any) {
    if (err instanceof TutorEngineError && err.status === 404 && (err.body || "").includes("CALL_MEMORY_NOT_GENERATED")) {
      return { status: "not_started" };
    }
    throw err;
  }
  const status = data?.status;
  if (status === "pending") return { status: "pending" };
  if (status === "failed") return { status: "failed", retriable: data?.retriable !== false };
  if (status === "ready") {
    // Capture the engine-side reference (group id + version) when present —
    // it is the ONLY way to seed a goal-driven simulation with this memory
    // (contract v1: context by reference, never inline facts).
    const groupId =
      typeof data?.group_id === "string" ? data.group_id
      : typeof data?.call_memory_group_id === "string" ? data.call_memory_group_id
      : typeof data?.latest?.group_id === "string" ? data.latest.group_id
      : null;
    const versionRaw = data?.latest?.version ?? data?.version;
    const version = typeof versionRaw === "number" && Number.isFinite(versionRaw) ? versionRaw : null;
    return { status: "ready", memory: normalizeMemory(data?.latest?.content ?? data?.content), groupId, version };
  }
  return { status: "pending" };
}

export interface SmokeCheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

// Mandatory integration smoke checks (results shown to the operator).
export async function runTutorSmokeChecks(userId: string): Promise<{ ok: boolean; checks: SmokeCheckResult[] }> {
  const checks: SmokeCheckResult[] = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  let caps: TutorCapabilities | null = null;
  try {
    caps = await getCapabilities();
    const cs = Array.isArray(caps.code_switching) ? caps.code_switching : [];
    push("capabilities", true, `200 OK: realtime_audio=${caps.realtime_audio}, avatar=${caps.avatar}, code_switching=${JSON.stringify(cs)}, call_memory=${caps.call_memory}`);
    push("capability realtime_audio", caps.realtime_audio === true, String(caps.realtime_audio));
    push("capability avatar", caps.avatar === true, String(caps.avatar));
    push("capability code_switching ru-en", cs.includes("ru-en"), JSON.stringify(cs));
    push("capability call_memory", caps.call_memory === true, String(caps.call_memory));
  } catch (err: any) {
    push("capabilities", false, err?.message ?? String(err));
  }

  let manifest: any = null;
  try {
    manifest = await getTutorManifest();
    push("tutor manifest", manifest?.manifest_version === 2 || manifest?.manifest_version >= 2,
      `tutor_id=${manifest?.tutor_id}, manifest_version=${manifest?.manifest_version}`);
  } catch (err: any) {
    push("tutor manifest", false, err?.message ?? String(err));
  }

  if (manifest?.avatar?.glb_url) {
    try {
      const res = await fetch(manifest.avatar.glb_url, { headers: { Range: "bytes=0-3" } });
      const buf = Buffer.from(await res.arrayBuffer());
      const magic = buf.subarray(0, 4).toString("latin1");
      const type = res.headers.get("content-type") || "";
      // ~4.5 MB is a diagnostic reference, not a hard size contract.
      push("avatar GLB", res.ok && magic === "glTF", `status=${res.status}, content-type=${type}, magic=${JSON.stringify(magic)}`);
    } catch (err: any) {
      push("avatar GLB", false, err?.message ?? String(err));
    }
  } else {
    push("avatar GLB", false, "no avatar.glb_url in manifest");
  }

  try {
    const session = await createTutorSession(userId);
    const token = session?.realtime?.token;
    const connUrl = session?.realtime?.connection_url;
    push(
      "session create",
      !!(session?.session_id && token && connUrl),
      `session_id=${session?.session_id ? "present" : "missing"}, realtime.token=${token ? "present" : "missing"}, connection_url=${connUrl ?? "missing"}`,
    );
    // Clean up: complete the throwaway smoke session right away.
    if (session?.session_id) {
      try { await completeTutorSession(session.session_id); } catch { /* best effort */ }
    }
  } catch (err: any) {
    push("session create", false, err?.message ?? String(err));
  }

  return { ok: checks.every((c) => c.ok), checks };
}
