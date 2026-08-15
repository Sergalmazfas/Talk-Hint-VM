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
import { registerRecordedCallRoutes, downloadRecordingWav, lookupRecordingSidByCallSid } from "./recordedCalls";

export function registerBenchmarkRoutes(app: Express) {
  const base = "/api/admin/benchmark";

  // Tables are self-provisioned (idempotent additive DDL) before any handler
  // runs — the production DB never went through drizzle migrations.
  app.use(base, (_req, res, next) => {
    ensureBenchmarkTables().then(() => next()).catch((e) =>
      res.status(500).json({ error: `benchmark tables unavailable: ${String(e?.message ?? e)}` }));
  });

  // Also provision eagerly (fire-and-forget) so the diagnostic-recording
  // capability column exists in production before the admin panel is opened.
  void ensureBenchmarkTables().catch((e) =>
    console.error("[Benchmark] eager table provisioning failed:", e?.message ?? e));

  // Recorded diagnostic calls (list / play / transcript / gold / delete)
  registerRecordedCallRoutes(app, base);

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
      const meta = (call?.metadata as any) ?? {};
      const recordingUrl = meta.benchmarkRecordingUrl as string | undefined;
      let recordingSid = meta.recordingSid as string | undefined;
      if (!recordingUrl && !recordingSid) {
        // Call row may live in another environment's DB (e.g. production call
        // fixtured from dev). The recording is on Twilio either way — look it
        // up by call SID against our own account.
        try {
          recordingSid = (await lookupRecordingSidByCallSid(callSid)) ?? undefined;
        } catch (e: any) {
          return res.status(502).json({ error: `Twilio recording lookup failed: ${String(e?.message ?? e)}` });
        }
        if (!recordingSid) return res.status(404).json({ error: "no completed recording found on Twilio for this call SID (was recording enabled during the call?)" });
      }
      let audioBuf: Buffer;
      try {
        // SSRF-guarded: only canonical Twilio recording URLs for our account.
        audioBuf = await downloadRecordingWav(recordingUrl, recordingSid);
      } catch (e: any) {
        return res.status(502).json({ error: String(e?.message ?? e) });
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

  // Reference transcript of one fixture (for the admin editor).
  app.get(`${base}/fixtures/:id/reference`, requireBenchmarkAdmin, async (req, res) => {
    try {
      const [row] = await db.select().from(benchmarkFixtures).where(eq(benchmarkFixtures.id, req.params.id));
      if (!row) return res.status(404).json({ error: "fixture not found" });
      res.json({
        id: row.id,
        title: row.title,
        referenceTurns: row.referenceTurns ?? [],
        criticalEntities: row.criticalEntities ?? {},
        channelRoles: (row as any).channelRoles ?? ["owner", "guest"],
        tags: row.tags ?? [],
        hasAudio: !!row.audioBase64,
        audioChannels: row.audioChannels,
        sourceCallSid: row.sourceCallSid,
      });
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // Manually edit the reference transcript / domain terms / channel-role
  // mapping of an EXISTING fixture. The production transcript is never the
  // ground truth — the admin listens to the recording and fixes the reference
  // by hand. Every save appends a ref-v<timestamp> tag (versioned history).
  app.put(`${base}/fixtures/:id/reference`, requireBenchmarkAdmin, express.json({ limit: "2mb" }), async (req, res) => {
    try {
      const [row] = await db.select().from(benchmarkFixtures).where(eq(benchmarkFixtures.id, req.params.id));
      if (!row) return res.status(404).json({ error: "fixture not found" });

      const { referenceTurns, terms, channelRoles, title } = req.body ?? {};
      if (!Array.isArray(referenceTurns) || referenceTurns.length === 0) {
        return res.status(400).json({ error: "referenceTurns must be a non-empty array of {idx, role: 'owner'|'guest', text}" });
      }
      for (const t of referenceTurns) {
        if (!t || typeof t.text !== "string" || !t.text.trim() || (t.role !== "owner" && t.role !== "guest")) {
          return res.status(400).json({ error: "every turn needs role 'owner'|'guest' and non-empty text" });
        }
      }
      const cleanTurns = referenceTurns.map((t: any, idx: number) => ({ idx, role: t.role, text: String(t.text).trim() }));

      let roles: string[] | undefined;
      if (channelRoles !== undefined) {
        if (!Array.isArray(channelRoles) || channelRoles.some((r: any) => r !== "owner" && r !== "guest")) {
          return res.status(400).json({ error: "channelRoles must be an array of 'owner'|'guest'" });
        }
        roles = channelRoles;
      }

      const critical = { ...((row.criticalEntities as any) ?? {}) };
      if (terms !== undefined) {
        if (!Array.isArray(terms) || terms.some((t: any) => typeof t !== "string")) {
          return res.status(400).json({ error: "terms must be an array of strings" });
        }
        critical.terms = terms.map((t: string) => t.trim()).filter(Boolean);
      }

      const refVersion = `ref-v${Date.now()}`;
      const tags = Array.isArray(row.tags) ? [...(row.tags as string[]), refVersion] : [refVersion];
      const [updated] = await db.update(benchmarkFixtures).set({
        referenceTurns: cleanTurns,
        criticalEntities: critical,
        ...(roles ? { channelRoles: roles } : {}),
        ...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}),
        tags,
        updatedAt: new Date(),
      }).where(eq(benchmarkFixtures.id, row.id)).returning();
      res.json({ ...updated, audioBase64: updated.audioBase64 ? "<attached>" : null, refVersion });
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
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
