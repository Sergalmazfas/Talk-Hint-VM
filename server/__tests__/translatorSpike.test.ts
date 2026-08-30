// Translator Realtime Spike — contract tests for the dev-only stand gating
// and the OpenAI adapter's cost/prompt helpers. No network access.
import { describe, it, expect, afterEach } from "vitest";
import {
  archiveCurrentRun,
  computeScorecard,
  isSpikeEnabled,
  isValidSpikeToken,
  sanitizeSpikeControls,
  type SpikeArchiveState,
} from "../translation/spike";
import {
  buildInterpreterInstructions,
  estimateTurnCostUsd,
  OpenAIRealtimeTranslationSession,
} from "../translation/openaiRealtimeTranslator";
import type { TranslationEvent } from "../translation/provider";
import { parseSemanticReview, buildSemanticReviewPrompt } from "../translation/reviewJudge";

const ORIGINAL_ENV = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV;
});

describe("translator spike gating", () => {
  it("is disabled entirely in production", () => {
    process.env.NODE_ENV = "production";
    expect(isSpikeEnabled()).toBe(false);
    // Even a hypothetically correct token must be rejected in production.
    expect(isValidSpikeToken("a".repeat(48))).toBe(false);
  });

  it("rejects missing and wrong tokens in development", () => {
    process.env.NODE_ENV = "development";
    expect(isSpikeEnabled()).toBe(true);
    expect(isValidSpikeToken(null)).toBe(false);
    expect(isValidSpikeToken("")).toBe(false);
    expect(isValidSpikeToken("wrong-token")).toBe(false);
    expect(isValidSpikeToken("a".repeat(48))).toBe(false);
  });
});

describe("interpreter instructions (frozen pure-translation prompt)", () => {
  it("names both languages and forbids assistant behavior", () => {
    const p = buildInterpreterInstructions(["ru", "en"]);
    expect(p).toContain("Russian");
    expect(p).toContain("English");
    expect(p).toContain("ONLY the translation");
    expect(p).toContain("NEVER answer questions");
    expect(p).toMatch(/filler/i);
    expect(p).toMatch(/phone numbers/i);
    expect(p).toMatch(/invent/i);
  });

  it("includes the hardening rules against unsolicited responses", () => {
    const p = buildInterpreterInstructions(["ru", "en"]);
    expect(p).toContain("EXACTLY ONE rendition per speaker utterance");
    expect(p).toContain("NEVER a participant");
    expect(p).toContain("never accept or decline invitations");
    expect(p).toContain("ONLY to disambiguate");
    expect(p).toContain("NEVER carry facts");
  });

  it("directed mode translates everything into the output language, mixed input as one utterance", () => {
    const p = buildInterpreterInstructions(["ru", "en"], { inputLang: "auto", outputLang: "en" });
    expect(p).toContain("Translate EVERY speaker utterance into English");
    expect(p).toContain("Detect the speaker's language automatically");
    expect(p).toContain("ONE single English rendition of the entire meaning");
    // Hardening rules present in directed mode too.
    expect(p).toContain("NEVER a participant");
  });

  it("directed mode with a fixed input language names it", () => {
    const p = buildInterpreterInstructions(["es", "ru"], { inputLang: "es", outputLang: "ru" });
    expect(p).toContain("into Russian");
    expect(p).toContain("The speaker speaks Spanish.");
  });
});

describe("sanitizeSpikeControls", () => {
  it("defaults to Auto → English, voice marin", () => {
    expect(sanitizeSpikeControls({})).toEqual({ inputLang: "auto", outputLang: "en", voice: "marin", provider: "openai-realtime" });
  });
  it("accepts allowed values and rejects unknown ones (fail-closed to defaults)", () => {
    expect(sanitizeSpikeControls({ inputLang: "es", outputLang: "ru", voice: "cedar" }))
      .toEqual({ inputLang: "es", outputLang: "ru", voice: "cedar", provider: "openai-realtime" });
    expect(sanitizeSpikeControls({ inputLang: "de", outputLang: "kk", voice: "hasOwnProperty", provider: "evil" }))
      .toEqual({ inputLang: "auto", outputLang: "en", voice: "marin", provider: "openai-realtime" });
  });
});

