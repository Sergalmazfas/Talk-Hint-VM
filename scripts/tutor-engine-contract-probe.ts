// ---------------------------------------------------------------------------
// LIVE Tutor Engine contract probe (aligned to Tutor Engine Public Contract
// v1 — tutor-engine 1.0.0, tutor-realtime/1.0; consumer copy:
// docs/tutor-engine-public-contract-v1.md).
//
// Run manually (REQUIRED pre-publish check for TalkHint):
//   npm run test:tutor-engine-contract
//
// Verifies PROTOCOL COMPATIBILITY ONLY against the real Engine:
//   - GET /v1/capabilities consumed fields;
//   - GET /v1/tutors catalog shape;
//   - practice session create (exact HTTP 201 + shape) + VERIFIED completion;
//   - Call Memory endpoints (Task #161): GET pre-generation → 404
//     CALL_MEMORY_NOT_GENERATED, POST → 409 NO_COMPLETED_TURNS on a turn-less
//     probe session; if generation exists anyway, bounded GET poll validates
//     the pending|ready|failed status enum, content categories, and reports
//     the observed group_id/version field names (still unconfirmed — see
//     docs/tutor-goal-contract-open-question.md);
//   - simulation source:none — exact 201, echo, tutor-first opening turn
//     (turn.started opening:true), tutor text, first CANONICAL
//     tutor.suggested_reply with translation, turn.completed.
//
// It NEVER checks teaching quality or exact wording — a model or phrasing
// change must not fail this probe; a renamed event or changed field type must.
//
// VERSION REPORTING: the probe reads the Engine's own contract metadata from
// GET /v1/capabilities (the authoritative pre-session compatibility handshake
// per contract §1) and reports exactly which Engine contract/protocol version
// it validated against. A missing/major-incompatible version is a failure.
//
// tutor.hint vs tutor.suggested_reply (contract §2): TWO DISTINCT stable
// events — tutor.hint {hint, mode} is a teaching hint; tutor.suggested_reply
// {text, translation, carryover} is the suggested USER reply. Neither is an
// alias: a tutor.hint frame never satisfies the suggested-reply expectation.
//
// The probe talks to the Engine DIRECTLY (own fetch with AbortController):
// every network phase is bounded, HTTP status codes are asserted exactly,
// and cleanup failures are contract failures — nothing can hang or silently
// pass. Session payloads come from the same buildSessionPayload the app uses,
// so the wire payload under test is byte-identical to production.
//
// Source of truth: the Engine's published contract; consumer copy in
// docs/tutor-engine-consumer-contract.md.
// ---------------------------------------------------------------------------
import WebSocket from "ws";
import { buildSessionPayload, getTutorEngineBase, type TutorSimulationParams } from "../server/tutorEngine";

// What THIS probe was written against (the published contract document).
const EXPECTED_CONTRACT = { name: "tutor-engine", major: 1, realtimeProtocol: "tutor-realtime/1.0" } as const;
const CONSUMER_SNAPSHOT = "docs/tutor-engine-public-contract-v1.md (tutor-engine 1.0.0, tutor-realtime/1.0, snapshot 2026-08-13)";
// Filled at runtime from GET /v1/capabilities — reported in the final output.
let engineReportedVersion = "UNKNOWN (capabilities did not report contract metadata)";
const API_KEY = process.env.TUTOR_ENGINE_API_KEY || process.env.API_KEY || "";
const BASE = getTutorEngineBase();
const HTTP_TIMEOUT_MS = 20_000;
const OPENING_TIMEOUT_MS = 60_000;
const PROBE_USER = "contract-probe";

// --- mismatch collector ------------------------------------------------------
const missing: string[] = [];
const renamed: string[] = [];
const typeMismatch: string[] = [];
const verified: string[] = [];
const notes: string[] = []; // non-asserting diagnostics for the report

