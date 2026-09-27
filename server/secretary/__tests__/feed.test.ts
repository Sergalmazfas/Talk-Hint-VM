import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import {
  buildSecretaryFeedSnapshot,
  publishSecretaryFeedEvent,
  sendSecretaryFeedSnapshot,
  subscribeSecretaryFeed,
} from "../feed";
import { toSecretaryTaskReport } from "../tasks";

describe("Secretary feed task isolation", () => {
  let server: WebSocketServer | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it("uses the nested authoritative task snapshot contract", () => {
    const task = toSecretaryTaskReport({
      id: "task-one",
      mode: "live",
      phoneNumber: "+19545551234",
      instruction: "Check a return.",
      status: "completed",
      outcome: "resolved",
      summary: "Resolved.",
      verifiedFacts: [],
      nextStep: null,
      transcript: "Secretary: I am an AI assistant.",
      callSid: "CA123",
      callId: "call-1",
      createdAt: new Date("2026-05-21T18:00:00.000Z"),
      updatedAt: new Date("2026-05-21T18:05:00.000Z"),
    } as any);
    const snapshot = buildSecretaryFeedSnapshot(task);
    expect(snapshot).toEqual({ type: "snapshot", task });
    expect(snapshot.task).toMatchObject({
      id: "task-one",
      mode: "live",
      status: "completed",
      transcript: "Secretary: I am an AI assistant.",
    });
  });

  it("sends live events only to subscribers of that task", async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const port = (server.address() as any).port;
    server.on("connection", (socket, request) => {
      subscribeSecretaryFeed(request.url === "/one" ? "task-one" : "task-two", socket);
    });
    const first = new WebSocket(`ws://127.0.0.1:${port}/one`);
    const second = new WebSocket(`ws://127.0.0.1:${port}/two`);
    const opened = (socket: WebSocket) => new Promise<void>((resolve) => socket.once("open", () => resolve()));
    await Promise.all([opened(first), opened(second)]);
    const message = vi.fn();
    const otherMessage = vi.fn();
    first.on("message", message);
    second.on("message", otherMessage);
    publishSecretaryFeedEvent("task-one", { type: "turn", role: "guest", text: "private turn" });
    publishSecretaryFeedEvent("task-one", { type: "status", status: "unknown" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(message).toHaveBeenCalledTimes(2);
    expect(otherMessage).not.toHaveBeenCalled();
    expect(message.mock.calls[0][0].toString()).toContain("private turn");
    expect(message.mock.calls[1][0].toString()).toContain('"status":"unknown"');
    first.close();
    second.close();
  });

  it("buffers events between subscription and snapshot, then flushes in order", async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const port = (server.address() as any).port;
    let peer: WebSocket | undefined;
    server.on("connection", (socket) => {
      peer = socket;
      subscribeSecretaryFeed("task-handoff", socket, true);
    });
    const client = new WebSocket(`ws://127.0.0.1:${port}/handoff`);
    await new Promise<void>((resolve) => client.once("open", resolve));
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const messages: string[] = [];
    client.on("message", (data) => messages.push(data.toString()));
    publishSecretaryFeedEvent("task-handoff", { type: "turn", role: "guest", text: "persisted during snapshot read" });
    expect(messages).toEqual([]);
    expect(sendSecretaryFeedSnapshot("task-handoff", peer!, {
      type: "snapshot",
      task: { status: "connected", transcript: "Other party: persisted during snapshot read" },
    })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('"type":"snapshot"');
    expect(messages[1]).toContain("persisted during snapshot read");
    client.close();
  });
});