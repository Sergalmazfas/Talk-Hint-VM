// Task 154 — spec §14 A–J: hints & corrections from the Tutor Engine are
// rendered, never spoken, never treated as learner speech, and never trigger
// extra LLM calls. The classifier is the SAME source the page executes
// (interpolated via toString, like pttNext), so these tests exercise the
// real browser logic. Page-level invariants are asserted on the built HTML.
import { describe, it, expect } from "vitest";
import { classifyEngineEvent } from "../tutorRealtimeUi";
import { TUTOR_AVATAR_PAGE_HTML } from "../tutorAvatarPage";

// Real payloads captured live from the engine (tutor-realtime/1.0, 2026-08-13).
const REAL_HINT = { type: "tutor.hint", hint: "Could you please help me with my documents?", mode: "assisted" };
const REAL_CORRECTION = {
  type: "tutor.correction",
  mode: "teacher",
  correction: {
    user_said: "I want ask my lawyer.",
    better: "I want to ask my lawyer.",
    explanation: "После 'want' используется 'to + глагол'.",
    translation: "Я хочу спросить своего юриста.",
    category: "grammar",
  },
};

describe("14A/B — tutor.hint renders automatically as a hint card", () => {
  it("classifies a real hint payload into a hint action", () => {
    const a = classifyEngineEvent(REAL_HINT);
    expect(a).toEqual({ kind: "hint", text: "Could you please help me with my documents?", translation: null });
  });
  it("keeps an engine-provided translation when present", () => {
    const a = classifyEngineEvent({ ...REAL_HINT, translation: "Не могли бы вы помочь мне с документами?" });
    expect(a).toMatchObject({ kind: "hint", translation: "Не могли бы вы помочь мне с документами?" });
  });
  it("drops empty/malformed hints instead of rendering blanks", () => {
    expect(classifyEngineEvent({ type: "tutor.hint", hint: "  " })).toBeNull();
    expect(classifyEngineEvent({ type: "tutor.hint" })).toBeNull();
  });
  it("page auto-displays hints from the ws handler (no button required)", () => {
    // The ws message path routes through classifyEngineEvent and calls
    // showHintCard immediately on kind === "hint".
    expect(TUTOR_AVATAR_PAGE_HTML).toMatch(/act\.kind === "hint"[\s\S]{0,120}showHintCard\(act\)/);
  });
});

describe("14C/D — a hint is NEVER learner speech and NEVER spoken", () => {
  const hintFnBody = () => {
    const m = TUTOR_AVATAR_PAGE_HTML.match(/function showHintCard\(hint\) \{([\s\S]*?)\n\}/);
    expect(m, "showHintCard must exist in the page").toBeTruthy();
    return m![1];
  };
  it("showHintCard never creates a user bubble or touches transcripts", () => {
    const body = hintFnBody();
    expect(body).not.toContain('addCard("user');
    expect(body).not.toContain("userCard");
    expect(body).not.toContain("saidAnything");
  });
  it("showHintCard never reaches TTS/audio or the engine socket", () => {
    const body = hintFnBody();
    expect(body).not.toContain("speakBuffer");
    expect(body).not.toContain("speakAudio");
    expect(body).not.toContain("replayAudio");
    expect(body).not.toContain("ws.send");
  });
  it("classifier can only map tutor.hint to the render-only 'hint' kind", () => {
    const a = classifyEngineEvent(REAL_HINT)!;
    expect(a.kind).toBe("hint");
  });
});

describe("14E — tutor.correction renders as a secondary card", () => {
  it("classifies the real correction payload with all fields", () => {
    expect(classifyEngineEvent(REAL_CORRECTION)).toEqual({
      kind: "correction",
      userSaid: "I want ask my lawyer.",
      better: "I want to ask my lawyer.",
      explanation: "После 'want' используется 'to + глагол'.",
      translation: "Я хочу спросить своего юриста.",
      category: "grammar",
    });
  });
  it("drops corrections without a usable 'better' phrase", () => {
    expect(classifyEngineEvent({ type: "tutor.correction", correction: {} })).toBeNull();
    expect(classifyEngineEvent({ type: "tutor.correction" })).toBeNull();
  });
  it("page renders corrections without interrupting the turn (no dispatch/TTS)", () => {
    const m = TUTOR_AVATAR_PAGE_HTML.match(/function showCorrectionCard\(c\) \{([\s\S]*?)\n\}/);
    expect(m).toBeTruthy();
    expect(m![1]).not.toContain("dispatch(");
    expect(m![1]).not.toContain("speakBuffer");
    expect(m![1]).not.toContain("ws.send");
  });
});