function requireField(where: string, obj: any, field: string, type: string) {
  const v = obj?.[field];
  if (v === undefined || v === null) { missing.push(`${where}.${field}`); return false; }
  if (typeof v !== type) { typeMismatch.push(`${where}.${field} expected ${type}, got ${typeof v}`); return false; }
  return true;
}

// Bounded, status-preserving Engine request. A timeout or non-JSON body is a
// contract failure surfaced by the caller — the probe can never hang.
async function engineRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any } | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    if (text.trim()) {
      try { json = JSON.parse(text); } catch { return { error: `${method} ${path} → HTTP ${res.status} with non-JSON body` }; }
    }
    return { status: res.status, json };
  } catch (e: any) {
    return { error: `${method} ${path} → ${e?.name === "AbortError" ? `timed out after ${HTTP_TIMEOUT_MS} ms` : (e?.message ?? e)}` };
  } finally {
    clearTimeout(timer);
  }
}

// Cleanup is part of the contract: completion must succeed (2xx) within the
// bounded timeout, otherwise it is recorded as a mismatch — never silent.
async function completeSession(where: string, sessionId: string): Promise<void> {
  const r = await engineRequest("POST", `/api/v1/sessions/${encodeURIComponent(sessionId)}/complete`);
  if ("error" in r) { missing.push(`${where}: session completion (${r.error})`); return; }
  if (r.status < 200 || r.status >= 300) { typeMismatch.push(`${where}: POST /sessions/:id/complete expected 2xx, got ${r.status}`); return; }
  verified.push(`${where}: probe session terminated cleanly (HTTP ${r.status})`);
}

async function checkCapabilities() {
  const r = await engineRequest("GET", "/api/v1/capabilities");
  if ("error" in r) { missing.push(`GET /v1/capabilities (${r.error})`); return; }
  if (r.status !== 200) { typeMismatch.push(`GET /v1/capabilities expected 200, got ${r.status}`); return; }
  requireField("capabilities", r.json, "realtime_audio", "boolean");
  requireField("capabilities", r.json, "avatar", "boolean");
  requireField("capabilities", r.json, "call_memory", "boolean");
  if (!Array.isArray(r.json?.code_switching)) typeMismatch.push(`capabilities.code_switching expected string[], got ${typeof r.json?.code_switching}`);
  else if (!r.json.code_switching.includes("ru-en")) missing.push('capabilities.code_switching → "ru-en"');
  verified.push("GET /v1/capabilities (200, realtime_audio/avatar/code_switching/call_memory)");

  // Compatibility handshake (contract §1): the Engine reports its contract
  // identity here — record it and assert MAJOR + realtime protocol.
  const c = r.json?.contract;
  const rt = r.json?.realtime;
  // ALL discovery metadata fields of contract §1 are REQUIRED — a missing or
  // mistyped one is a contract failure, not a note.
  let handshakeOk = requireField("capabilities", r.json, "engine_version", "string");
  handshakeOk = requireField("capabilities.contract", c, "name", "string") && handshakeOk;
  handshakeOk = requireField("capabilities.contract", c, "version", "string") && handshakeOk;
  handshakeOk = requireField("capabilities.contract", c, "major", "number") && handshakeOk;
  handshakeOk = requireField("capabilities.contract", c, "hash", "string") && handshakeOk;
  handshakeOk = requireField("capabilities.realtime", rt, "protocol", "string") && handshakeOk;
  handshakeOk = requireField("capabilities.realtime", rt, "version", "string") && handshakeOk;
  handshakeOk = requireField("capabilities.realtime", rt, "protocol_version", "string") && handshakeOk;
  if (c && typeof c.version === "string") {
    engineReportedVersion =
      `contract ${c.name ?? "?"} ${c.version} (major ${c.major ?? "?"}${typeof c.hash === "string" ? `, hash ${String(c.hash).slice(0, 12)}…` : ""})` +
      `; engine ${r.json?.engine_version ?? "?"}; realtime ${rt?.protocol_version ?? "?"}`;
  }
  if (c?.name !== undefined && c.name !== EXPECTED_CONTRACT.name) { renamed.push(`capabilities.contract.name expected "${EXPECTED_CONTRACT.name}", got ${JSON.stringify(c?.name)}`); handshakeOk = false; }
  if (c?.major !== undefined && c.major !== EXPECTED_CONTRACT.major) { typeMismatch.push(`capabilities.contract.major expected ${EXPECTED_CONTRACT.major} (this client is aligned to v1), got ${JSON.stringify(c?.major)}`); handshakeOk = false; }
  if (rt?.protocol_version !== undefined && rt.protocol_version !== EXPECTED_CONTRACT.realtimeProtocol) { typeMismatch.push(`capabilities.realtime.protocol_version expected "${EXPECTED_CONTRACT.realtimeProtocol}", got ${JSON.stringify(rt?.protocol_version)}`); handshakeOk = false; }
  if (handshakeOk) verified.push(`compatibility handshake: contract major ${c.major}, ${rt.protocol_version}, hash + engine_version present`);
}

