// Admin-only API for the LIVE Ears & Brain Benchmark.
// Mounted from server/routes.ts; every endpoint sits behind requireBenchmarkAdmin.

import type { Express } from "express";
import express from "express";
import { requireBenchmarkAdmin } from "./adminGate";
import {
  runAvailabilityCheck, startEarsRun, startBrainRun, startGoalReturnRun,
  getRun, listRuns, listFixtures, getFixture,
  type GoalReturnRunCall,
} from "./orchestrator";
import { ensureGoldCallFixture } from "./seed";
import { EARS_CANDIDATES, BRAIN_CANDIDATES } from "./candidates";
import { buildReplay } from "./replay";
import { db } from "../db";
import { benchmarkFixtures, calls } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { storage } from "../storage";
import { CANDIDATE_STT_IDS, CANDIDATE_BRAIN_MODELS, isCandidateStt, isCandidateBrainModel, classifyPipelineCall } from "../candidatePipeline";
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
      const cleanTurns = referenceTurns.map((t: any, idx: number) => {
        const turn: any = { idx, role: t.role, text: String(t.text).trim() };
        // Preserve optional EOT boundary timings (ms from audio start).
        // These are set by the admin while listening to the recording and are
        // used by earsHarness to compute prematureEot / falseWait / eotP50.
        if (typeof t.tStartMs === "number" && Number.isFinite(t.tStartMs) && t.tStartMs >= 0) {
          turn.tStartMs = Math.round(t.tStartMs);
        }
        if (typeof t.tEndMs === "number" && Number.isFinite(t.tEndMs) && t.tEndMs >= 0) {
          turn.tEndMs = Math.round(t.tEndMs);
        }
        // Preserve the human-verified flag across full-transcript saves.
        if (t.verified === true) turn.verified = true;
        return turn;
      });

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

      // NEVER silently destroy per-turn timings / verified flags on bulk save.
      const { mergeReferenceTurns } = await import("./referenceTurns");
      const merged = mergeReferenceTurns(
        ((row.referenceTurns as any[]) ?? []) as any,
        cleanTurns as any,
        req.body?.confirmDestructive === true
      );
      if (!merged.ok) return res.status(409).json({ error: merged.error });

      const refVersion = `ref-v${Date.now()}`;
      const tags = Array.isArray(row.tags) ? [...(row.tags as string[]), refVersion] : [refVersion];
      const [updated] = await db.update(benchmarkFixtures).set({
        referenceTurns: merged.turns,
        criticalEntities: critical,
        ...(roles ? { channelRoles: roles } : {}),
        ...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}),
        tags,
        updatedAt: new Date(),
      }).where(eq(benchmarkFixtures.id, row.id)).returning();
      res.json({ ...updated, audioBase64: updated.audioBase64 ? "<attached>" : null, refVersion });
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // -------------------------------------------------------------------------
  // Per-turn human verification (Task: EARS Fixture #2 owner-turn verify).
  // -------------------------------------------------------------------------

  // Audio clip of one reference turn — sliced from that role's channel of the
  // dual-channel recording using the turn's audio-timeline boundaries.
  app.get(`${base}/fixtures/:id/turn-audio/:idx`, requireBenchmarkAdmin, async (req, res) => {
    try {
      const [row] = await db.select().from(benchmarkFixtures).where(eq(benchmarkFixtures.id, req.params.id));
      if (!row) return res.status(404).json({ error: "fixture not found" });
      if (!row.audioBase64 || row.audioFormat !== "wav") return res.status(400).json({ error: "fixture has no WAV audio" });
      const idx = Number(req.params.idx);
      const turns = (row.referenceTurns as any[]) ?? [];
      const turn = turns.find((t) => t?.idx === idx);
      if (!turn) return res.status(404).json({ error: `turn ${idx} not found` });
      if (typeof turn.tEndMs !== "number") return res.status(400).json({ error: `turn ${idx} has no tEndMs boundary — cannot slice audio` });
      const roles = ((row as any).channelRoles as string[]) ?? ["owner", "guest"];
      const ch = roles.indexOf(turn.role);
      if (ch < 0) return res.status(400).json({ error: `no channel mapped to role ${turn.role}` });
      const { splitWavChannels, sliceMonoWav } = await import("./audioChannels");
      const { channels } = splitWavChannels(Buffer.from(row.audioBase64, "base64"));
      if (!channels[ch]) return res.status(400).json({ error: `recording has no channel ${ch} (mono?)` });
      const PAD_MS = 300;
      const startMs = Math.max(0, (typeof turn.tStartMs === "number" ? turn.tStartMs : 0) - PAD_MS);
      const clip = sliceMonoWav(channels[ch].wav, startMs, turn.tEndMs + PAD_MS);
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Cache-Control", "no-store");
      res.send(clip);
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // Edit/verify a SINGLE reference turn. Text change appends a ref-v tag
  // (versioned history) and resets verified unless explicitly set; a pure
  // verified toggle does not create a new reference version.
  app.patch(`${base}/fixtures/:id/reference/turns/:idx`, requireBenchmarkAdmin, express.json({ limit: "64kb" }), async (req, res) => {
    try {
      const [row] = await db.select().from(benchmarkFixtures).where(eq(benchmarkFixtures.id, req.params.id));
      if (!row) return res.status(404).json({ error: "fixture not found" });
      const idx = Number(req.params.idx);
      const turns = ((row.referenceTurns as any[]) ?? []).map((t) => ({ ...t }));
      const turn = turns.find((t) => t?.idx === idx);
      if (!turn) return res.status(404).json({ error: `turn ${idx} not found` });
      const { text, verified } = req.body ?? {};
      let textChanged = false;
      if (text !== undefined) {
        if (typeof text !== "string" || !text.trim()) return res.status(400).json({ error: "text must be a non-empty string" });
        textChanged = text.trim() !== turn.text;
        turn.text = text.trim();
      }
      if (verified !== undefined) {
        if (typeof verified !== "boolean") return res.status(400).json({ error: "verified must be boolean" });
        turn.verified = verified;
      } else if (textChanged) {
        // Text edited while listening counts as verification by the human.
        turn.verified = true;
      }
      const tags = Array.isArray(row.tags) ? [...(row.tags as string[])] : [];
      if (textChanged) tags.push(`ref-v${Date.now()}`);
      const [updated] = await db.update(benchmarkFixtures)
        .set({ referenceTurns: turns, tags, updatedAt: new Date() })
        .where(eq(benchmarkFixtures.id, row.id)).returning();
      const owners = ((updated.referenceTurns as any[]) ?? []).filter((t) => t.role === "owner");
      res.json({
        turn: ((updated.referenceTurns as any[]) ?? []).find((t) => t.idx === idx),
        ownerVerified: owners.filter((t) => t.verified === true).length,
        ownerTotal: owners.length,
      });
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // Per-turn divergence between candidates from the latest completed EARS run
  // covering this fixture — highlights turns a human should listen to first.
  // Divergence per turn = max pairwise WER between candidate hypotheses; also
  // reports max WER vs the current reference. Turn-level hypotheses exist only
  // where the provable (timestamps) alignment was available.
  app.get(`${base}/fixtures/:id/turn-divergence`, requireBenchmarkAdmin, async (req, res) => {
    try {
      const runs = await listRuns();
      const run = runs.find((r: any) => r.runType === "ears" && r.status === "completed" && (r.fixtureIds as string[])?.includes(req.params.id));
      if (!run) return res.json({ runId: null, turns: [] });
      const full = await getRun(run.id);
      const turnResults: any[] = (full?.results as any)?.turnResults ?? [];
      const [row] = await db.select().from(benchmarkFixtures).where(eq(benchmarkFixtures.id, req.params.id));
      const refByIdx = new Map<number, string>(((row?.referenceTurns as any[]) ?? []).map((t) => [t.idx, t.text]));
      const { wordErrorRate } = await import("./earsMetrics");
      const byTurn = new Map<number, { candidateId: string; text: string }[]>();
      for (const tr of turnResults) {
        if (typeof tr.turnIdx !== "number" || tr.turnIdx < 0) continue;
        if (typeof tr.hypothesisText !== "string") continue;
        const arr = byTurn.get(tr.turnIdx) ?? [];
        arr.push({ candidateId: tr.candidateId, text: tr.hypothesisText });
        byTurn.set(tr.turnIdx, arr);
      }
      const turns = Array.from(byTurn.entries()).map(([idx, hyps]) => {
        let disagreement = 0;
        for (let i = 0; i < hyps.length; i++) {
          for (let j = i + 1; j < hyps.length; j++) {
            if (!hyps[i].text && !hyps[j].text) continue;
            disagreement = Math.max(disagreement, wordErrorRate(hyps[i].text || " ", hyps[j].text || " "));
          }
        }
        const ref = refByIdx.get(idx);
        let maxWerVsRef: number | null = null;
        if (ref) {
          for (const h of hyps) maxWerVsRef = Math.max(maxWerVsRef ?? 0, wordErrorRate(ref, h.text || " "));
        }
        return { idx, candidates: hyps, disagreement, maxWerVsRef };
      }).sort((a, b) => a.idx - b.idx);
      res.json({ runId: run.id, turns });
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
      // realtimeOnly => the realtime shortlist control run (no batch ceiling,
      // no optional externals). Explicit candidateIds take precedence.
      let candidateIds: string[] | undefined = Array.isArray(req.body?.candidateIds) ? req.body.candidateIds : undefined;
      if (!candidateIds && req.body?.realtimeOnly === true) {
        candidateIds = EARS_CANDIDATES.filter((c) => c.kind === "realtime" && !c.referenceOnly && !c.optional).map((c) => c.id);
      }
      res.json(await startEarsRun(fixtureIds, { candidateIds }));
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

  // ---------------------------------------------------------------------------
  // Goal-return analysis (Task #227): offline per-call analysis of digressions
  // and returns to the call goal. Body: { calls: [{ title, goal, goalSource,
  // transcript?, callSid? }] }. When callSid is given and transcript is not,
  // the transcript (and hintLatency counts) are read from OUR calls table;
  // production transcripts must be passed in explicitly (this server's DB is
  // the dev DB). Goals are never invented: a call without a goal is rejected.
  app.post(`${base}/goal-return/run`, requireBenchmarkAdmin, express.json({ limit: "5mb" }), async (req, res) => {
    try {
      const callsInRaw = req.body?.calls;
      if (!Array.isArray(callsInRaw) || callsInRaw.length === 0) {
        return res.status(400).json({ error: "calls[] required" });
      }
      const callsIn: GoalReturnRunCall[] = [];
      for (const c of callsInRaw) {
        if (!c || typeof c !== "object") return res.status(400).json({ error: "each call must be an object" });
        if (!c.goal || typeof c.goal !== "string" || !c.goal.trim()) {
          return res.status(400).json({ error: `call "${c.title ?? "?"}": goal required — goals are not persisted on production calls, supply one and its source` });
        }
        let transcript: string | undefined = typeof c.transcript === "string" ? c.transcript : undefined;
        let hintStats: { hintsSent: number; hintsDropped: number } | null =
          c.hintStats && Number.isFinite(c.hintStats.hintsSent) && Number.isFinite(c.hintStats.hintsDropped)
            ? { hintsSent: c.hintStats.hintsSent, hintsDropped: c.hintStats.hintsDropped }
            : null;
        if (!transcript && typeof c.callSid === "string" && c.callSid) {
          const [row] = await db.select().from(calls).where(eq(calls.callSid, c.callSid));
          if (!row?.transcript) return res.status(404).json({ error: `call ${c.callSid}: no transcript in this server's DB — pass transcript explicitly` });
          transcript = row.transcript;
          const summary = (row.metadata as any)?.hintLatency?.summary;
          if (!hintStats && summary && Number.isFinite(summary.hintsSent)) {
            hintStats = { hintsSent: summary.hintsSent, hintsDropped: summary.hintsDropped ?? 0 };
          }
        }
        if (!transcript?.trim()) return res.status(400).json({ error: `call "${c.title ?? c.callSid ?? "?"}": transcript required` });
        // Explicit hint records only — hint metrics are never inferred from
        // the transcript. Malformed entries are rejected, not skipped.
        let hints: { text: string; utteranceId?: number }[] | null = null;
        if (c.hints !== undefined && c.hints !== null) {
          if (!Array.isArray(c.hints)) return res.status(400).json({ error: `call "${c.title ?? "?"}": hints must be an array of {text, utteranceId?}` });
          hints = [];
          for (const h of c.hints) {
            if (!h || typeof h.text !== "string" || !h.text.trim()) {
              return res.status(400).json({ error: `call "${c.title ?? "?"}": each hint needs a non-empty text` });
            }
            hints.push({ text: h.text, ...(Number.isFinite(h.utteranceId) ? { utteranceId: h.utteranceId } : {}) });
          }
        }
        callsIn.push({
          hints,
          title: typeof c.title === "string" && c.title ? c.title : (c.callSid ?? "untitled call"),
          goal: c.goal.trim(),
          goalSource: typeof c.goalSource === "string" && c.goalSource ? c.goalSource : "unspecified",
          transcript,
          hintStats,
        });
      }
      res.json(await startGoalReturnRun(callsIn));
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // ---------------------------------------------------------------------------
  // Candidate Pipeline v1 (Task #207).
  // Per-user experimental live pipeline: read/update the admin's own config,
  // and a verdict view comparing candidate calls vs baseline calls by the
  // hint-latency metadata flushed at call end.
  // ---------------------------------------------------------------------------

  app.get(`${base}/candidate-pipeline`, requireBenchmarkAdmin, async (req, res) => {
    try {
      const userId = (req as any).user?.id as string;
      const cfg = await storage.getCandidatePipeline(userId);
      res.json({ ...cfg, allowedStt: CANDIDATE_STT_IDS, allowedBrainModels: CANDIDATE_BRAIN_MODELS });
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  app.put(`${base}/candidate-pipeline`, requireBenchmarkAdmin, async (req, res) => {
    try {
      const userId = (req as any).user?.id as string;
      const { enabled, stt, brainModel } = req.body ?? {};
      if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be boolean" });
      const sttVal = stt ?? null;
      const brainVal = brainModel ?? null;
      if (sttVal !== null && !isCandidateStt(sttVal)) {
        return res.status(400).json({ error: `unknown candidate stt "${sttVal}" — allowed: ${CANDIDATE_STT_IDS.join(", ")}` });
      }
      if (brainVal !== null && !isCandidateBrainModel(brainVal)) {
        return res.status(400).json({ error: `unknown candidate brain model "${brainVal}" — allowed: ${CANDIDATE_BRAIN_MODELS.join(", ")}` });
      }
      if (enabled && sttVal === null && brainVal === null) {
        return res.status(400).json({ error: "enabled pipeline must select at least a candidate STT or a candidate Brain model" });
      }
      const saved = await storage.setCandidatePipeline(userId, { enabled, stt: sttVal, brainModel: brainVal });
      res.json(saved);
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // Latency verdict: the admin's recent calls that carry hint-latency metadata,
  // split into candidate vs baseline, each with its per-call summary. No
  // fabricated aggregates: calls without latency metadata are listed as such.
  app.get(`${base}/candidate-pipeline/verdict`, requireBenchmarkAdmin, async (req, res) => {
    try {
      const userId = (req as any).user?.id as string;
      const rows = await db.select().from(calls).where(eq(calls.userId, userId)).orderBy(desc(calls.startedAt)).limit(30);
      const items = rows.map((c) => {
        const meta = (c.metadata && typeof c.metadata === "object" ? c.metadata : {}) as any;
        const pipeline = meta.candidatePipeline ?? null;
        const latency = meta.hintLatency ?? null;
        // HONEST labeling (classifyPipelineCall, unit-tested): STT and Brain
        // candidacy are independent — a failed STT swap with an active Brain
        // override is still a Brain-candidate call, never baseline.
        const label = classifyPipelineCall(pipeline);
        return {
          callSid: c.callSid,
          startedAt: c.startedAt,
          endedAt: c.endedAt,
          toNumber: c.toNumber,
          direction: c.direction,
          status: c.status,
          isCandidate: label.isCandidate,
          sttCandidate: label.sttCandidate,
          brainCandidate: label.brainCandidate,
          sttSwapFailed: label.sttSwapFailed,
          pipeline,
          latencySummary: latency?.summary ?? null,
          slaMs: latency?.slaMs ?? null,
          entries: latency?.entries ?? null,
        };
      });
      res.json({ calls: items });
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });
}
