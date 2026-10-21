import { createServer, type Server } from "node:http";
import express from "express";
import request from "supertest";
import WebSocket, { WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SecretaryLab } from "./service";
import { handleSecretaryLabSocket, registerSecretaryLabRoutes } from "./routes";

vi.mock("../auth", () => ({
  authMiddleware: (req: any, res: any, next: () => void) => {
    const token = req.headers.authorization;
    if (!["Bearer alice", "Bearer bob", "Bearer ordinary"].includes(token)) {
      return res.status(401).json({ error: "Authentication required" });
    }
    req.user = { id: token.split(" ")[1], email: token === "Bearer ordinary" ? "normal@example.test" : "admin@example.test" };
    next();
  },
}));
const input = { instruction: "Ask for the status of the pending case.", voiceProvider: "elevenlabs", consent: true };
describe("Secretary Lab HTTP and WebSocket boundaries", () => {
  let app: express.Express, server: Server, wss: WebSocketServer, lab: SecretaryLab, port: number;
  const clients: WebSocket[] = [];
  const engine = vi.fn();
  beforeEach(async () => {
    vi.stubEnv("BENCHMARK_ADMIN_EMAILS", "admin@example.test");
    engine.mockReset();
    lab = new SecretaryLab({
      startEngine: (peer, deps) => {
        engine();
        peer.on("message", raw => {
          const data = JSON.parse(raw.toString());
          if (data.event === "start") deps.onDiagnostic?.("realtime_ready");
          if (data.event === "stop") void deps.onStreamEnd("fixture");
        });
      },
      context: async (ownerId, voiceProvider) => ({ ownerId, voiceProvider, cloneVoiceId: "not-exposed" }),
      translate: async () => ({ translation: "тест" }),
    });
    app = express();
    registerSecretaryLabRoutes(app, lab, async owner => ({ sessions: lab.reports(owner) }));
    server = createServer(app);
    wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
    server.on("upgrade", (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, ws => handleSecretaryLabSocket(ws, req, lab));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as any).port;
  });
  afterEach(async () => {
    clients.splice(0).forEach(ws => ws.terminate());
    for (const owner of ["alice", "bob"]) {
      await Promise.all(lab.reports(owner).map(report => lab.stop(owner, report.id)));
    }
    wss.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.unstubAllEnvs();
  });
  const create = () => request(app).post("/api/admin/secretary-lab/sessions").set("Authorization", "Bearer alice").send(input);
  const connect = (origin?: string, path = "/secretary-lab-stream") => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: origin ? { Origin: origin } : {} });
    clients.push(ws); return ws;
  };
  const closed = (ws: WebSocket) => new Promise<number>(resolve => ws.once("close", code => resolve(code)));
  it("does not accept arbitrary diagnostic data as a stop reason", async () => {
    const response = await request(app).delete("/api/admin/secretary-lab/sessions/missing")
      .set("Authorization", "Bearer alice").send({ reason: "untrusted-raw-provider-response" });
    expect(response.status).toBe(400);
    expect(engine).not.toHaveBeenCalled();
  });
  it("requires authentication and existing admin allowlist on every HTTP action", async () => {
    expect((await request(app).get("/api/admin/secretary-lab")).status).toBe(401);
    expect((await request(app).get("/api/admin/secretary-lab").set("Authorization", "Bearer ordinary")).status).toBe(403);
    expect((await request(app).post("/api/admin/secretary-lab/sessions").send(input)).status).toBe(401);
    expect((await request(app).delete("/api/admin/secretary-lab/sessions/missing")).status).toBe(401);
    expect((await request(app).post("/api/admin/secretary-lab/sessions/missing/webrtc").send({ sdp: "v=0\r\nm=audio" })).status).toBe(401);
    expect((await request(app).post("/api/admin/secretary-lab/sessions/missing/webrtc")
      .set("Authorization", "Bearer alice").send({ sdp: "v=0\r\nm=audio" })).status).toBe(404);
    expect(engine).not.toHaveBeenCalled();
  });
  it("isolates admin accounts and never returns tickets in history", async () => {
    const created = await create();
    expect(created.status).toBe(201);
    expect(created.body.ticket).toMatch(/^[a-f0-9]{64}$/);
    const mine = await request(app).get("/api/admin/secretary-lab").set("Authorization", "Bearer alice");
    expect(mine.headers["cache-control"]).toBe("no-store");
    expect(mine.body.sessions).toHaveLength(1);
    expect(JSON.stringify(mine.body)).not.toContain(created.body.ticket);
    expect(JSON.stringify(mine.body)).not.toContain("not-exposed");
    const other = await request(app).get("/api/admin/secretary-lab").set("Authorization", "Bearer bob");
    expect(other.body.sessions).toEqual([]);
    expect((await request(app).delete(`/api/admin/secretary-lab/sessions/${created.body.id}`)
      .set("Authorization", "Bearer bob")).status).toBe(404);
    expect(engine).not.toHaveBeenCalled(); // HTTP draft creation alone opens no provider.
  });
  it("rejects lack of consent and telephone parameters before any provider", async () => {
    expect((await request(app).post("/api/admin/secretary-lab/sessions")
      .set("Authorization", "Bearer alice").send({ ...input, consent: false })).status).toBe(400);
    expect((await request(app).post("/api/admin/secretary-lab/sessions")
      .set("Authorization", "Bearer alice").send({ ...input, phoneNumber: "forbidden" })).status).toBe(400);
    expect(engine).not.toHaveBeenCalled();
  });
  it.each([undefined, "null", "https://evil.example"])("rejects missing/opaque/foreign browser origin %s", async origin => {
    const ws = connect(origin);
    expect(await closed(ws)).toBe(1008);
    expect(engine).not.toHaveBeenCalled();
  });
  it("rejects URL tokens and media before first-frame authentication", async () => {
    const origin = `http://127.0.0.1:${port}`;
    expect(await closed(connect(origin, "/secretary-lab-stream?ticket=forbidden"))).toBe(1008);
    const ws = connect(origin);
    const done = closed(ws);
    ws.on("open", () => ws.send(JSON.stringify({ type: "media", payload: "/w==" })));
    expect(await done).toBe(1008);
    expect(engine).not.toHaveBeenCalled();
  });
  it("allows the exact owner capability once, stops on socket loss, does not redial", async () => {
    const created = await create();
    const origin = `http://127.0.0.1:${port}`;
    const ws = connect(origin);
    const ready = new Promise<void>(resolve => ws.on("message", raw => {
      if (JSON.parse(raw.toString()).type === "ready") resolve();
    }));
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", ticket: created.body.ticket })));
    await ready;
    expect(engine).toHaveBeenCalledTimes(1);
    const replay = connect(origin); const replayClosed = closed(replay);
    replay.on("open", () => replay.send(JSON.stringify({ type: "auth", ticket: created.body.ticket })));
    expect(await replayClosed).toBe(1008);
    const disconnected = closed(ws); ws.close(); await disconnected;
    await new Promise(resolve => setImmediate(resolve));
    expect(lab.reports("alice")[0].reason).toBe("browser_disconnected");
    expect(engine).toHaveBeenCalledTimes(1);
  });
  it("refuses oversized WebSocket frames", async () => {
    const ws = connect(`http://127.0.0.1:${port}`);
    const done = closed(ws);
    ws.on("open", () => ws.send("x".repeat(9000)));
    expect(await done).toBe(1009);
    expect(engine).not.toHaveBeenCalled();
  });
});