async function checkCatalog() {
  const r = await engineRequest("GET", "/api/v1/tutors");
  if ("error" in r) { missing.push(`GET /v1/tutors (${r.error})`); return; }
  if (r.status !== 200) { typeMismatch.push(`GET /v1/tutors expected 200, got ${r.status}`); return; }
  const list = Array.isArray(r.json) ? r.json : Array.isArray(r.json?.tutors) ? r.json.tutors : [];
  if (list.length === 0) { missing.push("GET /v1/tutors → non-empty tutor list"); return; }
  const t = list[0];
  requireField("tutors[0]", t, "tutor_id", "string");
  if (typeof t.display_name !== "string" && typeof t.name !== "string") missing.push("tutors[0].display_name (or name)");
  const glb = t?.avatar?.glb_url ?? t?.glb_url;
  if (typeof glb !== "string") missing.push("tutors[0].avatar.glb_url");
  const av = t?.asset_version ?? t?.avatar?.asset_version;
  if (typeof av !== "string" && typeof av !== "number") missing.push("tutors[0].asset_version");
  verified.push(`GET /v1/tutors (200, ${list.length} tutors)`);
}

function checkSessionShape(where: string, s: any): boolean {
  const okId = requireField(where, s, "session_id", "string");
  const okUrl = requireField(`${where}.realtime`, s?.realtime, "connection_url", "string");
  const okTok = requireField(`${where}.realtime`, s?.realtime, "token", "string");
  return okId && okUrl && okTok;
}

// POST /sessions is non-idempotent — created at most once per probe run, and
// the exact 201 status is part of the asserted contract.
async function createSession(where: string, sim?: TutorSimulationParams): Promise<any | null> {
  const r = await engineRequest("POST", "/api/v1/sessions", buildSessionPayload(PROBE_USER, sim));
  if ("error" in r) { missing.push(`${where} (${r.error})`); return null; }
  if (r.status !== 201) { typeMismatch.push(`${where} expected HTTP 201, got ${r.status}${r.json?.error ? ` (${JSON.stringify(r.json.error).slice(0, 120)})` : ""}`); return null; }
  return r.json;
}

async function checkPractice() {
  const s = await createSession("POST /v1/sessions mode:practice");
  if (!s) return;
  try {
    if (checkSessionShape("practice 201", s)) verified.push("POST /v1/sessions mode:practice (exact 201 + shape)");
    if (s.simulation) typeMismatch.push("practice 201 must not carry a simulation echo");
  } finally {
    if (s.session_id) await completeSession("practice", s.session_id);
  }
  if (s.session_id) await checkCallMemory(s.session_id);
}

