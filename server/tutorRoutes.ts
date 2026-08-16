// API routes for the AI Tutor (external Tutor Engine) integration.
// The engine API key never leaves the backend: these routes proxy capabilities,
// manifest, and session creation, and return only client-safe data.
import path from "path";
import type { Express } from "express";
import { authMiddleware } from "./auth";
import {
  TutorEngineError,
  tutorEngineConfigured,
  getTutorEngineBase,
  getTutorId,
  getCapabilities,
  getTutorManifest,
  getTutorCatalog,
  normalizeTutorEntry,
  createTutorSession,
  ensureEngineCompatible,
  completeTutorSession,
  startCallMemoryGeneration,
  fetchCallMemory,
  runTutorSmokeChecks,
  simulationErrorCode,
  type TutorSimulationParams,
} from "./tutorEngine";
import { validateSimulationRequest, buildSimulationParams, mapSimulationEngineError, simulationEchoMatches } from "./tutorSimulation";
import {
  createTutorSessionRow,
  endTutorSessionRow,
  getTutorSessionRow,
  getCallMemoryByEngineSession,
  listTutorSessions,
  saveCallMemory,
  listCallMemories,
  getCallMemory,
  updateCallMemoryFields,
  confirmCallMemory,
} from "./tutorStorage";
import { TUTOR_AVATAR_PAGE_HTML } from "./tutorAvatarPage";
import { buildTutorPreviewHtml } from "./tutorPreviewPage";
import { translateTutorText, validateTranslateInput } from "./tutorTranslate";
import { storage } from "./storage";

// Users only ever see a safe connection error; full detail goes to the log.
function safeEngineError(res: any, err: any) {
  if (err instanceof TutorEngineError) {
    console.error(`[Tutor] Engine error (${err.kind}, status=${err.status}): ${err.message}${err.body ? ` body=${err.body}` : ""}`);
    if (err.kind === "not_configured") {
      return res.status(503).json({ error: "tutor_not_configured", message: "Репетитор ещё не настроен." });
    }
    if (err.kind === "incompatible") {
      // Fail-closed contract handshake: the exact divergence is already in the
      // backend log; the user gets an honest, safe message.
      return res.status(503).json({ error: "tutor_incompatible", message: "Репетитор временно недоступен: несовместимая версия движка." });
    }
    return res.status(502).json({ error: "tutor_connection", message: "Не удалось связаться с репетитором. Попробуйте позже." });
  }
  console.error("[Tutor] Unexpected error:", err);
  return res.status(500).json({ error: "tutor_internal", message: "Внутренняя ошибка." });
}

// Greeting name for the avatar page's LOCAL welcome card. Priority:
// 1) the display name of the user's first phone number (set at provisioning,
//    e.g. "Leo"), 2) the email local part. Never invented, never engine-side.
async function getTutorDisplayName(user: { id: string; email: string }): Promise<string> {
  try {
    const numbers = await storage.getUserPhoneNumbers(user.id);
    const named = numbers.find((n) => n.name && n.name.trim());
    if (named) return named.name.trim();
  } catch (err) {
    console.error("[Tutor] displayName lookup failed (falling back to email):", err);
  }
  return (user.email.split("@")[0] || "").trim();
}

