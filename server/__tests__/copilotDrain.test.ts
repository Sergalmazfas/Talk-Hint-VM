import { EventEmitter } from "node:events";
import { it, expect, vi } from "vitest";
const f = vi.hoisted(() => ({ start: vi.fn() }));
// Only this isolated test simulates a session admitted before freeze/shutdown.
vi.mock("../copilotFreeze", async original => ({
  ...await original<typeof import("../copilotFreeze")>(), copilotEnabled: () => true,
}));
vi.mock("../translation/openaiRealtimeTranslator", () => ({
  openaiRealtimeTranslationProvider: { startSession: f.start },
}));
import { createCopilotStream } from "../copilotStream";
import { stopActiveCopilotSessions } from "../copilotFreeze";
it("cancels sessions resolving after shutdown, never publishing late output", async () => {
  class Socket extends EventEmitter {
    OPEN = 1; readyState = 1; frames: any[] = [];
    send(text: string) { this.frames.push(JSON.parse(text)); }
    close = vi.fn(() => { this.readyState = 3; this.emit("close"); });
  }
  const resolvers: Array<(session: any) => void> = [];
  f.start.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)));
  const ws = new Socket();
  createCopilotStream(ws as any, "owner", async () => true);
  const start = ws.listeners("message")[0](Buffer.from(JSON.stringify({
    type: "start", callSid: "CA" + "1".repeat(32), language: "ru", sampleRateHz: 24000,
  })));
  await vi.waitFor(() => expect(resolvers).toHaveLength(2));
  stopActiveCopilotSessions();
  const sessions = resolvers.map(() => ({ cancel: vi.fn(), onEvent: vi.fn(), sendAudio: vi.fn() }));
  resolvers.forEach((resolve, i) => resolve(sessions[i]));
  await start;
  for (const session of sessions) {
    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(session.onEvent).not.toHaveBeenCalled();
  }
  expect(ws.frames).toEqual([expect.objectContaining({ code: "COPILOT_DISABLED" })]);
});
