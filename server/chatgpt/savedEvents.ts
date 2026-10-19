import type { SecretaryTask } from "@shared/schema";

type SavedTask = Pick<SecretaryTask, "createdAt" | "updatedAt" | "dialStartedAt" |
  "streamEndedAt" | "attemptHistory" | "status" | "providerStatus">;
export interface SavedTaskEvent {
  type: "task_created" | "dial_attempt" | "stream_ended" | "state_snapshot";
  at: string;
  attempt?: number;
  status?: string;
  providerStatus?: string | null;
}
/** Projects existing durable fields; never invents a full status-transition log. */
export function savedTaskEvents(task: SavedTask): SavedTaskEvent[] {
  const events: SavedTaskEvent[] = [];
  const add = (type: SavedTaskEvent["type"], value: unknown, fields = {}) => {
    if (!(value instanceof Date) && typeof value !== "string") return;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return;
    events.push({ type, at: date.toISOString(), ...fields });
  };
  add("task_created", task.createdAt);
  const attempts = Array.isArray(task.attemptHistory) ? task.attemptHistory : [];
  if (attempts.length) attempts.forEach((at, i) => add("dial_attempt", at, { attempt: i + 1 }));
  else if (task.dialStartedAt) add("dial_attempt", task.dialStartedAt, { attempt: 1 });
  add("stream_ended", task.streamEndedAt);
  add("state_snapshot", task.updatedAt, { status: task.status, providerStatus: task.providerStatus });
  return events.sort((a, b) => a.at.localeCompare(b.at));
}
