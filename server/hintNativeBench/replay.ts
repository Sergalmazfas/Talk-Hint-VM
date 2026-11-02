import { performance } from "node:perf_hooks";
import { sha, type Fixture, type Reference } from "./contracts";
import type { Hint, NativeEvent } from "./protocol";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function mulaw(sample: number) {
  const sign = sample < 0 ? 0x80 : 0;
  sample = Math.min(Math.abs(sample), 32635) + 132;
  let exponent = 7;
  for (let mask = 0x4000; !(sample & mask) && exponent > 0; mask >>= 1) exponent--;
  return (~(sign | exponent << 4 | (sample >> (exponent + 3) & 15))) & 255;
}
/** Preserve source 8k dual PCM telephone quality; no denoising or enhancement. */
export function guestAudio(f: Fixture, wav: Buffer) {
  if (sha(wav) !== f.audioSha256) throw Error("AUDIO_CHANGED");
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE")
    throw Error("BAD_WAV");
  let channels = 0, rate = 0, bits = 0, format = 0, data: Buffer | undefined;
  for (let off = 12; off + 8 <= wav.length;) {
    const length = wav.readUInt32LE(off + 4), id = wav.toString("ascii", off, off + 4);
    if (off + 8 + length > wav.length) throw Error("TRUNCATED_WAV");
    if (id === "fmt ") {
      if (length < 16) throw Error("BAD_WAV_FORMAT");
      format = wav.readUInt16LE(off + 8); channels = wav.readUInt16LE(off + 10);
      rate = wav.readUInt32LE(off + 12); bits = wav.readUInt16LE(off + 22);
    }
    if (id === "data") { if (data) throw Error("MULTIPLE_WAV_DATA"); data = wav.subarray(off + 8, off + 8 + length); }
    off += length + 8 + length % 2;
  }
  if (format !== 1 || channels !== 2 || rate !== 8000 || bits !== 16 || !data || data.length % 4)
    throw Error("NEED_ORIGINAL_8KHZ_DUAL_PCM16");
  if (Math.abs(data.length / 32 - f.durationMs) > 1) throw Error("AUDIO_DURATION_CHANGED");
  const guest = f.roles.indexOf("guest");
  if (guest < 0 || new Set(f.roles).size !== 2) throw Error("ROLES_UNVERIFIED");
  const result = Buffer.alloc(data.length / 4);
  for (let i = 0; i < result.length; i++) result[i] = mulaw(data.readInt16LE(i * 4 + guest * 2));
  return result;
}

