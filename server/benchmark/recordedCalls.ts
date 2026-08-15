// Admin → Diagnostics → Recorded Calls (Task #173).
//
// Lists real recorded diagnostic calls, streams their audio for playback,
// freezes a call into a Gold Call benchmark fixture, and deletes recordings
// (Twilio-side + local metadata). Admin-only; recordings can contain SSN/DOB/
// bank data, so nothing here logs audio or credentials.

import type { Express } from "express";
import express from "express";
import { requireBenchmarkAdmin } from "./adminGate";
import { db } from "../db";
import { benchmarkFixtures, calls, users } from "@shared/schema";
import { eq, sql, desc } from "drizzle-orm";
import { transcriptToReferenceTurns, invalidateDiagnosticRecordingCache } from "./diagnosticRecording";

// SSRF guard: we never fetch a stored URL blindly with Twilio credentials.
// The only trusted endpoint shape is Twilio's own API for OUR account; when a
// RecordingSid is available we construct the URL from it, otherwise the stored
// URL must exactly match Twilio's canonical Recordings path for our account.
// Redirects are always rejected so credentials cannot be bounced elsewhere.
export function canonicalRecordingUrl(recordingUrl: string | undefined, recordingSid: string | undefined, accountSid: string): string {
  if (recordingSid && /^RE[0-9a-f]{32}$/i.test(recordingSid)) {
    return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}`;
  }
  if (recordingUrl) {
    const m = recordingUrl.match(/^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/(AC[0-9a-f]{32})\/Recordings\/(RE[0-9a-f]{32})$/i);
    if (m && m[1].toLowerCase() === accountSid.toLowerCase()) {
      return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${m[2]}`;
    }
  }
  throw new Error("recording reference is not a canonical Twilio recording for this account");
}

