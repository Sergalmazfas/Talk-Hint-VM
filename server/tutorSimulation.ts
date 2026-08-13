// ---------------------------------------------------------------------------
// Pure helpers for Goal-Driven Simulation session creation (Engine contract
// v1, 2026-08-13). Kept as pure functions so the request-validation and the
// fail-closed error mapping are unit-testable without Express or the engine.
//
// HARD RULES (contract §1, §5, §6):
//   - simulation.goal is the LITERAL user-entered goal text — TalkHint never
//     sends keywords, slots, goalAchieved flags, or any derived tracking.
//   - Context goes BY REFERENCE ONLY (group id + confirmed version) — inline
//     facts are rejected by the engine by design.
//   - There is NO fallback to free talk: every engine error below maps to an
//     explicit user-facing failure, never to a silently-created practice
//     session. POST /sessions is non-idempotent — no auto-retry.
// ---------------------------------------------------------------------------
import type { TutorSimulationParams, SimulationErrorCode } from "./tutorEngine";

export interface SimulationRequestOk {
  ok: true;
  goal: string;
  learnerRole: string;
  tutorRole: string;
  memoryId: string | null;
}
export interface SimulationRequestBad {
  ok: false;
  error: string;
  message: string; // user-facing, Russian
}

// Validates the client's `simulation` request body (goal + roles + optional
// memoryId). Limits mirror the engine contract: goal ≤500, roles ≤120.
export function validateSimulationRequest(body: unknown): SimulationRequestOk | SimulationRequestBad {
  const s: any = body && typeof body === "object" ? body : {};
  const goal = typeof s.goal === "string" ? s.goal.trim() : "";
  if (!goal) return { ok: false, error: "simulation_goal_required", message: "Укажите цель разговора." };
  if (goal.length > 500) return { ok: false, error: "simulation_goal_too_long", message: "Цель — не длиннее 500 символов." };
  const learnerRole = (typeof s.learnerRole === "string" ? s.learnerRole.trim() : "") || "caller";
  const tutorRole = typeof s.tutorRole === "string" ? s.tutorRole.trim() : "";
  if (!tutorRole) return { ok: false, error: "simulation_role_required", message: "Укажите, кем будет Emma (собеседник)." };
  if (learnerRole.length > 120 || tutorRole.length > 120)
    return { ok: false, error: "simulation_role_too_long", message: "Роль — не длиннее 120 символов." };
  const memoryId = typeof s.memoryId === "string" && s.memoryId.trim() ? s.memoryId.trim() : null;
  return { ok: true, goal, learnerRole, tutorRole, memoryId };
}

export function buildSimulationParams(
  v: SimulationRequestOk,
  memoryRef: { groupId: string; version: number } | null,
): TutorSimulationParams {
  return {
    goal: v.goal,
    learnerRole: v.learnerRole,
    tutorRole: v.tutorRole,
    context: memoryRef
      ? { source: "call_memory", callMemoryGroupId: memoryRef.groupId, version: memoryRef.version }
      : { source: "none" },
  };
}

// Structural verification of the engine's simulation echo (contract §1: the
// 201 response echoes the simulation block — "verify it before connecting").
// A truthy-but-unrelated object must NOT pass: goal, both roles and the
// context source have to match what we requested.
export function simulationEchoMatches(sim: TutorSimulationParams, echo: unknown): boolean {
  const e: any = echo;
  if (!e || typeof e !== "object") return false;
  if (e.goal !== sim.goal) return false;
  if (!e.roles || typeof e.roles !== "object") return false;
  if (e.roles.learner !== sim.learnerRole || e.roles.tutor !== sim.tutorRole) return false;
  const src = e.context && typeof e.context === "object" ? e.context.source : null;
  if (src !== sim.context.source) return false;
  if (sim.context.source === "call_memory") {
    if (e.context.call_memory_group_id !== sim.context.callMemoryGroupId) return false;
    if (e.context.version !== sim.context.version) return false;
  }
  return true;
}

// Fail-closed mapping of every engine simulation-create error code to an
// explicit HTTP response. NO code here ever results in a practice fallback.
export function mapSimulationEngineError(code: SimulationErrorCode): { status: number; error: string; message: string } {
  switch (code) {
    case "SIMULATION_NOT_ALLOWED_FOR_MODE":
      return { status: 502, error: "simulation_not_allowed_for_mode", message: "Движок отклонил запрос симуляции (несовместимый режим). Сообщите об этой ошибке." };
    case "SIMULATION_REQUIRED":
      return { status: 502, error: "simulation_required", message: "Движок не получил параметры симуляции. Сообщите об этой ошибке." };
    case "SIMULATION_INVALID":
      return { status: 422, error: "simulation_invalid", message: "Движок отклонил цель или роли. Проверьте текст и попробуйте снова." };
    case "CALL_MEMORY_DISABLED":
      return { status: 403, error: "call_memory_disabled", message: "Память разговора отключена для этого подключения к движку." };
    case "CALL_MEMORY_NOT_FOUND":
      return { status: 404, error: "call_memory_not_found", message: "Движок не нашёл эту память разговора. Начните без контекста." };
    case "CALL_MEMORY_NOT_CONFIRMED":
      return { status: 409, error: "call_memory_not_confirmed", message: "Эта версия памяти не подтверждена на стороне движка. Начните без контекста." };
  }
}
