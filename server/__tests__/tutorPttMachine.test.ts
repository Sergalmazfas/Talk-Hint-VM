// Push-to-talk state machine tests (Tutor UI v2, spec §13).
// The SAME function source is embedded into the /tutor page, so these tests
// cover the browser behavior too.
import { describe, it, expect } from "vitest";
import { pttNext, micAllowed, type PttState } from "../tutorPttMachine";
import { TUTOR_AVATAR_PAGE_HTML } from "../tutorAvatarPage";

describe("push-to-talk state machine", () => {
  it("happy path: LOADING → READY → RECORDING → PROCESSING → SPEAKING → READY", () => {
    let s: PttState = "LOADING";
    s = pttNext(s, "ready");
    expect(s).toBe("READY");
    s = pttNext(s, "pressDown");
    expect(s).toBe("RECORDING");
    s = pttNext(s, "release");
    expect(s).toBe("PROCESSING");
    s = pttNext(s, "tutorSpeaking");
    expect(s).toBe("SPEAKING");
    s = pttNext(s, "turnCompleted");
    expect(s).toBe("READY");
  });

  it("no continuous capture: mic is allowed ONLY in RECORDING", () => {
    const states: PttState[] = ["LOADING","READY","RECORDING","PROCESSING","SPEAKING","ERROR","ENDING","MEMORY"];
    for (const s of states) expect(micAllowed(s)).toBe(s === "RECORDING");
  });

  it("no audio before press: pressDown is ignored outside READY", () => {
    for (const s of ["LOADING","PROCESSING","SPEAKING","ERROR","ENDING","MEMORY"] as PttState[]) {
      expect(pttNext(s, "pressDown")).toBe(s); // never enters RECORDING
    }
  });

  it("no duplicate utterance on double release: release only acts in RECORDING", () => {
    let s: PttState = "RECORDING";
    s = pttNext(s, "release");
    expect(s).toBe("PROCESSING");
    // second release is a no-op (guards audio.end duplication)
    expect(pttNext(s, "release")).toBe("PROCESSING");
    expect(pttNext("READY", "release")).toBe("READY");
  });

  it("no barge-in: while Emma is speaking the mic cannot start", () => {
    expect(pttNext("SPEAKING", "pressDown")).toBe("SPEAKING");
    expect(micAllowed("SPEAKING")).toBe(false);
  });

  it("race: tutor audio during RECORDING force-stops capture (→ SPEAKING)", () => {
    const s = pttNext("RECORDING", "tutorSpeaking");
    expect(s).toBe("SPEAKING");
    expect(micAllowed(s)).toBe(false);
  });

  it("errors are retriable; ENDING/MEMORY are stable terminals", () => {
    expect(pttNext("READY", "error")).toBe("ERROR");
    expect(pttNext("ERROR", "retry")).toBe("LOADING");
    expect(pttNext("ENDING", "error")).toBe("ENDING");
    expect(pttNext("MEMORY", "end")).toBe("MEMORY");
    expect(pttNext("PROCESSING", "memoryReview")).toBe("MEMORY");
  });
});

describe("/tutor page (Tutor UI v2)", () => {
  const html = TUTOR_AVATAR_PAGE_HTML;

  it("embeds the exact shared state machine source", () => {
    expect(html).toContain(pttNext.toString());
    expect(html).toContain(micAllowed.toString());
  });

  it("is push-to-talk gated: no silence auto-detection loop, gestures wired", () => {
    expect(html).not.toContain("SILENCE_MS"); // old always-listening mode removed
    expect(html).toContain('addEventListener("pointerdown"');
    expect(html).toContain('addEventListener("pointerup"');
    expect(html).toContain('"audio.end"');
  });

  it("keeps one UI language: localized string tables, no mixed hardcoded labels", () => {
    expect(html).toContain("Hold to talk");
    expect(html).toContain("Удерживайте и говорите");
    expect(html).toContain("Emma is thinking…");
    expect(html).toContain("Emma думает…");
    // vague simultaneous state from v1 must be gone
    expect(html).not.toContain("слушает и отвечает");
  });

  it("renders engine data only and keeps auth out of the URL", () => {
    // conversation cards come from engine messages, not local generation
    expect(html).toContain("speech.partial");
    expect(html).toContain("tutor.text.delta");
    expect(html).toContain("tutor.audio.chunk");
    // token in first WS message, never in URL query
    expect(html).toContain('type: "auth", token: session.realtime.token');
    expect(html).not.toContain("?token=");
    // no TalkHint-side TTS endpoints
    expect(html).toContain('ttsEndpoint: "none"');
  });

  it("has lip-sync diagnostics without faking data", () => {
    for (const k of ["audioArrived","timingsFromEngine","timingsDerived","speakAudioCalled","playbackStarted"]) {
      expect(html).toContain(k);
    }
    expect(html).toContain("lipsyncDiag");
  });

  it("keeps the Call Memory confirmation flow intact", () => {
    expect(html).toContain("/api/tutor/memories/");
    expect(html).toContain("/confirm");
    expect(html).toContain("callMemoryConfirmed");
  });
});