describe("translator spike run scorecard isolation", () => {
  function runState(
    overrides: Partial<SpikeArchiveState> = {},
  ): SpikeArchiveState {
    return {
      session: { model: "gpt-realtime" },
      sessionConfig: {
        capabilities: {
          turnLifecycle: true,
          audioMinutePriceUsd: null,
        },
      },
      turns: [
        {
          latencyMs: 400,
          estimatedCostUsd: 0.12,
          audioInMs: 1000,
          audioOutMs: 1000,
          translatedTranscript: "Hello",
          sourceItemId: "item-1",
        },
      ],
      sourceUtterances: [
        {
          index: 0,
          itemId: "item-1",
          text: "Привет",
          meaningful: true,
        },
      ],
      cancellations: [],
      review: { results: {}, ranAt: null },
      sessionStartTs: 1_000_000,
      now: 1_120_000,
      errors: [],
      invariantViolations: [],
      suppressedMicroturnsCount: 0,
      gatedIntervals: 0,
      totalGatedMs: 0,
      eventLog: [],
      eventLogDropped: 0,
      ...overrides,
    };
  }

  it("archives each provider with its own capabilities and scoring rules", () => {
    const realtimeState = runState();
    const realtimeRun = archiveCurrentRun(
      realtimeState,
      "controls changed",
      "2026-08-30T10:00:00.000Z",
    )!;

    // Simulate the provider selector changing after the first run was
    // archived. The prior export must remain immutable.
    realtimeState.sessionConfig!.capabilities!.turnLifecycle = false;
    realtimeState.sessionConfig!.capabilities!.audioMinutePriceUsd = 0.034;

    const translateRun = archiveCurrentRun(
      runState({
        session: { model: "gpt-realtime-translate" },
        sessionConfig: {
          capabilities: {
            turnLifecycle: false,
            audioMinutePriceUsd: 0.034,
          },
        },
        turns: [
          {
            latencyMs: 300,
            estimatedCostUsd: 0.001,
            audioInMs: 1000,
            audioOutMs: 1000,
            translatedTranscript: "Hello",
          },
        ],
        sourceUtterances: [
          { index: 0, itemId: null, text: "Привет", meaningful: true },
        ],
      }),
      "controls changed",
      "2026-08-30T10:02:00.000Z",
    )!;

    const exported = JSON.parse(
      JSON.stringify({ completedRuns: [realtimeRun, translateRun] }),
    ).completedRuns;

    expect(exported[0].capabilities).toEqual({
      turnLifecycle: true,
      audioMinutePriceUsd: null,
    });
    expect(exported[0].sessionConfig.capabilities).toEqual(
      exported[0].capabilities,
    );
    expect(exported[0].scorecard).toMatchObject({
      lost_completed_translations: 0,
      correlation_methodology: "provider item ids",
      total_estimated_cost_usd: 0.12,
      cost_methodology: "token-based per-turn estimates summed",
    });

    expect(exported[1].capabilities).toEqual({
      turnLifecycle: false,
      audioMinutePriceUsd: 0.034,
    });
    expect(exported[1].sessionConfig.capabilities).toEqual(
      exported[1].capabilities,
    );
    expect(exported[1].scorecard.lost_completed_translations).toBeNull();
    expect(exported[1].scorecard.correlation_methodology).toMatch(
      /^UNAVAILABLE/,
    );
    expect(exported[1].scorecard.total_estimated_cost_usd).toBe(0.068);
    expect(exported[1].scorecard.cost_methodology).toContain(
      "wall-clock minutes × $0.034",
    );
  });

  it("uses legacy item-id and token-cost rules when capabilities are absent", () => {
    const legacy = computeScorecard(
      runState({
        sessionConfig: {},
        turns: [
          {
            estimatedCostUsd: 0.12,
            translatedTranscript: "Hello",
            sourceItemId: "different-item",
          },
        ],
      }),
    );

    expect(legacy.lost_completed_translations).toBe(1);
    expect(legacy.correlation_methodology).toBe("provider item ids");
    expect(legacy.total_estimated_cost_usd).toBe(0.12);
    expect(legacy.cost_methodology).toBe(
      "token-based per-turn estimates summed",
    );
  });
});

