import { createHash } from "node:crypto";
import type { ElevenTiming } from "../../shared/elevenLabProfiles";

export type Profile = "baseline" | "optimized";
export type Language = "en" | "ru" | "es";
export const languages: Language[] = ["en", "ru", "es"];
export const scenarios = languages.flatMap(language =>
  ["text", "number", "address"].map(kind => ({ id: `${language}-${kind}`, language, kind })));
export type Scenario = (typeof scenarios)[number];
export interface Options {
  seed: string; repetitions: number; warmups: number; retries: number;
  maxSessions: number; maxSessionSeconds: number; maxEngineRequests: number;
  maxFixtureCharacters: number; maxWallSeconds: number;
}
export function options(args: string[]): Options {
  const allowed = new Set(["run", "plan", "seed", "repetitions", "warmups", "retries",
    "max-sessions", "max-session-seconds", "max-engine-requests", "max-fixture-characters", "max-wall-seconds"]);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (!args[i].startsWith("--") || !allowed.has(key) || values.has(key)) throw Error(`Unknown/duplicate option: ${args[i]}`);
    if (key === "run" || key === "plan") { values.set(key, "true"); continue; }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw Error(`Missing --${key}`);
    values.set(key, value);
  }
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const n = Number(values.get(key) ?? fallback);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw Error(`Invalid --${key} (${min}..${max})`);
    return n;
  };
  return {
    seed: values.get("seed") ?? "eleven-paired-v1",
    repetitions: integer("repetitions", 10, 2, 40), warmups: integer("warmups", 1, 1, 3),
    retries: integer("retries", 0, 0, 2),
    maxSessions: integer("max-sessions", 0, 0, 100),
    maxSessionSeconds: integer("max-session-seconds", 240, 30, 290),
    maxEngineRequests: integer("max-engine-requests", 0, 0, 10000),
    maxFixtureCharacters: integer("max-fixture-characters", 0, 0, 50000),
    maxWallSeconds: integer("max-wall-seconds", 0, 0, 172800),
  };
}
export function rng(seed: string) {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => { state += 0x6D2B79F5; let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function schedule(o: Options) {
  const random = rng(o.seed);
  const pairs = [
    ...Array.from({ length: o.warmups }, (_, i) => ({ phase: "warmup", pair: `warmup-${i}` })),
    ...shuffle(Array.from({ length: o.repetitions }, (_, i) => ({ phase: "measured", pair: `pair-${i}` })), random),
  ];
  return pairs.flatMap(pair => {
    const order = shuffle(scenarios, random);
    return shuffle<Profile>(["baseline", "optimized"], random).map((profile, position) => ({
      ...pair, profile, position, scenarios: order,
    }));
  });
}
export type Scheduled = ReturnType<typeof schedule>[number];
export interface Callback {
  id: string; scenarioId: string | null; receivedMs: number; fingerprint: string;
  accepted: boolean; finished: boolean; closedEarly: boolean; streamCompleted: boolean;
  repeatedTranscript: boolean; timingId?: string;
}
export interface Observation {
  scenarioId: string; language: Language; kind: string; startedMs: number; endedMs: number;
  status: "ok" | "error" | "skipped"; error?: string;
  pauses: { startMs: number; endMs: number }[];
  callbacks: Callback[]; timings: ElevenTiming[];
  audioFrames: { atMs: number; eventId: number | null }[];
}
/** No nearest-time matching: only an exact one-to-one sequence with all accepted
 * callbacks is admissible. Provider retry detection uses transcript fingerprints,
 * not a claim that the provider supplied a stable request/turn ID. */
export function correlate(callbacks: Callback[], timings: ElevenTiming[]) {
  const accepted = callbacks.filter(c => c.accepted);
  if (accepted.length !== timings.length) return false;
  accepted.forEach((c, i) => { c.timingId = timings[i].id; });
  return true;
}
export function distribution(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p: number) => sorted.length ? sorted[Math.ceil((sorted.length - 1) * p)] : null;
  return { n: sorted.length, min: q(0), p50: q(.5), p90: q(.9), p95: q(.95), max: q(1),
    mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null };
}
export interface Attempt extends Scheduled {
  id: string; attempt: number; retryOf: string | null; status: string;
  observations: Observation[]; callbacks: Callback[]; timings: ElevenTiming[];
  correlationValid: boolean; error?: string;
}
export function summarize(attempts: Attempt[], seed: string, planned: Scheduled[] = attempts.filter(a => a.attempt === 0)) {
  const measured = attempts.filter(a => a.phase === "measured");
  const measuredPlan = planned.filter(a => a.phase === "measured");
  const groups = (["baseline", "optimized"] as Profile[]).flatMap(profile => languages.map(language => {
    const runs = measured.filter(a => a.profile === profile);
    const obs = runs.flatMap(a => a.observations.filter(o => o.language === language).map(o => ({ a, o })));
    const eligible = obs.filter(({ a, o }) => a.attempt === 0 && a.correlationValid && o.status === "ok");
    const timings = eligible.flatMap(({ o }) => o.timings.filter(t => !t.cancelled &&
      o.callbacks.some(c => c.timingId === t.id && c.finished && c.streamCompleted && !c.closedEarly && !c.repeatedTranscript)));
    return { profile, language, trials: obs.length,
      plannedFirstAttemptTrials: measuredPlan.filter(a => a.profile === profile).length * 3,
      notStartedSessions: measuredPlan.filter(p => p.profile === profile &&
        !measured.some(a => a.pair === p.pair && a.profile === profile && a.attempt === 0)).length,
      errors: obs.filter(({ o }) => o.status === "error").length,
      skipped: obs.filter(({ o }) => o.status === "skipped").length,
      errorRate: obs.length ? obs.filter(({ o }) => o.status === "error").length / obs.length : null,
      sessionErrors: runs.filter(a => a.status !== "ok").length,
      retrySessions: runs.filter(a => a.attempt > 0).length,
      cancelledRequests: obs.flatMap(({ o }) => o.timings).filter(t => t.cancelled).length,
      ambiguousSessions: runs.filter(a => !a.correlationValid).length,
      repeatedTranscriptRequests: obs.flatMap(({ o }) => o.callbacks).filter(c => c.repeatedTranscript).length,
      engineFirstTextMs: distribution(timings.flatMap(t => t.firstTextMs === null ? [] : [t.firstTextMs - t.requestReceivedMs])),
      // Deliberately separate; provider audio association is best-effort.
      engineToProviderFirstFrameBestEffortMs: distribution(timings.flatMap(t => t.firstAudioMs === null ? [] : [t.firstAudioMs - t.requestReceivedMs])),
      requestDuringInternalPause: obs.filter(({ o }) => o.callbacks.some(c => c.accepted &&
        o.pauses.some(p => c.receivedMs >= p.startMs && c.receivedMs < p.endMs))).length,
      frameDuringInternalPause: obs.filter(({ o }) => o.audioFrames.some(f =>
        o.pauses.some(p => f.atMs >= p.startMs && f.atMs < p.endMs))).length,
      pauseTrials: obs.filter(({ o }) => o.pauses.length > 0).length,
    };
  }));
  const paired = scenarios.flatMap(s => (["engine_request_to_first_text_ms", "engine_request_to_first_provider_frame_best_effort_ms"] as const).map(metric => {
    const deltas: number[] = [];
    for (const a of measured.filter(a => a.profile === "baseline" && a.attempt === 0)) {
      const b = measured.find(b => b.pair === a.pair && b.profile === "optimized" && b.attempt === 0);
      const value = (run: Attempt | undefined) => {
        const o = run?.observations.find(o => o.scenarioId === s.id);
        if (run?.status !== "ok" || !run.correlationValid || o?.status !== "ok") return null;
        // Multiple callbacks, replay, cancellation, or partial text cannot become
        // a convenient "fast" sample. Keep them in error/cancellation counts.
        if (o.callbacks.length !== 1 || o.timings.length !== 1) return null;
        const t = o.timings[0];
        const c = o.callbacks[0];
        const end = metric === "engine_request_to_first_text_ms" ? t.firstTextMs : t.firstAudioMs;
        if (t.cancelled || end === null || !c.finished || !c.streamCompleted || c.closedEarly || c.repeatedTranscript) return null;
        return end - t.requestReceivedMs;
      };
      const av = value(a), bv = value(b);
      if (av !== null && bv !== null) deltas.push(bv - av);
    }
    const random = rng(`${seed}:${s.id}:${metric}:bootstrap`);
    const boot = deltas.length < 2 ? [] : Array.from({ length: 2000 }, () =>
      distribution(deltas.map(() => deltas[Math.floor(random() * deltas.length)])).p50!);
    boot.sort((a, b) => a - b);
    return { scenarioId: s.id, language: s.language, metric,
      optimizedMinusBaseline: distribution(deltas), completePairs: deltas.length,
      medianDeltaBootstrap95: boot.length ? [boot[49], boot[1949]] : null,
      plannedPairs: measuredPlan.filter(a => a.profile === "baseline").length,
      missingOrExcludedPairs: measuredPlan.filter(a => a.profile === "baseline").length - deltas.length };
  }));
  return { groups, paired, notes: [
    "Warmups excluded. Primary paired estimate uses first attempts only; retries never replace failures.",
    "Negative delta means earlier Engine first text, not faster heard speech. No winner or subjective rating is assigned.",
    "Bootstrap resamples independent session pairs, not individual frames. Small samples and sequential provider load limit inference.",
    "Profile bundles differ in TTS, primary language and checkpoint policy; this is not an isolated model comparison.",
    "Synthetic PCM, first provider frame and SDK telemetry do not measure physically heard audio. No playback or microphone tested.",
    "Early pause entry is a transport observation, not an acoustic/ASR correctness judgment.",
  ] };
}