// Download a Twilio recording as (dual-channel where available) WAV.
// Shared by manual import, auto-benchmark intake, playback, and Gold Call freeze.
export async function downloadRecordingWav(recordingUrl: string | undefined, recordingSid?: string): Promise<Buffer> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("Twilio credentials not configured");
  const base = canonicalRecordingUrl(recordingUrl, recordingSid, accountSid);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const resp = await fetch(`${base}.wav?RequestedChannels=2`, {
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` },
      signal: controller.signal,
      redirect: "error",
    });
    if (!resp.ok) throw new Error(`Twilio recording download failed: HTTP ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function recordingMeta(call: { metadata: unknown }) {
  const m = (call.metadata as any) ?? {};
  return {
    recordingUrl: m.benchmarkRecordingUrl as string | undefined,
    recordingSid: m.recordingSid as string | undefined,
    recordingStatus: m.recordingStatus as string | undefined,
    recordingChannels: m.benchmarkRecordingChannels as string | undefined,
    recordingDurationSecs: m.recordingDurationSecs as number | undefined,
    recordingCompletedAt: m.recordingCompletedAt as string | undefined,
    recordingPolicyVersion: m.recordingPolicyVersion as string | undefined,
    diagnosticRecording: !!m.diagnosticRecording,
  };
}

export function registerRecordedCallRoutes(app: Express, base: string) {
  // Diagnostic-recording participants: list users and toggle the per-user
  // recording capability from the admin panel (prod DB is read-only for the
  // agent, so this is THE way to enroll/remove test accounts in production).
  app.get(`${base}/diagnostic-users`, requireBenchmarkAdmin, async (_req, res) => {
    try {
      const rows = await db.select({
        id: users.id, email: users.email,
        diagnosticRecordingEnabled: users.diagnosticRecordingEnabled,
      }).from(users).orderBy(desc(users.diagnosticRecordingEnabled), users.email).limit(500);
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  app.post(`${base}/diagnostic-users/:id`, requireBenchmarkAdmin, express.json(), async (req, res) => {
    try {
      const enabled = req.body?.enabled === true;
      const [row] = await db.update(users)
        .set({ diagnosticRecordingEnabled: enabled })
        .where(eq(users.id, req.params.id))
        .returning({ id: users.id, email: users.email, diagnosticRecordingEnabled: users.diagnosticRecordingEnabled });
      if (!row) return res.status(404).json({ error: "user not found" });
      invalidateDiagnosticRecordingCache(row.id);
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // List recorded calls (any call with recording metadata), newest first.
  app.get(`${base}/recorded-calls`, requireBenchmarkAdmin, async (_req, res) => {
    try {
      const rows = await db.select({
        id: calls.id, callSid: calls.callSid, userId: calls.userId,
        fromNumber: calls.fromNumber, toNumber: calls.toNumber,
        direction: calls.direction, status: calls.status,
        startedAt: calls.startedAt, endedAt: calls.endedAt,
        transcript: calls.transcript, metadata: calls.metadata,
        userEmail: users.email,
      }).from(calls)
        .leftJoin(users, eq(calls.userId, users.id))
        .where(sql`${calls.metadata} ? 'benchmarkRecordingUrl'`)
        .orderBy(desc(calls.startedAt))
        .limit(200);

      const fixtures = await db.select({
        id: benchmarkFixtures.id, sourceCallSid: benchmarkFixtures.sourceCallSid,
        tags: benchmarkFixtures.tags,
      }).from(benchmarkFixtures);
      const bySid = new Map(fixtures.filter((f) => f.sourceCallSid).map((f) => [f.sourceCallSid as string, f]));

      res.json(rows.map((r) => {
        const fx = bySid.get(r.callSid);
        return {
          id: r.id, callSid: r.callSid, userEmail: r.userEmail,
          fromNumber: r.fromNumber, toNumber: r.toNumber,
          direction: r.direction, status: r.status,
          startedAt: r.startedAt, endedAt: r.endedAt,
          hasTranscript: !!(r.transcript && r.transcript.trim()),
          ...recordingMeta(r),
          fixtureId: fx?.id ?? null,
          isGoldCall: !!fx && Array.isArray(fx.tags) && (fx.tags as string[]).includes("gold"),
          benchmarkStatus: fx ? "fixture_created" : "none",
        };
      }));
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // Transcript for one recorded call.
  app.get(`${base}/recorded-calls/:id/transcript`, requireBenchmarkAdmin, async (req, res) => {
    try {
      const [call] = await db.select().from(calls).where(eq(calls.id, req.params.id)).limit(1);
      if (!call) return res.status(404).json({ error: "call not found" });
      res.json({ callSid: call.callSid, transcript: call.transcript ?? "", turns: transcriptToReferenceTurns(call.transcript ?? "") });
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // Stream the recording audio for playback (proxied — Twilio creds stay server-side).
  app.get(`${base}/recorded-calls/:id/audio`, requireBenchmarkAdmin, async (req, res) => {
    try {
      const [call] = await db.select().from(calls).where(eq(calls.id, req.params.id)).limit(1);
      if (!call) return res.status(404).json({ error: "call not found" });
      const meta = recordingMeta(call);
      if (!meta.recordingUrl && !meta.recordingSid) return res.status(404).json({ error: "no recording for this call" });
      const buf = await downloadRecordingWav(meta.recordingUrl, meta.recordingSid);
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Content-Disposition", `inline; filename="${call.callSid}.wav"`);
      res.send(buf);
    } catch (e: any) { res.status(502).json({ error: String(e?.message ?? e) }); }
  });

  // Mark as Gold Call: freeze the fixture (audio copy + reference transcript +
  // goal/facts + source call + recording config + version + capture timestamp).
  // Later production transcript changes never touch the frozen fixture.
  app.post(`${base}/recorded-calls/:id/gold`, requireBenchmarkAdmin, express.json({ limit: "2mb" }), async (req, res) => {
    try {
      const [call] = await db.select().from(calls).where(eq(calls.id, req.params.id)).limit(1);
      if (!call) return res.status(404).json({ error: "call not found" });
      const meta = recordingMeta(call);
      if (!meta.recordingUrl) return res.status(404).json({ error: "no recording for this call" });

      // Reference transcript: admin-supplied turns win; otherwise freeze the live transcript.
      const supplied = Array.isArray(req.body?.referenceTurns) && req.body.referenceTurns.length > 0
        ? req.body.referenceTurns : null;
      const referenceTurns = supplied ?? transcriptToReferenceTurns(call.transcript ?? "");
      if (referenceTurns.length === 0) {
        return res.status(400).json({ error: "call has no transcript — supply referenceTurns to mark as Gold Call" });
      }

      let audioBase64: string | null = null;
      try { audioBase64 = (await downloadRecordingWav(meta.recordingUrl, meta.recordingSid)).toString("base64"); }
      catch (e: any) { return res.status(502).json({ error: `audio download failed: ${e?.message ?? e}` }); }

      const goldVersion = `gold-${Date.now()}`;
      const existing = await db.select().from(benchmarkFixtures)
        .where(eq(benchmarkFixtures.sourceCallSid, call.callSid)).limit(1);

      const values = {
        title: req.body?.title || `Gold Call ${call.callSid}`,
        kind: "recorded_call",
        goal: req.body?.goal || ((call.metadata as any)?.goalText ?? ""),
        referenceTurns,
        criticalEntities: req.body?.criticalEntities ?? {},
        confirmedFacts: Array.isArray(req.body?.confirmedFacts) ? req.body.confirmedFacts : [],
        audioBase64,
        audioFormat: "wav" as const,
        audioChannels: (meta.recordingChannels === "2" || meta.recordingChannels === "dual" ? "dual" : "mono"),
        sourceCallSid: call.callSid,
        tags: ["gold", "diagnostic", goldVersion, `policy:${meta.recordingPolicyVersion ?? "unknown"}`],
        updatedAt: new Date(),
      };
      const [row] = existing.length
        ? await db.update(benchmarkFixtures).set(values).where(eq(benchmarkFixtures.id, existing[0].id)).returning()
        : await db.insert(benchmarkFixtures).values(values).returning();
      res.json({ ...row, audioBase64: "<frozen audio attached>", goldVersion });
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // Delete: remove the recording from Twilio (retention policy: full delete on
  // request) and strip recording metadata locally. Call row/transcript remain.
  app.delete(`${base}/recorded-calls/:id/recording`, requireBenchmarkAdmin, async (req, res) => {
    try {
      const [call] = await db.select().from(calls).where(eq(calls.id, req.params.id)).limit(1);
      if (!call) return res.status(404).json({ error: "call not found" });
      const meta = recordingMeta(call);
      if (!meta.recordingUrl) return res.status(404).json({ error: "no recording for this call" });

      // Delete from Twilio (best effort by SID, else via URL DELETE).
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (!accountSid || !authToken) return res.status(500).json({ error: "Twilio credentials not configured" });
      const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
      // Same SSRF guard as downloads: only a canonical Twilio URL for OUR
      // account ever receives credentials, and redirects are rejected.
      const delUrl = `${canonicalRecordingUrl(meta.recordingUrl, meta.recordingSid, accountSid)}.json`;
      const resp = await fetch(delUrl, { method: "DELETE", headers: { Authorization: auth }, redirect: "error" });
      if (!resp.ok && resp.status !== 404) {
        return res.status(502).json({ error: `Twilio recording delete failed: HTTP ${resp.status}` });
      }

      const m = { ...((call.metadata as any) ?? {}) };
      delete m.benchmarkRecordingUrl; delete m.benchmarkRecordingChannels;
      delete m.recordingSid; delete m.recordingStatus;
      delete m.recordingDurationSecs; delete m.recordingCompletedAt;
      m.recordingDeletedAt = new Date().toISOString();
      await db.update(calls).set({ metadata: m }).where(eq(calls.id, call.id));

      // Also purge frozen audio if the admin asks for a FULL delete of fixtures too.
      if (req.query.includeFixture === "1") {
        await db.delete(benchmarkFixtures).where(eq(benchmarkFixtures.sourceCallSid, call.callSid));
      }
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });
}