// --- Call Memory (contract doc §call-memory) ---------------------------------
// The probe session has NO completed turns, so the deterministic live paths are
// ASSERTED STRICTLY:
//   GET  before generation → 404 CALL_MEMORY_NOT_GENERATED (not_started);
//   POST → 409 NO_COMPLETED_TURNS ("no memory", not an error).
// ANY other POST outcome (2xx, generation-exists conflict, other status) is a
// contract failure: the engine must not generate memory for a turn-less
// session that GET just reported as not generated. If that failure mode is
// observed, a bounded NON-ASSERTING diagnostic poll additionally reports the
// status/categories/reference field names the Engine sends (group_id/version
// names are still unconfirmed — see docs/tutor-goal-contract-open-question.md)
// so the mismatch report carries maximum information; the diagnostic never
// adds "verified" entries and never turns the failure into a pass.
const CALL_MEMORY_CATEGORIES = [
  "objective", "facts", "dates_times", "questions",
  "rehearsed_answers", "vocabulary", "uncertain_facts",
] as const;
const CALL_MEMORY_POLL_ATTEMPTS = 5;
const CALL_MEMORY_POLL_DELAY_MS = 3_000;

// NON-ASSERTING diagnostic: describe a ready payload (categories + observed
// reference field names) for the mismatch report. Never adds verified entries
// and never fails on its own — the deterministic assertion already failed.
function describeCallMemoryReady(json: any): string {
  const content = json?.latest?.content ?? json?.content;
  const cats = content && typeof content === "object"
    ? CALL_MEMORY_CATEGORIES.filter((c) => content[c] !== undefined && content[c] !== null).join(",")
    : "no content object";
  const groupIdField =
    typeof json?.group_id === "string" ? "group_id"
    : typeof json?.call_memory_group_id === "string" ? "call_memory_group_id"
    : typeof json?.latest?.group_id === "string" ? "latest.group_id"
    : "NONE";
  const versionField =
    typeof json?.latest?.version === "number" ? "latest.version"
    : typeof json?.version === "number" ? "version"
    : "NONE";
  return `categories=[${cats}]; reference fields observed: groupId=${groupIdField}, version=${versionField} (unconfirmed names — see docs/tutor-goal-contract-open-question.md)`;
}

async function checkCallMemory(sessionId: string) {
  const path = `/api/v1/sessions/${encodeURIComponent(sessionId)}/call-memory`;

  // 1) GET before generation — must be 404 CALL_MEMORY_NOT_GENERATED.
  const pre = await engineRequest("GET", path);
  if ("error" in pre) { missing.push(`GET /sessions/:id/call-memory pre-generation (${pre.error})`); return; }
  if (pre.status === 404 && JSON.stringify(pre.json ?? "").includes("CALL_MEMORY_NOT_GENERATED")) {
    verified.push("GET /sessions/:id/call-memory pre-generation (404 CALL_MEMORY_NOT_GENERATED)");
  } else if (pre.status === 404) {
    renamed.push(`GET call-memory 404 without CALL_MEMORY_NOT_GENERATED code (body ${JSON.stringify(pre.json).slice(0, 120)})`);
  } else {
    typeMismatch.push(`GET call-memory pre-generation expected 404 CALL_MEMORY_NOT_GENERATED, got ${pre.status}`);
  }

  // 2) POST — the probe session has no completed turns, so the ONLY correct
  // response is 409 NO_COMPLETED_TURNS. Anything else (2xx, generation-exists
  // conflict, other status) is a contract failure: the engine must not have a
  // generation for a session GET just reported as not generated.
  const post = await engineRequest("POST", path);
  if ("error" in post) { missing.push(`POST /sessions/:id/call-memory (${post.error})`); return; }
  const postBody = JSON.stringify(post.json ?? "");
  if (post.status === 409 && postBody.includes("NO_COMPLETED_TURNS")) {
    verified.push("POST /sessions/:id/call-memory (409 NO_COMPLETED_TURNS for turn-less session)");
    return;
  }
  typeMismatch.push(
    `POST call-memory on a turn-less session expected 409 NO_COMPLETED_TURNS, got ${post.status}` +
    (postBody && postBody !== '""' ? ` (body ${postBody.slice(0, 120)})` : ""),
  );

  // 3) Failure already recorded — run a bounded NON-ASSERTING diagnostic poll
  // so the mismatch report shows what the engine actually did. Adds context
  // to notes only; never verified, never a pass.
  if (post.status !== 409 && (post.status < 200 || post.status >= 300)) return; // nothing to poll
  for (let attempt = 1; attempt <= CALL_MEMORY_POLL_ATTEMPTS; attempt++) {
    const r = await engineRequest("GET", path);
    if ("error" in r || r.status !== 200) {
      notes.push(`call-memory diagnostic poll: ${"error" in r ? r.error : `HTTP ${r.status}`}`);
      return;
    }
    const status = r.json?.status;
    if (status === "pending" && attempt < CALL_MEMORY_POLL_ATTEMPTS) {
      await new Promise((res) => setTimeout(res, CALL_MEMORY_POLL_DELAY_MS));
      continue;
    }
    if (status === "ready") {
      notes.push(`call-memory diagnostic: status "ready" — ${describeCallMemoryReady(r.json)}`);
    } else {
      notes.push(`call-memory diagnostic: status ${JSON.stringify(status)} after unexpected generation`);
    }
    return;
  }
}

