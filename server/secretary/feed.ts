import WebSocket from "ws";
import type { SecretaryTaskReport } from "./tasks";
import type { SubtitleUnavailableReason } from "../translation/textSubtitle";

export type SecretaryFeedEvent =
  | { type: "turn"; turnId: string; role: "secretary" | "guest"; text: string }
  | { type: "subtitle"; turnId: string; translation: string; language: "ru" | "es" }
  | { type: "subtitle_unavailable"; turnId: string; role: "secretary" | "guest"; language: "ru" | "es"; reason: SubtitleUnavailableReason }
  | { type: "audio"; role: "secretary" | "guest"; payload: string }
  | { type: "status"; status: string };

const MAX_FEED_BUFFER_BYTES = 512 * 1024;
const MAX_PENDING_HANDOFF_BYTES = 256 * 1024;
const subscribers = new Map<string, Set<SecretaryFeedSubscriber>>();

interface SecretaryFeedSubscriber {
  socket: WebSocket;
  waitingForSnapshot: boolean;
  pending: string[];
  pendingBytes: number;
}

export function buildSecretaryFeedSnapshot(task: SecretaryTaskReport) {
  return { type: "snapshot" as const, task };
}

export function subscribeSecretaryFeed(
  taskId: string,
  socket: WebSocket,
  waitForSnapshot = false,
): () => void {
  const subscriber: SecretaryFeedSubscriber = {
    socket,
    waitingForSnapshot: waitForSnapshot,
    pending: [],
    pendingBytes: 0,
  };
  const subscribersForTask = subscribers.get(taskId) ?? new Set<SecretaryFeedSubscriber>();
  subscribersForTask.add(subscriber);
  subscribers.set(taskId, subscribersForTask);
  socket.once("close", remove);
  socket.once("error", remove);
  return remove;
  function remove() {
    socket.off("close", remove);
    socket.off("error", remove);
    subscribersForTask.delete(subscriber);
    if (!subscribersForTask.size) subscribers.delete(taskId);
  }
}

/** Send the initial snapshot, then release events buffered during its DB read. */
export function sendSecretaryFeedSnapshot(
  taskId: string,
  socket: WebSocket,
  snapshot: object,
): boolean {
  const subscriber = Array.from(subscribers.get(taskId) ?? [])
    .find((entry) => entry.socket === socket);
  if (!subscriber) return false;
  if (!send(subscriber, JSON.stringify(snapshot))) return false;
  if (subscriber.waitingForSnapshot) {
    subscriber.waitingForSnapshot = false;
    const pending = subscriber.pending.splice(0);
    subscriber.pendingBytes = 0;
    for (const event of pending) {
      if (!send(subscriber, event)) return false;
    }
  }
  return true;
}

export function publishSecretaryFeedEvent(taskId: string, event: SecretaryFeedEvent): void {
  const data = JSON.stringify(event);
  const recipients = subscribers.get(taskId);
  if (!recipients) return;
  const bytes = Buffer.byteLength(data);
  for (const subscriber of Array.from(recipients)) {
    if (subscriber.waitingForSnapshot) {
      if (subscriber.pendingBytes + bytes > MAX_PENDING_HANDOFF_BYTES) {
        subscriber.socket.close(1013, "Secretary feed handoff is too large");
        continue;
      }
      subscriber.pending.push(data);
      subscriber.pendingBytes += bytes;
      continue;
    }
    send(subscriber, data);
  }
}

function send(subscriber: SecretaryFeedSubscriber, data: string): boolean {
  const { socket } = subscriber;
  if (socket.readyState !== WebSocket.OPEN) return false;
  if (socket.bufferedAmount + Buffer.byteLength(data) > MAX_FEED_BUFFER_BYTES) {
    socket.close(1013, "Secretary feed is too slow");
    return false;
  }
  socket.send(data);
  return true;
}