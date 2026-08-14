// Admin-only API for the LIVE Ears & Brain Benchmark.
// Mounted from server/routes.ts; every endpoint sits behind requireBenchmarkAdmin.

import type { Express } from "express";
import express from "express";
import { requireBenchmarkAdmin } from "./adminGate";
import {
  runAvailabilityCheck, startEarsRun, startBrainRun,
  getRun, listRuns, listFixtures, getFixture,
} from "./orchestrator";
import { ensureGoldCallFixture } from "./seed";
import { EARS_CANDIDATES, BRAIN_CANDIDATES } from "./candidates";
import { buildReplay } from "./replay";
import { db } from "../db";
import { benchmarkFixtures, calls } from "@shared/schema";
import { eq } from "drizzle-orm";
import { ensureBenchmarkTables } from "./ensureTables";

export function registerBenchmarkRoutes(app: Express) {
  const base = "/api/admin/benchmark";

  // Tables are self-provisioned (idempotent additive DDL) before any handler
  // runs — the production DB never went through drizzle migrations.
  app.use(base, (_req, res, next) => {
    ensureBenchmarkTables().then(() => next()).catch((e) =>
      res.status(500).json({ error: `benchmark tables unavailable: ${String(e?.message ?? e)}` }));
  });

  // Candidate matrix (static)
  app.get(`${base}/candidates`, requireBenchmarkAdmin, (_req, res) => {
    res.json({ ears: EARS_CANDIDATES, brain: BRAIN_CANDIDATES });
  });

  // Fixtures
  app.get(`${base}/fixtures`, requireBenchmarkAdmin, async (_req, res) => {
    try {
      await ensureGoldCallFixture();
      res.json(await listFixtures());
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });

  // Upload an audio fixture / create a new corpus entry.
  // Audio arrives base64-encoded in JSON (bounded to 25MB payload).
  app.post(`${base}/fixtures`, requireBenchmarkAdmin, express.json({ limit: "25mb" }), async (req, res) => {
    try {
      const { title, kind, goal, referenceTurns, criticalEntities, confirmedFacts, audioBase64, audioFormat, audioChannels, tags } = req.body ?? {};
      if (!title || typeof title !== "string") return res.status(400).json({ error: "title required" });
      if (audioBase64 && !["mulaw8k", "wav", "mp3"].includes(audioFormat)) {
        return res.status(400).json({ error: "audioFormat must be mulaw8k|wav|mp3 when audio is attached" });
      }
      // An audio fixture without a frozen reference transcript is unscoreable:
      // the EARS harness aligns hypotheses against referenceTurns. Reject it
      // up front instead of accepting a fixture that can never produce metrics.
      if (audioBase64 && (!Array.isArray(referenceTurns) || referenceTurns.length === 0)) {
        return res.status(400).json({ error: "audio fixtures require a non-empty referenceTurns transcript (array of {idx, role: 'owner'|'guest', text}) — EARS accuracy is measured against it" });
      }
      const [row] = await db.insert(benchmarkFixtures).values({
        title,
        kind: kind || "other",
        goal: goal || "",
        referenceTurns: Array.isArray(referenceTurns) ? referenceTurns : [],
        criticalEntities: criticalEntities ?? {},
        confirmedFacts: Array.isArray(confirmedFacts) ? confirmedFacts : [],
        audioBase64: audioBase64 || null,
        audioFormat: audioBase64 ? audioFormat : null,
        audioChannels: audioBase64 ? (audioChannels === "dual" ? "dual" : "mono") : null,
        tags: Array.isArray(tags) ? tags : [],
      }).returning();
      res.json({ ...row, audioBase64: row.audioBase64 ? "<attached>" : null });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });

  // Import a benchmark recording (made with BENCHMARK_CALL_RECORDING=1) as an
  // EARS audio fixture: downloads the dual-channel audio from Twilio using the
  // recording URL stored in the call's metadata, and requires the admin to
  // supply the frozen reference transcript (turns) for scoring.
  app.post(`${base}/fixtures/import-recording`, requireBenchmarkAdmin, express.json({ limit: "2mb" }), async (req, res) => {
    try {
      const { callSid, title, goal, referenceTurns, criticalEntities, confirmedFacts, tags } = req.body ?? {};
      if (!callSid || typeof callSid !== "string") return res.status(400).json({ error: "callSid required" });
      if (!Array.isArray(referenceTurns) || referenceTurns.length === 0) {
        return res.status(400).json({ error: "referenceTurns transcript required — EARS accuracy is measured against it" });
      }
      const [call] = await db.select().from(calls).where(eq(calls.callSid, callSid));
      const recordingUrl = (call?.metadata as any)?.benchmarkRecordingUrl as string | undefined;
      if (!recordingUrl) return res.status(404).json({ error: "no benchmark recording stored for this call (was BENCHMARK_CALL_RECORDING=1 set during the call?)" });
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (!accountSid || !authToken) return res.status(500).json({ error: "Twilio credentials not configured" });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      let audioBuf: Buffer;
      try {
        const resp = await fetch(`${recordingUrl}.wav?RequestedChannels=2`, {
          headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` },
          signal: controller.signal,
        });
        if (!resp.ok) return res.status(502).json({ error: `Twilio recording download failed: HTTP ${resp.status}` });
        audioBuf = Buffer.from(await resp.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }
      const [row] = await db.insert(benchmarkFixtures).values({
        title: title || `Imported recording ${callSid}`,
        kind: "recorded_call",
        goal: goal || "",
        referenceTurns,
        criticalEntities: criticalEntities ?? {},
        confirmedFacts: Array.isArray(confirmedFacts) ? confirmedFacts : [],
        audioBase64: audioBuf.toString("base64"),
        audioFormat: "wav",
        audioChannels: "dual",
        sourceCallSid: callSid,
        tags: Array.isArray(tags) ? tags : ["recorded"],
      }).returning();
      res.json({ ...row, audioBase64: `<${Math.round(audioBuf.length / 1024)}KB audio attached>` });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });

  // Availability check run
  app.post(`${base}/availability`, requireBenchmarkAdmin, async (_req, res) => {
    try { res.json(await runAvailabilityCheck()); }
    catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // EARS run
  app.post(`${base}/ears/run`, requireBenchmarkAdmin, async (req, res) => {
    try {
      const fixtureIds: string[] = Array.isArray(req.body?.fixtureIds) ? req.body.fixtureIds : [];
      if (fixtureIds.length === 0) {
        const gold = await ensureGoldCallFixture();
        fixtureIds.push(gold.id);
      }
      res.json(await startEarsRun(fixtureIds));
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // BRAIN run
  app.post(`${base}/brain/run`, requireBenchmarkAdmin, async (req, res) => {
    try {
      let fixtureId: string | undefined = req.body?.fixtureId;
      if (!fixtureId) fixtureId = (await ensureGoldCallFixture()).id;
      res.json(await startBrainRun(fixtureId, { judgeEnabled: req.body?.judgeEnabled !== false }));
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // Runs / history
  app.get(`${base}/runs`, requireBenchmarkAdmin, async (_req, res) => {
    try {
      const runs = await listRuns();
      // Strip bulky per-turn payloads from the list view.
      res.json(runs.map((r) => ({ ...r, results: undefined, report: r.report ? true : false })));
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  app.get(`${base}/runs/:id`, requireBenchmarkAdmin, async (req, res) => {
    try {
      const run = await getRun(req.params.id);
      if (!run) return res.status(404).json({ error: "run not found" });
      res.json(run);
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // Replay timeline for a completed BRAIN run + candidate
  app.get(`${base}/runs/:id/replay/:candidateId`, requireBenchmarkAdmin, async (req, res) => {
    try {
      const run = await getRun(req.params.id);
      if (!run) return res.status(404).json({ error: "run not found" });
      if (run.runType !== "brain") return res.status(400).json({ error: "replay requires a brain run" });
      const fixtureId = (run.fixtureIds as string[])[0];
      const fixture = fixtureId ? await getFixture(fixtureId) : undefined;
      if (!fixture) return res.status(404).json({ error: "fixture not found" });
      res.json(buildReplay(run, fixture, req.params.candidateId));
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });
}