async function checkSimulationOpening() {
  const sim: TutorSimulationParams = {
    goal: "Call the clinic to reschedule an appointment",
    learnerRole: "caller",
    tutorRole: "clinic receptionist",
    context: { source: "none" },
  };
  const s = await createSession("POST /v1/sessions mode:simulation", sim);
  if (!s) return;
  const sessionId = s.session_id;
  try {
    if (!checkSessionShape("simulation 201", s)) return;
    verified.push("POST /v1/sessions mode:simulation (exact 201 + shape)");
    // Echo (contract §1)
    const echo = s.simulation;
    if (!echo) missing.push("simulation 201 → simulation echo");
    else {
      if (echo.goal !== sim.goal) typeMismatch.push(`simulation echo.goal expected literal goal text, got ${JSON.stringify(echo.goal)}`);
      if (echo?.roles?.learner !== sim.learnerRole || echo?.roles?.tutor !== sim.tutorRole) typeMismatch.push("simulation echo.roles mismatch");
      if (echo?.context?.source !== "none") typeMismatch.push(`simulation echo.context.source expected "none", got ${JSON.stringify(echo?.context?.source)}`);
      verified.push("simulation echo (goal/roles/context)");
    }

    // Realtime opening turn (bounded by OPENING_TIMEOUT_MS).
    const wsUrl = BASE.replace(/^http/, "ws") + s.realtime.connection_url;
    const seenTypes = new Set<string>();
    let openingTrue = false;
    let suggested: any = null;
    let teachingHint: any = null;
    let sawText = false;
    let completed = false;
    let wsError: string | null = null;

    await new Promise<void>((resolve) => {
      const ws = new WebSocket(wsUrl, { handshakeTimeout: HTTP_TIMEOUT_MS });
      const timer = setTimeout(() => done(), OPENING_TIMEOUT_MS);
      let finished = false;
      function done() {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve();
      }
      ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token: s.realtime.token, session_id: sessionId })));
      ws.on("error", (e: any) => { wsError = e?.message ?? String(e); done(); });
      ws.on("close", () => done());
      ws.on("message", (d, isBin) => {
        if (isBin) return;
        let m: any; try { m = JSON.parse(d.toString()); } catch { return; }
        if (typeof m?.type !== "string") return;
        seenTypes.add(m.type);
        if (m.type === "turn.started" && m.opening === true) openingTrue = true;
        if (m.type === "turn.started" && m.opening !== undefined && typeof m.opening !== "boolean")
          typeMismatch.push(`turn.started.opening expected boolean, got ${typeof m.opening}`);
        if (m.type === "tutor.text.delta" || m.type === "tutor.text.final") sawText = true;
        if (m.type === "tutor.suggested_reply" && !suggested) suggested = m;
        if (m.type === "tutor.hint" && !teachingHint) teachingHint = m;
        if (m.type === "turn.completed") { completed = true; done(); }
      });
    });

    if (wsError) missing.push(`realtime WS connection (${wsError})`);
    if (!seenTypes.has("session.ready")) missing.push("realtime session.ready"); else verified.push("session.ready");
    if (!openingTrue) missing.push("turn.started {opening:true} (tutor-first opening)"); else verified.push("turn.started opening:true");
    if (!sawText) missing.push("tutor.text.delta / tutor.text.final in the opening turn"); else verified.push("tutor text (delta/final)");
    if (!completed) missing.push(`turn.completed closing the opening turn (waited ${OPENING_TIMEOUT_MS / 1000}s)`); else verified.push("turn.completed");

    // tutor.suggested_reply — suggested USER reply (contract §2/§4.1):
    // {text: string, translation: string|null, carryover: boolean}. A
    // tutor.hint frame is a DIFFERENT event and never satisfies this check.
    if (suggested) {
      requireField("tutor.suggested_reply", suggested, "text", "string");
      if (suggested.translation !== null && typeof suggested.translation !== "string")
        typeMismatch.push(`tutor.suggested_reply.translation expected string|null, got ${typeof suggested.translation}`);
      else if (suggested.translation === null)
        notes.push("tutor.suggested_reply.translation was null in the opening turn (contract allows string|null)");
      requireField("tutor.suggested_reply", suggested, "carryover", "boolean");
      verified.push("tutor.suggested_reply (suggested USER reply: text/translation/carryover)");
    } else {
      missing.push("tutor.suggested_reply in the opening turn");
    }
    // tutor.hint — teaching hint {hint, mode}: OPTIONAL in the opening turn,
    // but if present its shape must match the contract.
    if (teachingHint) {
      requireField("tutor.hint", teachingHint, "hint", "string");
      requireField("tutor.hint", teachingHint, "mode", "string");
      verified.push("tutor.hint (teaching hint — distinct event, shape validated)");
    }
  } finally {
    await completeSession("simulation", sessionId);
  }
}