describe("semantic review judge (parse is fail-closed)", () => {
  const inputs = [
    { turnIndex: 0, source: "Привет", translation: "Hello" },
    { turnIndex: 1, source: "Пойдём с нами", translation: "Come with us. Sure, I'm coming!" },
    { turnIndex: 2, source: "bu", translation: "" },
  ];

  it("prompt defines all four classes", () => {
    const p = buildSemanticReviewPrompt();
    for (const c of ["FAITHFUL", "ADDED_CONTENT", "UNSOLICITED_RESPONSE", "UNCERTAIN"]) {
      expect(p).toContain(c);
    }
  });

  it("maps judge results by turnIndex and fills missing/invalid turns as UNCERTAIN", () => {
    const raw = JSON.stringify({ results: [
      { turnIndex: 0, classification: "FAITHFUL", reason: "ok" },
      { turnIndex: 1, classification: "UNSOLICITED_RESPONSE", reason: "answers the invitation" },
      // turn 2 omitted by the judge
    ]});
    const out = parseSemanticReview(raw, inputs);
    expect(out).toHaveLength(3);
    expect(out[0].classification).toBe("FAITHFUL");
    expect(out[1].classification).toBe("UNSOLICITED_RESPONSE");
    expect(out[2].classification).toBe("UNCERTAIN");
  });

  it("garbage judge output classifies every turn UNCERTAIN, never FAITHFUL", () => {
    const out = parseSemanticReview("not json at all", inputs);
    expect(out.every((r) => r.classification === "UNCERTAIN")).toBe(true);
    const out2 = parseSemanticReview(JSON.stringify({ results: [{ turnIndex: 0, classification: "GREAT" }] }), inputs);
    expect(out2[0].classification).toBe("UNCERTAIN");
  });
});

