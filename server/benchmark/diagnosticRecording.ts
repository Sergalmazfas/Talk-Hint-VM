// Diagnostic call recording policy (Task #173).
//
// For users explicitly flagged with users.diagnostic_recording_enabled, every
// telephone call is recorded via NATIVE Twilio Voice Recording (dual-channel
// where supported) so the real call can later be run through the LIVE Ears &
// Brain Benchmark (#172). OFF for all normal users. NOT tied to admin role —
// it is a separate backend capability flag.
//
// Hard invariants:
// - A recording failure must NEVER stop or degrade the live call. Every check
//   here is try/caught and fails closed to "do not record".
// - Production STT/LLM/hint pipeline is untouched.

import { db } from "../db";
import { users, calls } from "@shared/schema";
import { eq } from "drizzle-orm";
import { parseTranscriptText } from "../airatomaWebhook";

// ---------------------------------------------------------------------------
// Recording notification / consent policy.
// Twilio does NOT automatically announce recording; we play a configurable
// notice ourselves. Text + version are backend-configured (env override), not
// hardcoded in clients, and the version used is persisted with the recording.
// ---------------------------------------------------------------------------
export const RECORDING_NOTICE_TEXT =
  process.env.RECORDING_NOTICE_TEXT ||
  "This call may be recorded for quality and diagnostic purposes.";
export const RECORDING_POLICY_VERSION =
  process.env.RECORDING_NOTICE_POLICY_VERSION || "notice-v1";

// Fail-closed capability check: any error (DB down, missing user) means "do
// not record" — never break the call path. This runs inside Twilio webhook
// handlers, so it is hard-deadlined: if the DB doesn't answer within the
// budget we return false immediately and the call proceeds unrecorded. A
// short-lived per-user cache keeps repeat checks (hold loop!) off the DB.
const CAPABILITY_DEADLINE_MS = 800;
const CAPABILITY_CACHE_MS = 60_000;
const capabilityCache = new Map<string, { enabled: boolean; at: number }>();

/// Drop the cached capability for one user so an admin toggle takes effect on
/// the very next call instead of after the cache TTL.
export function invalidateDiagnosticRecordingCache(userId: string) {
  capabilityCache.delete(userId);
}

export async function isDiagnosticRecordingUser(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const cached = capabilityCache.get(userId);
  if (cached && Date.now() - cached.at < CAPABILITY_CACHE_MS) return cached.enabled;
  try {
    const query = db.select({ enabled: users.diagnosticRecordingEnabled })
      .from(users).where(eq(users.id, userId)).limit(1)
      .then(([u]) => !!u?.enabled);
    const enabled = await Promise.race<boolean>([
      query,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CAPABILITY_DEADLINE_MS).unref?.()),
    ]);
    // Only cache real answers; a deadline miss stays uncached so the next
    // call retries once the DB recovers. (A racing slow query that later
    // resolves true simply populates the cache for subsequent calls.)
    void query.then((real) => capabilityCache.set(userId, { enabled: real, at: Date.now() })).catch(() => {});
    return enabled;
  } catch (e: any) {
    console.error("[DiagRecording] capability check failed (not recording):", e?.message ?? e);
    return false;
  }
}

// Persist which consent policy version was in effect when recording started.
// Fire-and-forget: metadata bookkeeping must never affect the call.
export async function stampRecordingPolicy(callSid: string): Promise<void> {
  try {
    const [call] = await db.select().from(calls).where(eq(calls.callSid, callSid)).limit(1);
    if (!call) return;
    const metadata = {
      ...((call.metadata as any) ?? {}),
      diagnosticRecording: true,
      recordingPolicyVersion: RECORDING_POLICY_VERSION,
      recordingNoticeText: RECORDING_NOTICE_TEXT,
    };
    await db.update(calls).set({ metadata }).where(eq(calls.id, call.id));
  } catch (e: any) {
    console.error("[DiagRecording] policy stamp failed:", e?.message ?? e);
  }
}

// ---------------------------------------------------------------------------
// Auto-benchmark intake: after a diagnostic user's recording completes, the
// call is automatically sent through the existing #172 benchmark (EARS on the
// real audio + BRAIN on the live transcript). Every diagnostic call is a test.
// The recorded call is NOT automatically a Gold Call — marking is manual.
// Delayed so the live transcript's final flush has landed. All failures are
// logged only; nothing here can affect telephony.
// ---------------------------------------------------------------------------
const AUTO_BENCHMARK_DELAY_MS = 20_000;
// In-process debounce only (Twilio can retry the callback within seconds).
// The DURABLE idempotency guard is the unique index on
// benchmark_fixtures.source_call_sid + ON CONFLICT DO NOTHING below, which
// holds across restarts and concurrent processes. On failure the SID is
// removed from the set so a later callback/retry can try again.
const scheduled = new Set<string>();

