import { describe, expect, it } from "vitest";
import { freezeCorpus, sha, type Fixture, type Reference } from "./contracts";
import { guestAudio, measure, replay, type ReplaySession } from "./replay";
import type { Hint } from "./protocol";

function fixture(id = "00000000-0000-4000-8000-000000000001"): Fixture {
  return {
    id, recordingSid: "RE" + "0".repeat(32), wavMd5: "original",
    audioSha256: sha("original"), goal: "saved goal", goalHash: sha("saved goal"),
    durationMs: 6000, roles: ["owner", "guest"], vadHash: sha("vad"),
    vad: [
      { role: "owner", channel: 0, segments: [{ startMs: 2000, endMs: 2800 }] },
      { role: "guest", channel: 1, segments: [{ startMs: 0, endMs: 800 }, { startMs: 4000, endMs: 4800 }] },
    ],
  };
}
const reference: Reference[] = [
  { id: "g1", role: "guest", text: "First question?", startMs: 0, endMs: 1000 },
  { id: "o", role: "owner", text: "Owner fact", startMs: 2000, endMs: 3000 },
  { id: "g2", role: "guest", text: "Second question?", startMs: 4000, endMs: 5000 },
];
function hint(id: string, first: number): Hint {
  return { id, text: "Could you clarify?", firstWordAt: first, fullAt: first + 100, completed: true, interrupted: false };
}
function wav(f: Fixture) {
  const samples = f.durationMs * 8, wav = Buffer.alloc(44 + samples * 4);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 4, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(1000, 44 + i * 4 + 2);
  return wav;
}
describe("frozen corpus and physical audio (offline)", () => {
  it("preserves the same 36 recordings and saved-goal panel, rejects changed goals/corpus", () => {
    const fixtures = Array.from({ length: 36 }, (_, i) => ({
      ...fixture("00000000-0000-4000-8000-" + String(i).padStart(12, "0")), durationMs: 6000 + i * 100,
    }));
    const identity = fixtures.map(f => ({
      id: f.id, audio: f.audioSha256, vad: f.vadHash, goal: f.goalHash, roles: f.roles,
    })).sort((a, b) => a.id.localeCompare(b.id));
    const manifest = { corpusHash: sha(JSON.stringify(identity)), fixtures };
    const panel = [fixtures[3].id, fixtures[1].id];
    const frozen = freezeCorpus(manifest, panel);
    expect(frozen.canary.id).toBe(fixtures[1].id); expect(frozen.panel).toHaveLength(2);
    const changed = structuredClone(manifest); changed.fixtures[0].goal = "invented";
    expect(() => freezeCorpus(changed, panel)).toThrow("GOAL_CHANGED");
    expect(() => freezeCorpus({ ...manifest, corpusHash: sha("changed") }, panel)).toThrow("CORPUS_CHANGED");
    expect(() => freezeCorpus(manifest, [panel[0], panel[0]])).toThrow("INVALID_FIXED_PANEL");
  });
  it("extracts only Guest at original telephone quality and refuses altered/non-8k audio", () => {
    const f = fixture(), bytes = wav(f); f.audioSha256 = sha(bytes);
    const audio = guestAudio(f, bytes);
    expect(audio.length).toBe(f.durationMs * 8);
    expect(audio[0]).not.toBe(255); // Guest signal, not silent Owner.
    expect(() => guestAudio({ ...f, audioSha256: sha("other") }, bytes)).toThrow("AUDIO_CHANGED");
    const other = Buffer.from(bytes); other.writeUInt32LE(16000, 24);
    expect(() => guestAudio({ ...f, audioSha256: sha(other) }, other)).toThrow("ORIGINAL_8KHZ");
  });
  it("uses physical VAD end, includes missing replies and distinguishes extra Owner replies", () => {
    const result = measure(fixture(), reference, [hint("h1", 1500), hint("owner-extra", 3500)], []);
    expect(result.observations[0]).toMatchObject({ speechEndMs: 800, firstWordMs: 1500 });
    expect(result.latencyMs).toEqual([700]); expect(result.coverage).toBe(.5);
    expect(result.observations[1]).toMatchObject({ hint: null, reason: "NO_HINT" });
    expect(result.missing).toBe(1); expect(result.extraOnOwner).toBe(1); expect(result.valid).toBe(true);
  });
  it("does not reject an entire call because an algorithm returns no hints", () => {
    const result = measure(fixture(), reference, [], []);
    expect(result.valid).toBe(true); expect(result.coverage).toBe(0);
    expect(result.latencyMs).toEqual([]); expect(result.missing).toBe(2);
  });
  it("rejects ambiguous attribution separately, never matches replies by ordinal", () => {
    const result = measure(fixture(), reference, [hint("h1", 1300), hint("h2", 1500), hint("early", 700)], []);
    expect(result.observations[0].ambiguous).toBe(true);
    expect(result.ambiguityFraction).toBe(.5); expect(result.valid).toBe(false);
    expect(result.observations[1].hint).toBeNull(); expect(result.extras).toBe(3);
  });
  it("the 30% threshold is strictly greater-than, not greater-or-equal", () => {
    const f = fixture(); f.durationMs = 20_000;
    const refs = Array.from({ length: 10 }, (_, i) => ({
      id: "g" + i, role: "guest" as const, text: "Question?", startMs: i * 2000, endMs: i * 2000 + 1000,
    }));
    const segments = refs.map(r => ({ startMs: r.startMs, endMs: r.endMs - 100 }));
    f.vad[1].segments = segments.slice(3);
    expect(measure(f, refs, [], []).valid).toBe(true);
    f.vad[1].segments = segments.slice(4);
    expect(measure(f, refs, [], []).valid).toBe(false);
  });
  it("preserves interruptions as missing coverage, rather than successful latency", () => {
    const h = { ...hint("interrupted", 1500), completed: false, interrupted: true };
    const result = measure(fixture(), reference, [h], []);
    expect(result.interruptions).toBe(1); expect(result.coverage).toBe(0);
    expect(result.observations[0].reason).toBe("INTERRUPTED"); expect(result.latencyMs).toEqual([]);
  });
  it("streams original audio at 1x, releases Owner context after its end and sends a silence tail", async () => {
    const f = fixture(), bytes = wav(f); f.audioSha256 = sha(bytes);
    let time = 0, audioFrames = 0; const ownerAt: number[] = [];
    const session: ReplaySession = {
      fatal: null, protocol: { hints: [], events: [] }, async open() {}, beginAudio() {},
      audio() { audioFrames++; }, owner() { ownerAt.push(time); }, async close() {},
    };
    const result = await replay(f, bytes, reference, session, {
      now: () => time, sleep: async ms => { time += ms; },
    });
    expect(result.valid).toBe(true); expect(result.maxDriftMs).toBe(0);
    expect(ownerAt).toEqual([3000]); expect(audioFrames).toBe((6000 + 12_000) / 20);
  });
  it("marks clock errors separately and closes the session on failure", async () => {
    const f = fixture(), bytes = wav(f); f.audioSha256 = sha(bytes);
    let time = 0, closed = false;
    const session: ReplaySession = {
      fatal: null, protocol: { hints: [], events: [] }, async open() {}, beginAudio() {},
      audio() {}, owner() {}, async close() { closed = true; },
    };
    const result = await replay(f, bytes, reference, session, {
      now: () => time, sleep: async ms => { time += ms + 301; },
    });
    expect(result.valid).toBe(false); expect(result.error).toBe("REPLAY_CLOCK_DRIFT_OVER_300MS");
    expect(closed).toBe(true);
  });
});