export interface ReplaySession {
  open(): Promise<void>; beginAudio(epoch: number): void;
  audio(frame: Buffer): void; owner(text: string): void; close(): Promise<void>;
  fatal: Error | null;
  protocol: { hints: Hint[]; events: NativeEvent[] };
}
export function validateReference(f: Fixture, reference: Reference[]) {
  if (!reference.length || new Set(reference.map(t => t.id)).size !== reference.length)
    throw Error("REFERENCE_REQUIRED");
  for (const r of reference) {
    if (!["owner", "guest"].includes(r.role) || !r.text.trim() ||
        !Number.isFinite(r.startMs) || !Number.isFinite(r.endMs) ||
        r.startMs < 0 || r.endMs <= r.startMs || r.endMs > f.durationMs)
      throw Error("INVALID_REFERENCE_TIMELINE");
  }
  // The caller must separately freeze source verification flags and hashes.
  // Text is context/judge evidence, NEVER an EOT trigger.
}
export type Observation = {
  turnId: string; speechEndMs: number | null; hint: string | null;
  firstWordMs: number | null; fullHintMs: number | null; autoEotMs: number | null;
  ambiguous: boolean; reason: string | null;
};
export function measure(f: Fixture, reference: Reference[], hints: Hint[], events: NativeEvent[]) {
  validateReference(f, reference);
  const guest = f.vad[f.roles.indexOf("guest")].segments;
  const sorted = [...reference].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const assigned = new Set<string>();
  const observations: Observation[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (r.role !== "guest") continue;
    const intersect = guest.filter(s => s.endMs > r.startMs && s.startMs < r.endMs);
    const uncertain = !intersect.length || intersect.some(s => s.endMs > r.endMs + 64);
    const end = uncertain ? null : Math.max(...intersect.map(s => s.endMs));
    // A new Owner or Guest turn bounds this response's attribution. No ordinal matching.
    const next = sorted.slice(i + 1).find(t => t.startMs > r.startMs)?.startMs ?? f.durationMs + 30_000;
    const candidates = hints.filter(h => !assigned.has(h.id) && h.firstWordAt !== null &&
      h.firstWordAt >= (end ?? r.endMs) && h.firstWordAt < next);
    const h = candidates.length === 1 ? candidates[0] : null;
    if (h) assigned.add(h.id);
    const eot = end === null ? [] : events.filter(e =>
      e.kind === "eot" && e.audioEndMs !== null && e.audioEndMs >= end &&
      e.audioEndMs < next);
    const reason = uncertain ? "VAD_ALIGNMENT_UNCERTAIN" : candidates.length > 1
      ? "MULTIPLE_RESPONSES_AMBIGUOUS" : !h ? "NO_HINT" : !h.completed
        ? h.interrupted ? "INTERRUPTED" : "UNFINISHED" : null;
    const valid = !!h?.completed && reason === null;
    observations.push({
      turnId: r.id, speechEndMs: end, hint: valid ? h!.text : null,
      firstWordMs: valid ? h!.firstWordAt : null, fullHintMs: valid ? h!.fullAt : null,
      autoEotMs: eot.length === 1 && eot[0].kind === "eot" ? eot[0].at : null,
      ambiguous: uncertain || candidates.length > 1, reason,
    });
  }
  const ambiguous = observations.filter(o => o.ambiguous).length;
  const eligible = observations.filter(o => !o.ambiguous);
  const extra = hints.filter(h => !assigned.has(h.id));
  const extraOnOwner = extra.filter(h => h.firstWordAt !== null && sorted.some((r, i) =>
    r.role === "owner" && h.firstWordAt! >= r.startMs &&
    h.firstWordAt! < (sorted[i + 1]?.startMs ?? f.durationMs + 30_000))).length;
  return {
    observations, valid: observations.length > 0 && ambiguous / observations.length <= .30,
    ambiguityFraction: observations.length ? ambiguous / observations.length : null,
    coverage: eligible.length ? eligible.filter(o => o.hint !== null).length / eligible.length : null,
    eligible: eligible.length, missing: eligible.filter(o => o.hint === null).length,
    extras: extra.length, extraOnOwner, interruptions: hints.filter(h => h.interrupted).length,
    overlappingReplies: hints.filter((h, i) => hints.slice(i + 1).some(other =>
      other.firstWordAt !== null && h.firstWordAt !== null &&
      other.firstWordAt < h.fullAt && h.firstWordAt < other.fullAt)).length,
    latencyMs: eligible.filter(o => o.firstWordMs !== null).map(o => o.firstWordMs! - o.speechEndMs!),
    fullLatencyMs: eligible.filter(o => o.fullHintMs !== null).map(o => o.fullHintMs! - o.speechEndMs!),
  };
}
export async function replay(f: Fixture, wav: Buffer, reference: Reference[], session: ReplaySession,
  clock = { now: () => performance.now(), sleep }) {
  validateReference(f, reference);
  const audio = guestAudio(f, wav); // All CPU work BEFORE the audio clock.
  const owners = reference.filter(r => r.role === "owner").sort((a, b) => a.endMs - b.endMs);
  let owner = 0, maxDriftMs = 0, error: string | null = null;
  try {
    await session.open();
    const epoch = clock.now(); session.beginAudio(epoch);
    // Full original Guest channel, then bounded silence drain. No Flux or manual commit.
    for (let offset = 0; offset < audio.length + 8000 * 12; offset += 160) {
      await clock.sleep(Math.max(0, epoch + offset / 8 - clock.now()));
      const elapsed = clock.now() - epoch, drift = elapsed - offset / 8;
      maxDriftMs = Math.max(maxDriftMs, drift);
      if (drift > 300) throw Error("REPLAY_CLOCK_DRIFT_OVER_300MS");
      if (session.fatal) throw session.fatal;
      while (owner < owners.length && owners[owner].endMs <= elapsed) session.owner(owners[owner++].text);
      const frame = Buffer.alloc(160, 255);
      if (offset < audio.length) audio.copy(frame, 0, offset, Math.min(offset + 160, audio.length));
      session.audio(frame);
    }
  } catch (e) { error = (e as Error).message; }
  finally { await session.close(); }
  error ??= session.fatal?.message ?? null;
  const measured = measure(f, reference, session.protocol.hints, session.protocol.events);
  return {
    ...measured, valid: measured.valid && error === null, error, maxDriftMs,
    ownerContext: "frozen reference text, delivered only at its audio end; not production STT",
    vadProvenance: "same automatic unpadded VAD; not human-verified",
  };
}