describe("14F — tutor.text.final reconciles, never duplicates Emma bubbles", () => {
  it("classifies final text", () => {
    expect(classifyEngineEvent({ type: "tutor.text.final", text: "Hello!" })).toEqual({ kind: "finalText", text: "Hello!" });
    expect(classifyEngineEvent({ type: "tutor.text.final", text: " " })).toBeNull();
  });
  it("the finalText branch reconciles ONE tutor card — creates it only if the turn had no audio", () => {
    const m = TUTOR_AVATAR_PAGE_HTML.match(/act\.kind === "finalText"\) \{([\s\S]*?)\n    \}/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain('if (!tutorCard) tutorCard = addCard("tutor streaming")');
    expect(m![1]).toContain("tutorCard.textContent = act.text");
    expect(m![1]).not.toContain("finishTutorCard(");
  });
  it("after final text, late deltas cannot append stale text", () => {
    const m = TUTOR_AVATAR_PAGE_HTML.match(/act\.kind === "finalText"\) \{([\s\S]*?)\n    \}/);
    expect(m![1]).toContain("tutorTextFinal = true");
    expect(TUTOR_AVATAR_PAGE_HTML).toMatch(/tutor\.text\.delta[\s\S]{0,200}if \(tutorTextFinal\) return;/);
    // and the lock is released when the turn closes
    expect(TUTOR_AVATAR_PAGE_HTML).toMatch(/turn\.completed[\s\S]{0,400}tutorTextFinal = false/);
  });
});

describe("14G — turn.state drives truthful status labels only", () => {
  it("maps all four active states and nulls TURN_COMPLETE/unknown", () => {
    for (const [s, out] of [
      ["LISTENING", "listening"], ["TRANSCRIBING", "transcribing"],
      ["THINKING", "thinking"], ["SPEAKING", "speaking"],
    ] as const) {
      expect(classifyEngineEvent({ type: "turn.state", state: s })).toEqual({ kind: "turnState", state: out });
    }
    expect(classifyEngineEvent({ type: "turn.state", state: "TURN_COMPLETE" })).toEqual({ kind: "turnState", state: null });
    expect(classifyEngineEvent({ type: "turn.state", state: "GIBBERISH" })).toEqual({ kind: "turnState", state: null });
  });
  it("engine state refines the label but never drives the PTT machine", () => {
    const m = TUTOR_AVATAR_PAGE_HTML.match(/act\.kind === "turnState"\) \{([\s\S]*?)\}/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain("engineTurnLabel = act.state");
    expect(m![1]).not.toContain("dispatch(");
  });
});

describe("14H — unknown or malformed events are ignored, never fatal", () => {
  it("returns null for unknown types and garbage inputs", () => {
    expect(classifyEngineEvent({ type: "some.future.event", payload: 1 })).toBeNull();
    expect(classifyEngineEvent({ type: "avatar.lipsync", visemes: [] })).toBeNull();
    expect(classifyEngineEvent({})).toBeNull();
    expect(classifyEngineEvent(null)).toBeNull();
    expect(classifyEngineEvent("x")).toBeNull();
    expect(classifyEngineEvent({ type: 42 })).toBeNull();
  });
  it("the ws handler bails on null actions instead of throwing", () => {
    expect(TUTOR_AVATAR_PAGE_HTML).toMatch(/const act = classifyEngineEvent\(msg\);\s*\n\s*if \(!act\) return;/);
  });
});

describe("14I — «Что сказать?» never triggers an API or LLM call", () => {
  it("chip handler only reveals existing hints or shows an honest toast", () => {
    const m = TUTOR_AVATAR_PAGE_HTML.match(/hintChip\.onclick = \(\) => \{([\s\S]*?)\n\};/);
    expect(m).toBeTruthy();
    const body = m![1];
    expect(body).not.toContain("fetch(");
    expect(body).not.toContain("api(");
    expect(body).not.toContain("ws.send");
    expect(body).toContain("showToast(L.noHintYet)");
  });
  it("the fake «Скоро — нужна поддержка движка» toast is gone from the chip", () => {
    expect(TUTOR_AVATAR_PAGE_HTML).not.toContain("hintChip.onclick = () => showToast(L.soon)");
  });
});

describe("14J — Call Memory flow untouched", () => {
  it("quit → end → review path is still wired in the page", () => {
    // Structural smoke checks: the memory pipeline elements and endpoints
    // referenced by the existing flow are all still present.
    for (const marker of ["memPending", "reviewHint", "confirmBtn", "/end", "quitSheet", "endBtn"]) {
      expect(TUTOR_AVATAR_PAGE_HTML).toContain(marker);
    }
  });
  it("transcript.normalized never rewrites the visible raw transcript", () => {
    const m = TUTOR_AVATAR_PAGE_HTML.match(/act\.kind === "normalized"\) \{([\s\S]*?)\}/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain("dataset.normalized");
    expect(m![1]).not.toContain("textContent");
  });
  it("normalized text binds by turn_id — never to the previous turn's bubble", () => {
    const m = TUTOR_AVATAR_PAGE_HTML.match(/act\.kind === "normalized"\) \{([\s\S]*?)pendingNormalized = \{/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain("tid === lastUserTurnId");
    // early-arrival buffer is applied when the matching speech.final lands
    expect(TUTOR_AVATAR_PAGE_HTML).toMatch(/pendingNormalized\.turnId === lastUserTurnId[\s\S]{0,200}dataset\.normalized = pendingNormalized\.text/);
  });
});