async function main() {
  if (!API_KEY) {
    console.error("TUTOR_ENGINE_API_KEY is not configured — cannot probe the Engine.");
    process.exit(2);
  }
  console.log(`Tutor Engine contract probe\n  consumer snapshot: ${CONSUMER_SNAPSHOT}\n  engine:            ${BASE}\n`);

  await checkCapabilities();
  await checkCatalog();
  await checkPractice();
  await checkSimulationOpening();

  // The version the Engine ITSELF reported at run time (contract §1
  // compatibility handshake) — recorded so every probe run states exactly
  // which contract version it validated against.
  console.log(`Engine-reported contract (validated against): ${engineReportedVersion}\n`);

  console.log("Verified:");
  for (const v of verified) console.log(`  ✓ ${v}`);
  if (notes.length) {
    console.log("Diagnostics (non-asserting):");
    for (const a of notes) console.log(`  ~ ${a}`);
  }

  const failed = missing.length + renamed.length + typeMismatch.length > 0;
  if (failed) {
    console.error("\nTutor Engine contract mismatch:");
    if (missing.length) { console.error("MISSING:"); for (const m of missing) console.error(`  - ${m}`); }
    if (renamed.length) { console.error("RENAMED/UNEXPECTED:"); for (const r of renamed) console.error(`  - ${r}`); }
    if (typeMismatch.length) { console.error("TYPE MISMATCH:"); for (const t of typeMismatch) console.error(`  - ${t}`); }
    process.exit(1);
  }
  console.log("\nContract OK — no mismatches.");
  process.exit(0);
}

main().catch((e) => { console.error("Probe crashed:", e); process.exit(2); });
