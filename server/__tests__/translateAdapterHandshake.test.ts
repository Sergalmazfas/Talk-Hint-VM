// Bounded handshake tests for the gpt-realtime-translate adapter (code
// review finding): startSession must NEVER hang forever when the server
// accepts the socket but never sends session.updated, and the socket must be
// torn down on failure.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocketServer } from "ws";
import { OpenAIRealtimeTranslateSession } from "../translation/openaiRealtimeTranslateAdapter";

const config = {
  languages: ["ru", "en"] as [string, string],
  outputLanguage: "en",
  inputFormat: { encoding: "pcm16" as const, sampleRateHz: 24000 },
  outputFormat: { encoding: "pcm16" as const, sampleRateHz: 24000 },
};

describe("gpt-realtime-translate connect handshake (fake server)", () => {
  let silentServer: WebSocketServer;
  let silentUrl: string;
  let serverConnections = 0;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-key";
    silentServer = new WebSocketServer({ port: 0 });
    silentServer.on("connection", () => {
      serverConnections++;
      // Accept the socket, then say NOTHING — the stalled-handshake case.
    });
    await new Promise<void>((r) => silentServer.on("listening", () => r()));
    silentUrl = `ws://127.0.0.1:${(silentServer.address() as any).port}`;
  });

  afterAll(() => {
    silentServer.close();
  });

  it("times out (bounded) when session.updated never arrives, and closes the socket", async () => {
    const s = new OpenAIRealtimeTranslateSession(config, {
      url: silentUrl,
      handshakeTimeoutMs: 300,
    });
    const t0 = Date.now();
    await expect(s.connect()).rejects.toThrow(/handshake timed out/);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(serverConnections).toBe(1);
    // server should observe the client socket closing
    await new Promise((r) => setTimeout(r, 200));
    for (const c of silentServer.clients) expect(c.readyState).not.toBe(1);
  });

  it("rejects promptly when the server closes the socket before session.updated", async () => {
    const closer = new WebSocketServer({ port: 0 });
    closer.on("connection", (ws) => ws.close());
    await new Promise<void>((r) => closer.on("listening", () => r()));
    const url = `ws://127.0.0.1:${(closer.address() as any).port}`;
    const s = new OpenAIRealtimeTranslateSession(config, { url, handshakeTimeoutMs: 2000 });
    await expect(s.connect()).rejects.toThrow();
    closer.close();
  });

  it("preserves the provider error when the handshake fails", async () => {
    const errorServer = new WebSocketServer({ port: 0 });
    errorServer.on("connection", (ws) => {
      ws.send(JSON.stringify({
        type: "error",
        error: {
          type: "insufficient_quota",
          code: "credit_balance_exhausted",
          message: "You have no credits remaining.",
        },
      }));
      ws.close();
    });
    await new Promise<void>((r) => errorServer.on("listening", () => r()));
    const url = `ws://127.0.0.1:${(errorServer.address() as any).port}`;
    const s = new OpenAIRealtimeTranslateSession(config, { url, handshakeTimeoutMs: 2000 });
    await expect(s.connect()).rejects.toThrow(/credit_balance_exhausted/);
    errorServer.close();
  });

  it("rejects with a connection error for an unreachable server", async () => {
    const s = new OpenAIRealtimeTranslateSession(config, {
      url: "ws://127.0.0.1:1",
      handshakeTimeoutMs: 2000,
    });
    await expect(s.connect()).rejects.toThrow();
  });
});
