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

// The application identity we present to the engine when creating sessions.
// It comes from the TUTOR_ENGINE_APP_ID secret — never a hardcoded word.
// Read lazily so tests (and late-loaded env) see the current value.
export function getTutorEngineAppId(): string {
  return (process.env.TUTOR_ENGINE_APP_ID || "").trim();
}

// Startup check: warn loudly when the TUTOR_ENGINE_APP_ID secret is missing,
// because session creation will fail if the engine demands an application_id.
// Returns true when configured so callers/tests can assert on it.
export function checkTutorEngineAppIdConfigured(): boolean {
  if (getTutorEngineAppId()) return true;
  console.warn(
    "[TutorEngine] TUTOR_ENGINE_APP_ID is not set — tutor session creation will fail if the engine requires an application_id. Set the TUTOR_ENGINE_APP_ID secret.",
  );
  return false;
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
  return engineFetch("/v1/capabilities");
}

export async function getTutorManifest(): Promise<any> {
  const data = await engineFetch("/v1/tutors");
  const list = Array.isArray(data) ? data : Array.isArray(data?.tutors) ? data.tutors : [];
  const tutor = list.find((t: any) => t?.tutor_id === TUTOR_ID);
  if (!tutor) throw new TutorEngineError(`Tutor ${TUTOR_ID} not found in engine manifest`, 200, "http");
  return tutor;
}

// Create a practice session. The approved contract may or may not require an
// explicit application_id (the key can already be application-bound). We first
// send without it; if the engine rejects the payload asking for the field, we
// retry once including the TUTOR_ENGINE_APP_ID secret value. We never
// fabricate any other identity — if the secret is unset we surface a clear
// not_configured error instead of guessing.
export async function createTutorSession(userId: string): Promise<any> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    scenario_id: SCENARIO_ID,
    tutor_id: TUTOR_ID,
    mode: "practice",
    language: { target: "en", native: "ru" },
  };
  try {
    return await engineFetch("/v1/sessions", { method: "POST", body: payload });
  } catch (err: any) {
    const mentionsAppId =
      err instanceof TutorEngineError &&
      err.kind === "http" &&
      err.status === 400 &&
      (err.body || "").toLowerCase().includes("application_id");
    if (!mentionsAppId) throw err;
    const appId = getTutorEngineAppId();
    if (!appId) {
      throw new TutorEngineError(
        "Tutor Engine requires an application_id but TUTOR_ENGINE_APP_ID is not configured",
        null,
        "not_configured",
      );
    }
    return await engineFetch("/v1/sessions", {
      method: "POST",
      body: { ...payload, application_id: appId },
    });
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

function normalizeMemory(raw: any): EngineCallMemory | null {
  if (!raw || typeof raw !== "object") return null;
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const mem: EngineCallMemory = {
    objective: typeof raw.objective === "string" ? raw.objective : "",
    facts: arr(raw.facts),
    questions: arr(raw.questions),
    rehearsed_answers: arr(raw.rehearsed_answers),
    vocabulary: arr(raw.vocabulary),
    uncertain_facts: arr(raw.uncertain_facts),
  };
  const hasContent =
    mem.objective.trim().length > 0 ||
    mem.facts.length + mem.questions.length + mem.rehearsed_answers.length + mem.vocabulary.length > 0;
  return hasContent ? mem : null;
}

// Fetch the structured Call Memory for a finished session. The engine's exact
// endpoint is not yet published, so we probe the natural candidates and treat
// "none answered with a Call Memory" as capability-unavailable (surfaced as
// integration incomplete) — we NEVER summarize the transcript ourselves.
export async function fetchCallMemory(engineSessionId: string): Promise<EngineCallMemory | null> {
  const candidates = [
    `/v1/sessions/${encodeURIComponent(engineSessionId)}/call-memory`,
    `/v1/sessions/${encodeURIComponent(engineSessionId)}/call_memory`,
  ];
  for (const path of candidates) {
    try {
      const data = await engineFetch(path);
      const mem = normalizeMemory(data?.call_memory ?? data);
      if (mem) return mem;
    } catch (err: any) {
      if (err instanceof TutorEngineError && (err.kind === "auth" || err.kind === "not_configured")) throw err;
      // 404 / HTML / other → try the next candidate
    }
  }
  // Last: the session object itself may carry the memory.
  try {
    const session = await engineFetch(`/v1/sessions/${encodeURIComponent(engineSessionId)}`);
    const mem = normalizeMemory(session?.call_memory);
    if (mem) return mem;
  } catch (err: any) {
    if (err instanceof TutorEngineError && (err.kind === "auth" || err.kind === "not_configured")) throw err;
  }
  return null;
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
    push("session create", !!(session?.session_id && token), `session_id=${session?.session_id ? "present" : "missing"}, realtime.token=${token ? "present" : "missing"}`);
  } catch (err: any) {
    push("session create", false, err?.message ?? String(err));
  }

  return { ok: checks.every((c) => c.ok), checks };
}
