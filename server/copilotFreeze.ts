import type { WebSocket } from "ws";

/** Owner-approved freeze. No environment/key/admin override; restore only by reviewed code release. */
export function copilotEnabled(): boolean { return false; }
export const COPILOT_DISABLED = "COPILOT_DISABLED";
export const COPILOT_UNAVAILABLE = "Copilot is unavailable. No call or paid Copilot session was started.";

const active = new Set<() => void>();
export function registerCopilotCleanup(stop: () => void): () => void {
  active.add(stop);
  return () => { active.delete(stop); };
}
export function stopActiveCopilotSessions(): void {
  for (const stop of Array.from(active)) {
    try { stop(); } catch { /* One failed socket must not prevent the remaining cancellations. */ }
    finally { active.delete(stop); }
  }
}
export function rejectCopilotSocket(ws: WebSocket): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: "error", code: COPILOT_DISABLED,
      message: "Copilot is unavailable.", fatal: true }));
  }
  ws.close(1008, COPILOT_DISABLED);
}
