// ---------------------------------------------------------------------------
// Task #160 — LIVE Tutor Engine contract probe.
//
// Run manually (REQUIRED pre-publish check for TalkHint):
//   npm run test:tutor-engine-contract
//
// Verifies PROTOCOL COMPATIBILITY ONLY against the real Engine:
//   - GET /v1/capabilities consumed fields;
//   - GET /v1/tutors catalog shape;
//   - practice session create (exact HTTP 201 + shape) + VERIFIED completion;
//   - simulation source:none — exact 201, echo, tutor-first opening turn
//     (turn.started opening:true), tutor text, first CANONICAL
//     tutor.suggested_reply with translation, turn.completed.
//
// It NEVER checks teaching quality or exact wording — a model or phrasing
// change must not fail this probe; a renamed event or changed field type must.
//
// No silent alias success: if the Engine sends only the LEGACY tutor.hint and
// not the canonical tutor.suggested_reply, this probe FAILS with an explicit
// RENAMED/UNEXPECTED entry (the client may still render the alias, but the
// canonical mismatch is reported loudly).
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

const CONTRACT_VERSION = "consumer contract 2026-08-13 (Goal-Driven Simulation v1; canonical hint event: tutor.suggested_reply)";
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
const aliasesSeen: string[] = [];

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
    let legacyHintSeen = false;
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
        if (m.type === "tutor.hint") legacyHintSeen = true;
        if (m.type === "turn.completed") { completed = true; done(); }
      });
    });

    if (wsError) missing.push(`realtime WS connection (${wsError})`);
    if (!seenTypes.has("session.ready")) missing.push("realtime session.ready"); else verified.push("session.ready");
    if (!openingTrue) missing.push("turn.started {opening:true} (tutor-first opening)"); else verified.push("turn.started opening:true");
    if (!sawText) missing.push("tutor.text.delta / tutor.text.final in the opening turn"); else verified.push("tutor text (delta/final)");
    if (!completed) missing.push(`turn.completed closing the opening turn (waited ${OPENING_TIMEOUT_MS / 1000}s)`); else verified.push("turn.completed");

    // Canonical hint event — no silent alias success.
    if (legacyHintSeen) aliasesSeen.push("tutor.hint (LEGACY)");
    if (suggested) {
      requireField("tutor.suggested_reply", suggested, "text", "string");
      requireField("tutor.suggested_reply", suggested, "translation", "string");
      verified.push("tutor.suggested_reply (canonical, with translation)");
    } else if (legacyHintSeen) {
      renamed.push("expected tutor.suggested_reply — received only legacy tutor.hint");
    } else {
      missing.push("tutor.suggested_reply in the opening turn");
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
  console.log(`Tutor Engine contract probe\n  contract: ${CONTRACT_VERSION}\n  engine:   ${BASE}\n`);

  await checkCapabilities();
  await checkCatalog();
  await checkPractice();
  await checkSimulationOpening();

  console.log("Verified:");
  for (const v of verified) console.log(`  ✓ ${v}`);
  if (aliasesSeen.length) {
    console.log("Compatibility aliases still present:");
    for (const a of aliasesSeen) console.log(`  ~ ${a}`);
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
