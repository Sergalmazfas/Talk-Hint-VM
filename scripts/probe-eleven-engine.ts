/** Explicit opt-in Dev probes. --paid-text tests Engine/DB; --audio-connect
 * tests the installed SDK transport against ElevenLabs. Never dials, opens a
 * microphone, plays speech or sends notifications. */
import { randomUUID } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { dbReady, pool } from "../server/db";
import { ElevenEngineLab } from "../server/secretaryLab/elevenEngine";
import { ElevenLabApi } from "../server/secretaryLab/elevenApi";
import { PgComparisonRepository } from "../server/secretaryLab/comparisonStore";
import { WebSocket, WebSocketServer } from "ws";
import { WebSocketConnection } from "../node_modules/@elevenlabs/client/dist/utils/WebSocketConnection.js";
import { upgradeElevenAudio } from "../server/secretaryLab/elevenAudioUpgrade";

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1")
  throw new Error("Dev only");
await dbReady;
if (!pool) throw new Error("No Dev DB");
const store = new PgComparisonRepository(pool);
if (process.argv[2] === "--read") {
  const saved = await store.get(process.argv[3]);
  assert(saved); console.log(JSON.stringify({ readFromNewProcess: true, id: saved.id, runs: saved.runs }));
  await pool.end(); process.exit(0);
}
const audioProbe = process.argv[2] === "--audio-connect";
if (!audioProbe && process.argv[2] !== "--paid-text") throw new Error("Pass --paid-text or --audio-connect explicitly");
// Existing owner's explicit opt-in archive: do not create a second result store or a new user.
const { rows } = await pool.query("SELECT user_id FROM voice_lab_clones WHERE status='ready' LIMIT 1");
assert(rows[0], "An existing owner binding is required");
const owner = rows[0].user_id as string;
class ProbeApi extends ElevenLabApi {
  cap = "";
  async create(voice: string, cap: string, id: string) { this.cap = cap; return super.create(voice, cap, id); }
}
const api = new ProbeApi();
const lab = new ElevenEngineLab(store, api);
const app = express(); app.use(express.json({ limit: "128kb" }));
app.post("/test", async (req, res) => {
  try { await lab.completion(api.cap, req, res); } catch { if (!res.headersSent) res.sendStatus(503); else res.end(); }
});
const server = createServer(app);
const audioServer = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => void upgradeElevenAudio(req, socket, head, {
  server: audioServer, runtime: async () => lab, environment: process.env.NODE_ENV,
}));
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(server.address() as any).port}/test`;
const id = randomUUID();
try {
  const admission = await lab.create(owner, { clientRequestId: id, voice: "catalog", consent: true,
    instruction: "Это синтетическая TEST-проверка сохранения. По явной просьбе собеседника сохрани сообщение инструментом save_test_message. Никакой реальной доставки и календаря." });
  if (audioProbe) {
    // Same installed SDK URL construction as browser, but WITHOUT requesting
    // microphone or constructing VoiceConversation/AudioContext.
    const previousSocket = globalThis.WebSocket;
    Object.assign(globalThis, { WebSocket });
    let sdk: WebSocketConnection | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      sdk = await Promise.race([
        WebSocketConnection.create({ signedUrl: url.replace("http:", "ws:").replace("/test", admission.websocketPath) }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Provider metadata timed out")), 20_000); }),
      ]);
      assert(sdk.conversationId);
      const connected = await lab.report(owner, id);
      assert.equal(connected.report.status, "live");
      assert((connected.report.events as any[]).some(e => e.type === "audio_connected"));
      console.log(JSON.stringify({ id, installedSdkConnected: true, providerMetadataReceived: true,
        inputFormat: sdk.inputFormat, outputFormat: sdk.outputFormat, microphoneOpened: false,
        speechPlayed: false, phoneCallPlaced: false }));
    } finally {
      clearTimeout(timer); sdk?.close(); Object.assign(globalThis, { WebSocket: previousSocket });
    }
  } else {
  const body = { stream: true, messages: [{ role: "user", content:
    "Сохрани TEST-сообщение от Alex TEST: встреча Ocean TEST, 2 ноября 2026 в 14:00, America/New_York. Используй save_test_message. Это явное подтверждение сохранения только в тесте, без отправки." }] };
  const first = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(35_000) });
  const text = await first.text(); assert.equal(first.status, 200); assert(text.includes("[DONE]"), "No completed stream");
  const second = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(35_000) });
  assert((await second.text()).includes("[DONE]"));
  await lab.stop(owner, id);
  const saved = await store.get(id); assert(saved);
  const actions = (saved.runs[0].engine as any).actions;
  assert.equal(actions.length, 1); assert.equal(actions[0].result.calendarWritten, false);
  assert.equal(actions[0].result.delivered, false);
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/probe-eleven-engine.ts", "--read", id],
    { encoding: "utf8", timeout: 25_000 });
  const reRead = JSON.parse(output.trim().split("\n").at(-1)!);
  assert.equal(reRead.id, id);
  assert.equal(reRead.runs[0].engine.actions.length, 1);
  console.log(JSON.stringify({ id, model: saved.runs[0].model, voice: saved.runs[0].voice,
    ttsModel: saved.runs[0].ttsModel, testAction: actions[0], readFromNewProcess: true,
    duplicateRequestActionCount: actions.length, voiceConversationStarted: false,
    acousticOrInterruptionQualityVerified: false, archivePath: "/admin/secretary-lab?stand=eleven-engine#saved-comparisons" }));
  }
} finally {
  await lab.stop(owner, id).catch(() => undefined); lab.dispose();
  audioServer.clients.forEach(ws => ws.terminate()); audioServer.close();
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}
