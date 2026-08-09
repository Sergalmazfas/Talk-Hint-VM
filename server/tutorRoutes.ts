// API routes for the AI Tutor (external Tutor Engine) integration.
// The engine API key never leaves the backend: these routes proxy capabilities,
// manifest, and session creation, and return only client-safe data.
import type { Express } from "express";
import { authMiddleware } from "./auth";
import {
  TutorEngineError,
  tutorEngineConfigured,
  getTutorEngineBase,
  getTutorId,
  getCapabilities,
  getTutorManifest,
  createTutorSession,
  fetchCallMemory,
  runTutorSmokeChecks,
} from "./tutorEngine";
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

// Users only ever see a safe connection error; full detail goes to the log.
function safeEngineError(res: any, err: any) {
  if (err instanceof TutorEngineError) {
    console.error(`[Tutor] Engine error (${err.kind}, status=${err.status}): ${err.message}${err.body ? ` body=${err.body}` : ""}`);
    if (err.kind === "not_configured") {
      return res.status(503).json({ error: "tutor_not_configured", message: "Репетитор ещё не настроен." });
    }
    return res.status(502).json({ error: "tutor_connection", message: "Не удалось связаться с репетитором. Попробуйте позже." });
  }
  console.error("[Tutor] Unexpected error:", err);
  return res.status(500).json({ error: "tutor_internal", message: "Внутренняя ошибка." });
}

export function registerTutorRoutes(app: Express) {
  // The avatar page rendered inside the iOS WKWebView. Auth happens via the
  // normal Bearer session token which the page passes to our /api/tutor calls.
  app.get("/tutor", (_req, res) => {
    res.type("html").send(TUTOR_AVATAR_PAGE_HTML);
  });

  // Client-safe status: capabilities + avatar assets. No API key material.
  app.get("/api/tutor/status", authMiddleware, async (_req, res) => {
    if (!tutorEngineConfigured()) {
      return res.json({ configured: false, ready: false, callMemoryReady: false });
    }
    try {
      const [caps, tutor] = await Promise.all([getCapabilities(), getTutorManifest()]);
      const cs = Array.isArray(caps.code_switching) ? caps.code_switching : [];
      const practiceReady = caps.realtime_audio === true && caps.avatar === true;
      res.json({
        configured: true,
        ready: practiceReady,
        // If call_memory is off, practice may run but the real-call handoff is
        // NOT ready — surfaced explicitly, never silently degraded.
        callMemoryReady: caps.call_memory === true,
        codeSwitchingRuEn: cs.includes("ru-en"),
        tutor: {
          tutorId: tutor.tutor_id,
          name: tutor.name ?? "Emma",
          previewUrl: tutor.preview_url ?? tutor.avatar?.preview_url ?? null,
          glbUrl: tutor.avatar?.glb_url ?? null,
          body: tutor.avatar?.body ?? null,
          assetVersion: tutor.asset_version ?? tutor.avatar?.asset_version ?? null,
        },
        engineBase: getTutorEngineBase(),
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

  // Start a practice session. Returns session id + short-lived realtime
  // credentials only (the engine key stays server-side).
  app.post("/api/tutor/sessions", authMiddleware, async (req, res) => {
    const user = (req as any).user;
    try {
      const session = await createTutorSession(user.id);
      const engineSessionId = session?.session_id;
      const realtime = session?.realtime;
      if (!engineSessionId || !realtime?.connection_url || !realtime?.token) {
        console.error("[Tutor] Unexpected session payload from engine:", JSON.stringify(session).slice(0, 300));
        return res.status(502).json({ error: "tutor_connection", message: "Репетитор вернул неожиданный ответ." });
      }
      await createTutorSessionRow(user.id, engineSessionId, getTutorId(), "english_free_talk");
      const wsBase = getTutorEngineBase().replace(/^http/, "ws");
      res.status(201).json({
        sessionId: engineSessionId,
        realtime: {
          connectionUrl: realtime.connection_url,
          token: realtime.token,
          wsUrl: `${wsBase}${realtime.connection_url}?token=${encodeURIComponent(realtime.token)}`,
        },
      });
    } catch (err) {
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
      // Idempotent: repeated /end returns the already-saved memory, never a
      // duplicate row (also enforced by a unique (user, session) index).
      const existing = await getCallMemoryByEngineSession(user.id, engineSessionId);
      if (existing) return res.json({ callMemory: existing });
      await endTutorSessionRow(user.id, engineSessionId);
      let mem = null;
      try {
        mem = await fetchCallMemory(engineSessionId);
      } catch (err) {
        return safeEngineError(res, err);
      }
      if (!mem) {
        return res.json({
          callMemory: null,
          reason: "call_memory_unavailable",
          message: "Движок репетитора пока не отдаёт память разговора — переход в реальный звонок недоступен.",
        });
      }
      const saved = await saveCallMemory(user.id, engineSessionId, mem);
      res.json({ callMemory: saved ?? null });
    } catch (err) {
      safeEngineError(res, err);
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
