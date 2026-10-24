/** Opt-in, paid Dev provider probes. No phone, microphone, playback or real
 * tools. Temporarily owns Dev port 5000 for the actual public Custom LLM
 * callback. Outputs reports only to the EXISTING comparison repository.
 * Generated fixture PCM/results are gitignored. Run --run explicitly. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { WebSocketConnection } from "../node_modules/@elevenlabs/client/dist/utils/WebSocketConnection.js";
import { dbReady, pool } from "../server/db";
import { ElevenEngineLab } from "../server/secretaryLab/elevenEngine";
import { PgComparisonRepository } from "../server/secretaryLab/comparisonStore";
import { ELEVEN_CATALOG } from "../server/secretaryLab/elevenApi";
import { upgradeElevenAudio } from "../server/secretaryLab/elevenAudioUpgrade";
import { elevenProfiles, type ElevenProfileId } from "../shared/elevenLabProfiles";

assert(process.argv.includes("--run"), "Pass --run to opt into provider usage");
assert(process.env.NODE_ENV === "development" && process.env.REPLIT_DEPLOYMENT !== "1", "Dev only");
await dbReady;
assert(pool, "Dev DB required");
const store = new PgComparisonRepository(pool);
const { rows } = await pool.query("SELECT owner_id FROM secretary_lab_comparisons WHERE expires_at>now() ORDER BY created_at DESC LIMIT 1");
assert(rows[0], "Existing opted-in lab owner required");
const owner = rows[0].owner_id;
const out = "generated-artifacts/eleven-latency";
await mkdir(out, { recursive: true });
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
async function pcm(name: string, text: string) {
  try { return await readFile(`${out}/${name}.pcm`); } catch {}
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_CATALOG.voiceId}?output_format=pcm_16000`, {
    method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }), signal: AbortSignal.timeout(30_000),
  });
  assert(r.ok, `Fixture synthesis failed HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer()); await writeFile(`${out}/${name}.pcm`, b); return b;
}
const texts = [
  "Hello. Please say briefly what you can help with in this test.",
  "Теперь отвечай по-русски. Скажи коротко, чем ты можешь помочь в этом тесте.",
  "Ahora responde en español. Dime brevemente qué puedes hacer en esta prueba.",
];
const fixtures = await Promise.all(texts.map((t, i) => pcm(`language-${i}`, t)));
const pauseFixture = Buffer.concat([
  await pcm("pause-a", "My number is three zero five."),
  Buffer.alloc(32_000), // One second of deliberate hesitation, not endpoint truth.
  await pcm("pause-b", "Two one seven. No, correction, two one eight. Nine zero zero zero. The address is twenty Ocean Drive."),
]);
const lab = new ElevenEngineLab(store);
const app = express(); app.use(express.json({ limit: "128kb" }));
app.post("/eleven-engine-llm/:capability/v1/chat/completions", (req, res) => {
  void lab.completion(req.params.capability, req, res).catch(() => { if (!res.headersSent) res.sendStatus(503); else res.end(); });
});
const server = createServer(app), wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => void upgradeElevenAudio(req, socket, head, { server: wss, runtime: async () => lab, environment: "development" }));
await new Promise<void>(r => server.listen(5000, "0.0.0.0", r));
const oldSocket = globalThis.WebSocket;
Object.assign(globalThis, { WebSocket });
const results: any[] = [];
const resultsPath = `${out}/results-${Date.now()}.json`;
const selected = (process.env.ELEVEN_PROBE_PROFILES?.split(",") ?? Object.keys(elevenProfiles)) as ElevenProfileId[];
try {
  for (const profileId of selected) {
    assert(profileId in elevenProfiles);
    const id = randomUUID();
    let sdk: WebSocketConnection | undefined, heartbeat: NodeJS.Timeout | undefined;
    const observations: any[] = [];
    try {
      const admission = await lab.create(owner, { clientRequestId: id, voice: "catalog", profileId, consent: true,
        instruction: "You are in a synthetic TEST only. Follow the speaker's English, Russian or Spanish. Answer the question briefly. " +
          "On an explicit request save a TEST message with save_test_message; never deliver, call, notify or book anything real." });
      heartbeat = setInterval(() => { void lab.report(owner, id).catch(() => undefined); }, 5000);
      sdk = await WebSocketConnection.create({ signedUrl: `ws://127.0.0.1:5000${admission.websocketPath}` });
      let audioAt = 0, audioCount = 0, responses = 0;
      sdk.addListener((event: any) => {
        if (event.audio_base_64) { audioAt = Date.now(); audioCount++; }
      });
      sdk.onMessage((event: any) => {
        if (event.type === "agent_response") responses++;
        if (event.type === "ping") sdk!.sendMessage({ type: "pong", event_id: event.ping_event.event_id });
      });
      const waitSpeech = async (beforeAudio: number, beforeResponse: number) => {
        const start = Date.now();
        while (Date.now() - start < 35_000) {
          if (audioCount > beforeAudio && responses > beforeResponse && Date.now() - audioAt > 1400) return;
          await delay(150);
        }
        throw Error("No completed provider speech within 35s");
      };
      // Same text requests isolate Engine + provider synthesis from ASR.
      for (const text of texts) {
        const a = audioCount, b = responses;
        sdk.sendMessage({ type: "user_message", text });
        await waitSpeech(a, b);
      }
      // Real-time paced synthetic speech exercises ASR and language switching.
      // No inference about human/iPhone intelligibility or naturalness.
      if (["baseline", "optimized", "eager"].includes(profileId)) {
        const audios = profileId === "eager" ? [pauseFixture] : fixtures;
        for (const audio of audios) {
          const a = audioCount, b = responses;
          const before = (await lab.report(owner, id)).report;
          const started = Date.now() - Date.parse(before.createdAt as string);
          for (let n = 0; n < audio.length; n += 640) {
            sdk.sendMessage({ user_audio_chunk: audio.subarray(n, n + 640).toString("base64") });
            await delay(20);
          }
          const inputEnded = Date.now() - Date.parse(before.createdAt as string);
          // Silence allows EOT; it is explicitly NOT an acoustic measurement.
          for (let n = 0; n < 100; n++) { sdk.sendMessage({ user_audio_chunk: Buffer.alloc(640).toString("base64") }); await delay(20); }
          try { await waitSpeech(a, b); } catch { observations.push({ type: "synthetic_audio_no_response", started, inputEnded }); continue; }
          const after = (await lab.report(owner, id)).report;
          observations.push({ type: profileId === "eager" ? "synthetic_pause_number_address" : "synthetic_language",
            inputStartedMs: started, lastInputChunkSentMs: inputEnded,
            note: "Source transport timestamps, NOT physical speech-end or human listening.",
            engineRequestedBeforeFixtureEnded: ((after.timings as any[]) ?? []).some(t => t.requestReceivedMs >= started && t.requestReceivedMs < inputEnded) });
        }
      }
      const a = audioCount, b = responses;
      sdk.sendMessage({ type: "user_message", text: "Explicit TEST confirmation: save a message from Alex TEST saying meet at Ocean TEST tomorrow at 14:00. Use save_test_message, no delivery." });
      await waitSpeech(a, b);
      const saved = (await lab.report(owner, id)).report;
      const count = (saved.engine as any).actions.length;
      const c = audioCount, d = responses;
      sdk.sendMessage({ type: "user_message", text: "Repeat the same save_test_message with exactly the same sender and message. Do not create another action." });
      await waitSpeech(c, d);
      const reread = (await lab.report(owner, id)).report;
      assert.equal((reread.engine as any).actions.length, count, "Duplicate TEST action");
      assert(count > 0, "No TEST result actually saved");
      assert((reread.engine as any).actions.every((a: any) => !a.result.delivered && !a.result.calendarWritten));
      await lab.stop(owner, id);
      const fromNewProcess = JSON.parse(execFileSync(process.execPath,
        ["--import", "tsx", "scripts/probe-eleven-engine.ts", "--read", id],
        { encoding: "utf8", timeout: 25_000 }).trim().split("\n").at(-1)!);
      const run = fromNewProcess.runs[0];
      assert.equal(run.profileId, profileId); assert(run.timings.length);
      results.push({ profileId, id, configuration: run.configuration, timings: run.timings, observations,
        result: "provider_audio_received; TEST_result_reread_new_process", testActions: (run.engine as any).actions,
        turns: run.turns, physicalPlaybackOrMicrophoneTested: false, subjectiveRating: null });
      console.log(JSON.stringify({ profileId, id, turns: run.timings.length, result: "ok", observations }));
    } catch (e) {
      const report = await lab.report(owner, id).catch(() => undefined);
      results.push({ profileId, id, error: e instanceof Error ? e.message : "probe failed", observations,
        configuration: report?.report.configuration, timings: report?.report.timings, events: report?.report.events,
        reason: report?.report.reason, turns: report?.report.turns });
      console.log(JSON.stringify({ profileId, id, result: "failed", error: e instanceof Error ? e.message : "probe failed" }));
    } finally {
      clearInterval(heartbeat); await lab.stop(owner, id).catch(() => undefined); sdk?.close();
    }
    // Canonical fixture observations belong to the same shared report, not
    // just the gitignored convenience summary. Keep original expiry/consent.
    const archived = await store.get(id);
    if (archived) await store.checkpoint(owner, id, {
      title: archived.title, instruction: archived.instruction, evaluation: archived.evaluation,
      runs: archived.runs.map(run => ({ ...run, syntheticProbe: {
        observations, physicalPlaybackTested: false, microphoneOpened: false,
        testType: "provider API + paced synthetic PCM; not human listening",
      } })),
    });
    await writeFile(resultsPath, JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2));
  }
} finally {
  lab.dispose(); Object.assign(globalThis, { WebSocket: oldSocket });
  for (const ws of wss.clients) ws.terminate(); wss.close();
  server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
  await pool.end();
}
if (results.some(r => r.error)) process.exitCode = 1;
