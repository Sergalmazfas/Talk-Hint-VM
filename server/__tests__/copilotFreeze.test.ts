import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import express from "express";
import { describe, it, expect, vi } from "vitest";
const f = vi.hoisted(() => ({ start: vi.fn(), auth: vi.fn(), speech: vi.fn() }));
vi.mock("../translation/openaiRealtimeTranslator", () => ({
  openaiRealtimeTranslationProvider: { startSession: f.start },
}));
vi.mock("../auth", () => ({ authMiddleware: f.auth }));
vi.mock("../voiceLab/providers", () => ({
  CartesiaProvider: class { streamSpeech = f.speech; },
  ElevenLabsProvider: class { streamSpeech = f.speech; },
}));
import { copilotEnabled, registerCopilotCleanup, stopActiveCopilotSessions } from "../copilotFreeze";
import { createCopilotStream } from "../copilotStream";
import { registerCopilotSpeechRoute } from "../copilotSpeech";
import { handleCopilotBenchStream } from "../translation/copilotBench";
import { registerTranslatorSpike } from "../translation/spike";

class Socket extends EventEmitter {
  OPEN = 1; readyState = 1; frames: any[] = [];
  send(text: string) { this.frames.push(JSON.parse(text)); }
  close = vi.fn(() => { this.readyState = 3; this.emit("close"); });
}
describe("Owner freeze: all Copilot entries are unavailable without paid operations", () => {
  it("rejects working and bench sockets before authorization, listeners or providers", () => {
    expect(copilotEnabled()).toBe(false);
    const authorize = vi.fn();
    for (const factory of [(ws: any) => createCopilotStream(ws, "owner", authorize), handleCopilotBenchStream]) {
      const ws = new Socket();
      factory(ws as any);
      expect(ws.frames).toEqual([expect.objectContaining({ code: "COPILOT_DISABLED", fatal: true })]);
      expect(ws.close).toHaveBeenCalledWith(1008, "COPILOT_DISABLED");
      expect(ws.listenerCount("message")).toBe(0);
    }
    expect(authorize).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
  });
  it("returns HTTP 410 for speech and bench page with zero provider/auth calls", async () => {
    const app = express(); app.use(express.json());
    registerCopilotSpeechRoute(app); registerTranslatorSpike(app);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as any).port;
    try {
      const speech = await fetch(`http://127.0.0.1:${port}/api/copilot/clone-speech`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      expect(speech.status).toBe(410);
      expect(await speech.json()).toMatchObject({ error: "COPILOT_DISABLED" });
      const page = await fetch(`http://127.0.0.1:${port}/translator-spike/copilot`);
      expect(page.status).toBe(410);
      expect(await page.text()).toContain("Copilot is unavailable");
      expect(f.auth).not.toHaveBeenCalled();
      expect(f.speech).not.toHaveBeenCalled();
      expect(f.start).not.toHaveBeenCalled();
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it("drains all active cleanup handles exactly once, including after one fails", () => {
    const abort = new AbortController(), cancel = vi.fn();
    registerCopilotCleanup(() => { throw Error("socket closed"); });
    registerCopilotCleanup(() => abort.abort());
    registerCopilotCleanup(cancel);
    stopActiveCopilotSessions(); stopActiveCopilotSessions();
    expect(abort.signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("blocks signed dialing, accepted incoming Copilot and WS upgrades before normal routing", () => {
    const routes = readFileSync("server/routes.ts", "utf8");
    const voice = routes.slice(routes.indexOf('const copilotRequested ='));
    expect(voice.indexOf("!copilotEnabled()")).toBeLessThan(voice.indexOf("const timestamp"));
    expect(voice.slice(0, voice.indexOf("const timestamp"))).toContain("unavailable.hangup()");
    const accept = routes.slice(routes.indexOf('app.post("/api/call/accept"'));
    expect(accept.indexOf('req.body?.clientType === "ios_copilot"')).toBeLessThan(accept.indexOf("const user ="));
    expect(routes).toContain('!copilotEnabled() && pendingCall.clientType === "ios_copilot"');
    const ws = readFileSync("server/websocket.ts", "utf8");
    expect(ws).toContain('pathname === "/copilot-stream" || pathname === "/copilot-bench-stream"');
    expect(ws).toContain("ws => rejectCopilotSocket(ws)");
    expect(readFileSync("server/index.ts", "utf8")).toContain("stopActiveCopilotSessions();");
  });
});