export function scheduleAutoBenchmark(callSid: string): void {
  if (scheduled.has(callSid)) return;
  scheduled.add(callSid);
  setTimeout(() => {
    autoBenchmarkRecordedCall(callSid)
      .catch((e: any) => {
        scheduled.delete(callSid);
        console.error(`[DiagRecording] auto-benchmark failed for ${callSid}:`, e?.message ?? e);
      });
  }, AUTO_BENCHMARK_DELAY_MS).unref?.();
}

// Turn the persisted "Speaker: text" transcript into benchmark reference turns.
// Speakers named Owner/You map to owner; everything else is the guest side.
export function transcriptToReferenceTurns(transcript: string): Array<{ idx: number; role: "owner" | "guest"; text: string }> {
  return parseTranscriptText(transcript)
    .filter((t) => t.text.trim().length > 0)
    .map((t, idx) => ({
      idx,
      role: /^(owner|you|вы|я)$/i.test(t.speaker.trim()) ? "owner" as const : "guest" as const,
      text: t.text.trim(),
    }));
}

async function autoBenchmarkRecordedCall(callSid: string): Promise<void> {
  const { ensureBenchmarkTables } = await import("./ensureTables");
  await ensureBenchmarkTables();
  const { benchmarkFixtures } = await import("@shared/schema");
  const { startEarsRun, startBrainRun } = await import("./orchestrator");
  const { downloadRecordingWav } = await import("./recordedCalls");

  const [call] = await db.select().from(calls).where(eq(calls.callSid, callSid)).limit(1);
  if (!call) { console.warn(`[DiagRecording] auto-benchmark: no call row for ${callSid}`); return; }
  const meta = (call.metadata as any) ?? {};
  const recordingUrl = meta.benchmarkRecordingUrl as string | undefined;

  const referenceTurns = transcriptToReferenceTurns(call.transcript ?? "");
  if (referenceTurns.length === 0) {
    console.warn(`[DiagRecording] auto-benchmark: ${callSid} has no persisted transcript; skipping (recording stays available in Recorded Calls)`);
    return;
  }

  // Durable idempotency: one fixture per call, enforced by the unique index
  // on source_call_sid (holds across restarts/processes). ON CONFLICT DO
  // NOTHING + re-select closes the concurrent-insert race.
  const existing = await db.select({ id: benchmarkFixtures.id })
    .from(benchmarkFixtures).where(eq(benchmarkFixtures.sourceCallSid, callSid)).limit(1);
  let fixtureId = existing[0]?.id;

  if (!fixtureId) {
    let audioBase64: string | null = null;
    if (recordingUrl || meta.recordingSid) {
      try {
        audioBase64 = (await downloadRecordingWav(recordingUrl, meta.recordingSid)).toString("base64");
      } catch (e: any) {
        console.error(`[DiagRecording] auto-benchmark: audio download failed for ${callSid} (BRAIN still runs):`, e?.message ?? e);
      }
    }
    const inserted = await db.insert(benchmarkFixtures).values({
      title: `Diagnostic call ${new Date(call.startedAt as any).toISOString().slice(0, 16).replace("T", " ")} (${call.direction})`,
      kind: "recorded_call",
      goal: meta.goalText || "",
      referenceTurns,
      criticalEntities: {},
      confirmedFacts: [],
      audioBase64,
      audioFormat: audioBase64 ? "wav" : null,
      audioChannels: audioBase64 ? "dual" : null,
      sourceCallSid: callSid,
      tags: ["diagnostic", "auto"],
    }).onConflictDoNothing({ target: benchmarkFixtures.sourceCallSid })
      .returning({ id: benchmarkFixtures.id });
    fixtureId = inserted[0]?.id
      ?? (await db.select({ id: benchmarkFixtures.id })
        .from(benchmarkFixtures).where(eq(benchmarkFixtures.sourceCallSid, callSid)).limit(1))[0]?.id;
    if (!fixtureId) throw new Error(`fixture insert/select race lost for ${callSid}`);
  }

  // Kick both benchmarks; each is independent and fail-soft.
  const results = await Promise.allSettled([
    startEarsRun([fixtureId]),
    startBrainRun(fixtureId, { judgeEnabled: true }),
  ]);
  for (const r of results) {
    if (r.status === "rejected") console.error(`[DiagRecording] auto-benchmark run start failed for ${callSid}:`, r.reason?.message ?? r.reason);
  }
  console.log(`[DiagRecording] auto-benchmark started for ${callSid} (fixture ${fixtureId})`);
}
