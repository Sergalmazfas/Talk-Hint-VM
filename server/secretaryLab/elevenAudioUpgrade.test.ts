import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketConnection } from "../../node_modules/@elevenlabs/client/dist/utils/WebSocketConnection.js";
import { elevenAudioTicket, upgradeElevenAudio } from "./elevenAudioUpgrade";
import { ElevenEngineLab } from "./elevenEngine";
import { ElevenLabApi } from "./elevenApi";
import type { ComparisonRepository } from "./comparisonStore";

afterEach(() => vi.unstubAllGlobals());
const ticket = "a".repeat(64);
describe("Official ElevenLabs SDK audio upgrade compatibility", () => {
  it.each(["", "?source=js_sdk&version=0.16.0", "?version=1.2.3-beta.1&source=js_sdk"])("accepts SDK metadata %s", query => {
    expect(elevenAudioTicket(new URL(`https://dev.test/eleven-engine-audio/${ticket}${query}`), "development")).toBe(ticket);
  });
  it.each(["?token=secret", "?source=js_sdk&source=other", "?version=1&voice_id=other", "?version=", "?environment=production", "?source=a%0Ab"])("rejects unrelated or malformed query %s", query => {
    expect(elevenAudioTicket(new URL(`https://dev.test/eleven-engine-audio/${ticket}${query}`), "development")).toBeUndefined();
  });
  it("keeps production and malformed capabilities blocked", () => {
    expect(elevenAudioTicket(new URL(`https://dev.test/eleven-engine-audio/${ticket}?source=js_sdk&version=1`), "production")).toBeUndefined();
    expect(elevenAudioTicket(new URL("https://dev.test/eleven-engine-audio/missing"), "development")).toBeUndefined();
  });
  it("runs the INSTALLED SDK through the real HTTP upgrade and audio proxy to provider metadata, then closes both sockets", async () => {
    vi.stubGlobal("WebSocket", WebSocket);
    const providerServer = createServer(), appServer = createServer();
    const vendor = new WebSocketServer({ server: providerServer });
    const proxy = new WebSocketServer({ noServer: true });
    await new Promise<void>(r => providerServer.listen(0, "127.0.0.1", r));
    await new Promise<void>(r => appServer.listen(0, "127.0.0.1", r));
    const providerUrl = `ws://127.0.0.1:${(providerServer.address() as any).port}`;
    const localUrl = `ws://127.0.0.1:${(appServer.address() as any).port}`;
    const frames: any[] = [], urls: string[] = [];
    vendor.on("connection", (ws, req) => {
      expect(req.headers["sec-websocket-protocol"]).toBe("convai");
      ws.on("message", raw => {
        frames.push(JSON.parse(raw.toString()));
        ws.send(JSON.stringify({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: {
          conversation_id: "conversation-test", user_input_audio_format: "pcm_16000", agent_output_audio_format: "pcm_16000",
        } }));
      });
    });
    const rows = new Map<string, any>();
    const store = { checkpoint: async (_owner: string, id: string, data: any) => { rows.set(id, data); return data; },
      list: async () => [], get: async (id: string) => rows.get(id) } as unknown as ComparisonRepository;
    class Provider extends ElevenLabApi {
      async request() { return {}; }
      async voice(id: string) { return { voice_id: id, category: "premade", labels: { gender: "female", accent: "american" } }; }
      async create() { return "private-test-agent"; }
      async inspect() {}
      async signedUrl() { return providerUrl; }
      async remove() {}
      socket(url: string) { return new WebSocket(url, ["convai"]); }
    }
    const lab = new ElevenEngineLab(store, new Provider(), async () => null, undefined, () => true, async () => {});
    vi.stubEnv("REPLIT_DEV_DOMAIN", "unit.replit.dev");
    appServer.on("upgrade", (req, socket, head) => {
      urls.push(req.url!);
      void upgradeElevenAudio(req, socket, head, { server: proxy, runtime: async () => lab, environment: "development" });
    });
    let sdk: WebSocketConnection | undefined;
    try {
      const admission = await lab.create("owner", { instruction: "Only TEST conversation.", voice: "catalog", consent: true, clientRequestId: randomUUID() });
      sdk = await WebSocketConnection.create({ signedUrl: `${localUrl}${admission.websocketPath}` });
      expect(urls[0]).toContain("source=js_sdk");
      expect(urls[0]).toContain("version=");
      expect(sdk.conversationId).toBe("conversation-test");
      expect(frames[0]).toEqual({ type: "conversation_initiation_client_data" });
      expect((await lab.report("owner", admission.id)).report.status).toBe("live");
      await lab.stop("owner", admission.id);
      expect(lab.permitsAudio(admission.websocketPath.split("/").at(-1)!)).toBe(false);
      expect(rows.get(admission.id).runs[0].events.map((e: any) => e.type)).toEqual(expect.arrayContaining([
        "browser_audio_socket_connected", "provider_audio_socket_connected", "audio_connected",
      ]));
    } finally {
      sdk?.close(); lab.dispose();
      [...vendor.clients, ...proxy.clients].forEach(ws => ws.terminate());
      proxy.close(); vendor.close();
      await Promise.all([new Promise<void>(r => appServer.close(() => r())), new Promise<void>(r => providerServer.close(() => r()))]);
      vi.unstubAllEnvs();
    }
  }, 10_000);
});