describe("adapter turn lifecycle (behavioral, no network)", () => {
  function makeSession() {
    const session = new OpenAIRealtimeTranslationSession({
      languages: ["ru", "en"],
      sourceLangHint: "auto",
      outputLanguage: "en",
      inputFormat: { encoding: "pcm16", sampleRateHz: 24000 },
      outputFormat: { encoding: "pcm16", sampleRateHz: 24000 },
    });
    const events: TranslationEvent[] = [];
    session.onEvent((ev) => events.push(ev));
    const feed = (msg: any) => (session as any).handleMessage(msg);
    return { session, events, feed };
  }

  it("a cancelled response is attributed to its item, resets state, and never breaks the next turn", () => {
    const { events, feed } = makeSession();
    // Turn 1: user speaks, item committed, transcript arrives.
    feed({ type: "input_audio_buffer.speech_started" });
    feed({ type: "input_audio_buffer.speech_stopped" });
    feed({ type: "input_audio_buffer.committed", item_id: "item_1" });
    feed({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "Мы идём в баню." });
    // Partial translation, then barge-in cancels the response.
    feed({ type: "response.output_audio_transcript.delta", delta: "We are" });
    feed({ type: "response.done", response: { status: "cancelled", status_details: { reason: "turn_detected" } } });
    // Turn 2: the interrupting utterance completes normally.
    feed({ type: "input_audio_buffer.speech_started" });
    feed({ type: "input_audio_buffer.speech_stopped" });
    feed({ type: "input_audio_buffer.committed", item_id: "item_2" });
    feed({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_2", transcript: "Пойдём с нами." });
    feed({ type: "response.output_audio_transcript.done", transcript: "Come with us." });
    feed({ type: "response.done", response: { status: "completed", usage: {} } });

    const cancelledEv = events.find((e) => e.type === "response_cancelled") as any;
    expect(cancelledEv).toBeTruthy();
    expect(cancelledEv.reason).toBe("turn_detected");
    expect(cancelledEv.sourceItemId).toBe("item_1");

    const completedTurns = events.filter((e) => e.type === "turn_completed") as any[];
    expect(completedTurns).toHaveLength(2);
    // Cancelled turn: marked cancelled, attributed to item_1.
    expect(completedTurns[0].metrics.cancelled).toBe(true);
    expect(completedTurns[0].metrics.sourceItemId).toBe("item_1");
    // Next turn is clean: no state leakage from the cancelled turn.
    expect(completedTurns[1].metrics.cancelled).toBeUndefined();
    expect(completedTurns[1].metrics.sourceItemId).toBe("item_2");
    expect(completedTurns[1].metrics.sourceTranscript).toBe("Пойдём с нами.");
    expect(completedTurns[1].metrics.translatedTranscript).toBe("Come with us.");
    // The cancelled turn never inherits the next turn's transcript.
    expect(completedTurns[0].metrics.translatedTranscript).toBe("We are");
    // No error event for a cancellation — it is structured evidence.
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("out-of-order transcription never mis-pairs: a turn reads its transcript strictly by item id", () => {
    const { events, feed } = makeSession();
    // Turn 1 committed; its transcription is SLOW.
    feed({ type: "input_audio_buffer.committed", item_id: "item_1" });
    // Turn 2 committed; its transcription arrives FIRST (async reordering).
    feed({ type: "input_audio_buffer.committed", item_id: "item_2" });
    feed({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_2", transcript: "Вторая фраза." });
    // Response for turn 1 completes while item_1's transcript is still missing.
    feed({ type: "response.output_audio_transcript.done", transcript: "First phrase." });
    feed({ type: "response.done", response: { status: "completed", usage: {} } });
    // Late transcript for item_1 arrives only now.
    feed({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "Первая фраза." });
    // Response for turn 2 completes.
    feed({ type: "response.output_audio_transcript.done", transcript: "Second phrase." });
    feed({ type: "response.done", response: { status: "completed", usage: {} } });

    const completed = events.filter((e) => e.type === "turn_completed") as any[];
    expect(completed).toHaveLength(2);
    // Turn 1 must NOT steal item_2's transcript — honestly undefined instead.
    expect(completed[0].metrics.sourceItemId).toBe("item_1");
    expect(completed[0].metrics.sourceTranscript).toBeUndefined();
    // Turn 2 reads its own transcript by item id, not the mutable latest one.
    expect(completed[1].metrics.sourceItemId).toBe("item_2");
    expect(completed[1].metrics.sourceTranscript).toBe("Вторая фраза.");
    // The late item_1 transcript was still surfaced as evidence for the client
    // to reconcile via sourceItemId.
    const srcEvents = events.filter((e) => e.type === "source_transcript") as any[];
    expect(srcEvents.map((e) => e.itemId)).toEqual(["item_2", "item_1"]);
  });

  it("source_transcript events carry the provider item id", () => {
    const { events, feed } = makeSession();
    feed({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_9", transcript: "Привет" });
    const src = events.find((e) => e.type === "source_transcript") as any;
    expect(src.itemId).toBe("item_9");
  });

  it("a response with no pending user item has undefined attribution (honest unknown)", () => {
    const { events, feed } = makeSession();
    feed({ type: "response.output_audio_transcript.done", transcript: "Sure, I'm coming!" });
    feed({ type: "response.done", response: { status: "completed", usage: {} } });
    const turn = events.find((e) => e.type === "turn_completed") as any;
    expect(turn.metrics.sourceItemId).toBeUndefined();
  });
});

describe("estimateTurnCostUsd", () => {
  const usage = {
    input_token_details: { audio_tokens: 1000, text_tokens: 500, cached_tokens: 0 },
    output_token_details: { audio_tokens: 2000, text_tokens: 100 },
  };

  it("computes gpt-realtime pricing", () => {
    // 1000*32 + 500*4 + 2000*64 + 100*16 = 163,600 per-1M units
    expect(estimateTurnCostUsd("gpt-realtime", usage)).toBeCloseTo(0.1636, 6);
  });

  it("subtracts cached audio tokens from the full-price bucket", () => {
    const cached = {
      input_token_details: {
        audio_tokens: 1000,
        text_tokens: 0,
        cached_tokens: 400,
        cached_tokens_details: { audio_tokens: 400, text_tokens: 0 },
      },
      output_token_details: { audio_tokens: 0, text_tokens: 0 },
    };
    // 600*32 + 400*0.4 = 19,360 per-1M units
    expect(estimateTurnCostUsd("gpt-realtime", cached)).toBeCloseTo(0.01936, 6);
  });

  it("returns undefined for unknown models or missing usage", () => {
    expect(estimateTurnCostUsd("some-future-model", usage)).toBeUndefined();
    expect(estimateTurnCostUsd("gpt-realtime", undefined)).toBeUndefined();
  });

  it("matches the longest model prefix (mini vs base)", () => {
    const mini = estimateTurnCostUsd("gpt-realtime-mini", usage)!;
    const base = estimateTurnCostUsd("gpt-realtime", usage)!;
    expect(mini).toBeLessThan(base);
  });
});