export function registerTutorRoutes(app: Express) {
  // The avatar page rendered inside the iOS WKWebView. Auth happens via the
  // normal Bearer session token which the page passes to our /api/tutor calls.
  app.get("/tutor", (_req, res) => {
    res.type("html").send(TUTOR_AVATAR_PAGE_HTML);
  });

  // Static blurred-scene background for the avatar card (freeze §2). No auth
  // needed: it is a decorative image with no user data.
  app.get("/tutor/bg.png", (_req, res) => {
    res.sendFile(path.resolve(import.meta.dirname, "assets", "tutor-bg.png"), {
      maxAge: "1d",
    } as any);
  });

  // DEV-ONLY visual review of the real tutor page states (task 144). Serves
  // the same page with a client-side driver that stubs engine/backend — no
  // real sessions, no secrets. Never available in production.
  app.get("/tutor/preview", (req, res) => {
    if (process.env.NODE_ENV === "production") return res.status(404).end();
    res.type("html").send(buildTutorPreviewHtml());
  });

  // Dynamic tutor catalog from the engine (allow-list driven — never
  // hardcode ids). Client-safe: names, previews, asset versions only.
  app.get("/api/tutor/tutors", authMiddleware, async (_req, res) => {
    if (!tutorEngineConfigured()) return res.json({ tutors: [] });
    try {
      const list = (await getTutorCatalog())
        .map(normalizeTutorEntry)
        .filter((t): t is NonNullable<typeof t> => t !== null);
      res.json({ tutors: list, defaultTutorId: getTutorId() });
    } catch (err) {
      safeEngineError(res, err);
    }
  });

  // Client-safe status: capabilities + avatar assets. No API key material.
  app.get("/api/tutor/status", authMiddleware, async (req, res) => {
    const user = (req as any).user;
    if (!tutorEngineConfigured()) {
      return res.json({ configured: false, ready: false, callMemoryReady: false });
    }
    // Optional ?tutorId= — must exist in the engine catalog; unknown ids are
    // rejected (the catalog is the source of truth, not the client).
    const reqTutorId = typeof req.query.tutorId === "string" && req.query.tutorId ? req.query.tutorId : undefined;
    try {
      const [caps, tutor, displayName] = await Promise.all([
        getCapabilities(),
        getTutorManifest(reqTutorId),
        getTutorDisplayName(user),
      ]);
      const cs = Array.isArray(caps.code_switching) ? caps.code_switching : [];
      const practiceReady = caps.realtime_audio === true && caps.avatar === true;
      res.json({
        configured: true,
        ready: practiceReady,
        // If call_memory is off, practice may run but the real-call handoff is
        // NOT ready — surfaced explicitly, never silently degraded.
        callMemoryReady: caps.call_memory === true,
        codeSwitchingRuEn: cs.includes("ru-en"),
        // Normalized (absolute asset URLs, display name) — same shape the
        // catalog endpoint returns, so the client treats both uniformly.
        tutor: normalizeTutorEntry(tutor),
        engineBase: getTutorEngineBase(),
        // Client-safe greeting name for the local welcome card ("Привет, Имя").
        // Derived from the user's own profile (phone display name, else the
        // email local part) — never from engine content.
        displayName,
      });
    } catch (err) {
      safeEngineError(res, err);
    }
  });

  // Integration smoke checks (operator-facing).
  app.get("/api/tutor/smoke", authMiddleware, async (req, res) => {
    const user = (req as any).user;
    try {
      res.json(await runTutorSmokeChecks(user.id));
    } catch (err) {
      safeEngineError(res, err);
    }
  });

  // Start a practice session — or a goal-driven SIMULATION session when the
  // body carries a `simulation` block (Engine contract v1). Returns session
  // id + short-lived realtime credentials only (the engine key stays
  // server-side). FAIL-CLOSED: a failed simulation create is surfaced with an
  // explicit error — TalkHint never silently falls back to free talk, and
  // never auto-retries the non-idempotent POST /sessions.
  app.post("/api/tutor/sessions", authMiddleware, async (req, res) => {
    const user = (req as any).user;
    // Optional tutor selection — only the id travels to the engine; it must
    // exist in the live catalog (allow-list driven, never trusted blindly).
    let tutorId: string | undefined;
    if (req.body && typeof req.body === "object" && req.body.tutorId !== undefined) {
      if (typeof req.body.tutorId !== "string" || !req.body.tutorId || req.body.tutorId.length > 64) {
        return res.status(400).json({ error: "tutor_invalid", message: "Некорректный идентификатор репетитора." });
      }
      try {
        const catalog = await getTutorCatalog();
        if (!catalog.some((t: any) => t?.tutor_id === req.body.tutorId)) {
          return res.status(404).json({ error: "tutor_not_found", message: "Такой репетитор недоступен." });
        }
      } catch (err) {
        return safeEngineError(res, err);
      }
      tutorId = req.body.tutorId;
    }
    let sim: TutorSimulationParams | undefined;
    if (req.body && typeof req.body === "object" && req.body.simulation !== undefined) {
      const v = validateSimulationRequest(req.body.simulation);
      if (!v.ok) return res.status(400).json({ error: v.error, message: v.message });
      let memoryRef: { groupId: string; version: number } | null = null;
      if (v.memoryId) {
        // Context by reference only: the memory must be this user's, confirmed
        // in TalkHint, AND carry the engine-side group id + version.
        const row = await getCallMemory(user.id, v.memoryId);
        if (!row) return res.status(404).json({ error: "memory_not_found", message: "Память разговора не найдена." });
        if (row.status !== "REAL_CALL_READY")
          return res.status(409).json({ error: "memory_not_confirmed", message: "Сначала подтвердите память разговора." });
        if (!row.engineGroupId || row.engineVersion == null)
          return res.status(409).json({
            error: "memory_no_engine_reference",
            message: "У этой памяти нет ссылки движка (создана до обновления). Начните без контекста или создайте память заново.",
          });
        memoryRef = { groupId: row.engineGroupId, version: row.engineVersion };
      }
      sim = buildSimulationParams(v, memoryRef);
    }
    try {
      // Runtime compatibility handshake (contract §1): verify the deployed
      // engine still speaks tutor-engine major 1 / tutor-realtime/1.0 BEFORE
      // creating a session. Cached — no extra round-trip per request. Throws
      // kind:"incompatible" on a verified mismatch → 503 with an honest
      // message, session NOT created.
      await ensureEngineCompatible();
      const session = await createTutorSession(user.id, sim, tutorId);
      const engineSessionId = session?.session_id;
      const realtime = session?.realtime;
      if (!engineSessionId || !realtime?.connection_url || !realtime?.token) {
        // Redacted log: never record the realtime token.
        console.error(
          "[Tutor] Unexpected session payload from engine:",
          JSON.stringify({
            session_id: session?.session_id ?? null,
            has_realtime: !!session?.realtime,
            has_connection_url: !!session?.realtime?.connection_url,
            has_token: !!session?.realtime?.token,
          }),
        );
        return res.status(502).json({ error: "tutor_connection", message: "Репетитор вернул неожиданный ответ." });
      }
      // Verify the engine echoed the simulation block back (contract §1) —
      // a missing echo means the request was NOT honored; fail loudly.
      if (sim && !simulationEchoMatches(sim, session?.simulation)) {
        console.error("[Tutor] Simulation echo missing or mismatched — refusing the session (no silent practice fallback).");
        try { await completeTutorSession(engineSessionId); } catch { /* best effort */ }
        return res.status(502).json({ error: "simulation_echo_missing", message: "Движок не подтвердил параметры симуляции. Попробуйте ещё раз." });
      }
      // Persist the authoritative session kind: /end decides the memory policy
      // from THIS, never from a client flag (Tutor/Calls separation).
      await createTutorSessionRow(
        user.id, engineSessionId, tutorId || getTutorId(),
        sim ? "call_simulation" : "english_free_talk",
        sim ? "simulation" : "practice",
      );
      const wsBase = getTutorEngineBase().replace(/^http/, "ws");
      // Auth happens via the first WS message ({type:"auth", token, session_id}),
      // NOT via query string — the token never travels in a URL.
      res.status(201).json({
        sessionId: engineSessionId,
        // Echoed by the engine for simulation sessions (incl. items_injected
        // for call-memory context) — client-safe, shown to the user.
        simulation: session?.simulation ?? null,
        realtime: {
          connectionUrl: realtime.connection_url,
          token: realtime.token,
          wsUrl: `${wsBase}${realtime.connection_url}`,
        },
      });
    } catch (err) {
      // Explicit fail-closed mapping of the engine's simulation error table.
      const code = simulationErrorCode(err);
      if (code) {
        const m = mapSimulationEngineError(code);
        console.error(`[Tutor] Simulation create rejected by engine: ${code}`);
        return res.status(m.status).json({ error: m.error, message: m.message });
      }
      safeEngineError(res, err);
    }
  });

  // End practice: fetch the engine's structured Call Memory and store it in
  // MEMORY_CONFIRMATION state. If the engine can't provide one, the integration
  // is surfaced as incomplete — TalkHint never summarizes the session itself.
  app.post("/api/tutor/sessions/:engineSessionId/end", authMiddleware, async (req, res) => {
    const user = (req as any).user;
    const engineSessionId = req.params.engineSessionId;
    try {
      // Ownership gate: only a session this user created may be ended/fetched.
      // Prevents pulling another user's practice memory by guessing an engine
      // session id (memories are keyed by engine session at the engine).
      const owned = await getTutorSessionRow(user.id, engineSessionId);
      if (!owned) return res.status(404).json({ error: "session_not_found" });
      // Tutor/Calls separation — SERVER-authoritative policy: the persisted
      // session mode decides whether Call Memory exists at all. Free LEARNING
      // sessions never produce Call Memory (that belongs to Calls → Practice);
      // a client flag can never opt a simulation out of its memory flow.
      // (Rows predating the mode column default to "practice" = learning.)
      if (owned.mode !== "simulation") {
        await endTutorSessionRow(user.id, engineSessionId);
        try { await completeTutorSession(engineSessionId); }
        catch (e: any) { console.error("[Tutor] complete (learning) failed:", e?.message); }
        return res.json({ callMemory: null, reason: "learning_session" });
      }
      // Idempotent: repeated /end returns the already-saved memory, never a
      // duplicate row (also enforced by a unique (user, session) index).
      const existing = await getCallMemoryByEngineSession(user.id, engineSessionId);
      if (existing) return res.json({ callMemory: existing });
      await endTutorSessionRow(user.id, engineSessionId);
      try {
        // 1) Complete the engine session (documented endpoint).
        await completeTutorSession(engineSessionId);
        // 2) Start Call Memory generation explicitly (GET never triggers it).
        const gen = await startCallMemoryGeneration(engineSessionId);
        if (gen.noTurns) {
          return res.json({
            callMemory: null,
            reason: "no_completed_turns",
            message: "В тренировке не было завершённых реплик — память разговора не создана.",
          });
        }
        // 3) Bounded poll: pending → retry with backoff, up to ~20 s.
        let mem = null;
        let memRef: { groupId: string | null; version: number | null } = { groupId: null, version: null };
        let failedRetriable = false;
        for (let attempt = 0; attempt < 8; attempt++) {
          const poll = await fetchCallMemory(engineSessionId);
          if (poll.status === "ready") { mem = poll.memory; memRef = { groupId: poll.groupId, version: poll.version }; break; }
          if (poll.status === "failed") {
            if (!poll.retriable) break;
            failedRetriable = true;
          }
          await new Promise((r) => setTimeout(r, 1500 + attempt * 500));
        }
        if (!mem) {
          return res.json({
            callMemory: null,
            reason: failedRetriable ? "call_memory_retriable" : "call_memory_pending",
            message: failedRetriable
              ? "Не удалось подготовить память разговора — попробуйте ещё раз."
              : "Память разговора ещё готовится — попробуйте ещё раз через минуту.",
          });
        }
        const saved = await saveCallMemory(user.id, engineSessionId, mem, memRef.groupId, memRef.version);
        return res.json({ callMemory: saved ?? null });
      } catch (err) {
        return safeEngineError(res, err);
      }
    } catch (err) {
      safeEngineError(res, err);
    }
  });

  // Translate a tutor card's text into Russian (the engine sends no card
  // translations). Auth-scoped; cached by normalized text so repeat taps are
  // instant. Fails loudly (502) instead of returning fallback text.
  app.post("/api/tutor/translate", authMiddleware, async (req, res) => {
    const invalid = validateTranslateInput(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    try {
      const result = await translateTutorText(String(req.body.text));
      res.json(result);
    } catch (err: any) {
      console.error("[Tutor] Translate failed:", err?.message || err);
      res.status(502).json({ error: "translate_failed", message: "Не удалось перевести. Попробуйте ещё раз." });
    }
  });

  app.get("/api/tutor/sessions", authMiddleware, async (req, res) => {
    const user = (req as any).user;
    res.json(await listTutorSessions(user.id));
  });

  app.get("/api/tutor/memories", authMiddleware, async (req, res) => {
    const user = (req as any).user;
    res.json(await listCallMemories(user.id));
  });

  // Edit while awaiting confirmation only.
  app.patch("/api/tutor/memories/:id", authMiddleware, async (req, res) => {
    const user = (req as any).user;
    const updated = await updateCallMemoryFields(user.id, req.params.id, req.body ?? {});
    if (!updated) return res.status(404).json({ error: "not_editable", message: "Память не найдена или уже подтверждена." });
    res.json(updated);
  });

  // Explicit user confirmation — the ONLY path to REAL_CALL_READY.
  app.post("/api/tutor/memories/:id/confirm", authMiddleware, async (req, res) => {
    const user = (req as any).user;
    const row = await getCallMemory(user.id, req.params.id);
    if (!row) return res.status(404).json({ error: "not_found" });
    if (row.status === "REAL_CALL_READY") return res.json(row); // idempotent
    const confirmed = await confirmCallMemory(user.id, req.params.id);
    if (!confirmed) return res.status(409).json({ error: "not_confirmable", message: "Эта память уже использована." });
    res.json(confirmed);
  });
}
