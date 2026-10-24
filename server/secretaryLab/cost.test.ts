import { describe, expect, it } from "vitest";
import { captureLabTariff, calculateLabCost, pricedLabReport } from "./cost";
import { RealtimeUsageMeter } from "./realtimeUsage";
import { SecretaryConversationEngine, type EngineStream } from "../secretary/conversationEngine";
import { comparisonSnapshot } from "./comparisonSnapshot";
import type { RetellReport } from "./retell";

const facts = () => ({
  model: "gpt-6.1-sol", voice: "catalog-sarah", profileId: "baseline", ttsModel: "eleven_multilingual_v2",
  createdAt: "2026-10-24T12:00:00.000Z", endedAt: "2026-10-24T12:01:40.000Z", status: "ended",
  audioConnectedAt: "2026-10-24T12:00:10.000Z", events: [], tariffSnapshot: captureLabTariff(),
  engine: { model: "gpt-6.1-sol", usage: { requests: 2, measuredRequests: 2, input: 1000, cachedInput: 200, output: 500 } },
});
describe("Secretary Lab tariff and actual configuration accounting", () => {
  it("separates Agents/STT/TTS/Engine, subtracts cache and keeps the account tariff unknown", () => {
    const c = calculateLabCost("eleven-engine", facts())!;
    expect(c.durationSeconds).toBe(90);
    expect(c.lines[0]).toMatchObject({ rateUsd: 0.08, quantity: 1.5, amountUsd: 0.12 });
    expect(c.lines.filter(l => l.status === "included")).toHaveLength(2);
    expect(c.knownSubtotalUsd).toBeCloseTo(0.12662, 9);
    expect(c.estimatedTotalUsd).toBeNull();
    expect(c.confirmedChargeUsd).toBeNull();
    expect(c.complete).toBe(false);
    expect(c.tokenUsage?.output).toBe(500);
  });
  it("Flash profile uses actual TTS/voice but never the standalone TTS discount", () => {
    const f = facts(); f.profileId = "optimized"; f.ttsModel = "eleven_flash_v2_5"; f.voice = "actual-clone";
    const c = calculateLabCost("eleven-engine", f)!;
    expect(c).toMatchObject({ profileId: "optimized", ttsModel: "eleven_flash_v2_5", voice: "actual-clone" });
    expect(c.lines[0].rateUsd).toBe(0.08);
    expect(c.lines[0].note).toContain("optimized");
    expect(c.lines[2].note).toContain("Flash");
  });
  it("never prices unknown models, voices, TTS or missing usage as free", () => {
    const f = facts(); f.engine.model = "unlisted"; f.voice = "other"; f.ttsModel = "future-tts";
    let c = calculateLabCost("eleven-engine", f)!;
    expect(c.lines[0].rateUsd).toBeNull();
    expect(c.lines.find(l => l.label.startsWith("TalkHint Engine"))?.amountUsd).toBeNull();
    c = calculateLabCost("retell-engine", f)!;
    expect(c.lines.find(l => l.label.startsWith("TTS"))?.amountUsd).toBeNull();
    f.engine.model = "gpt-6.1-sol"; f.engine.usage.measuredRequests = 1;
    c = calculateLabCost("retell-engine", f)!;
    expect(c.estimatedTotalUsd).toBeNull();
    expect(c.lines.find(l => l.label.startsWith("TalkHint Engine"))?.rateUsd).toBe(2);
  });
  it("includes separately billed Engine tokens in the complete Retell standard estimate", () => {
    const f = facts(); f.voice = "retell-Merritt";
    const c = calculateLabCost("retell-engine", f)!;
    expect(c.estimatedTotalUsd).toBeCloseTo(1.5 * (0.055 + 0.015) + 0.00662);
    expect(c.confirmedChargeUsd).toBeNull();
    expect(c.status).toBe("estimate");
    expect(c.lines.some(l => l.label.startsWith("LLM · Retell managed"))).toBe(false);
    const managed = calculateLabCost("retell", { ...f, engine: undefined })!;
    expect(managed.estimatedTotalUsd).toBeCloseTo(1.5 * (0.055 + 0.015 + 0.064));
    expect(managed.lines.at(-1)?.status).toBe("not_applicable");
  });
  it("unknown duration, failed admission and unconfirmed stop do not produce a zero bill", () => {
    const f = facts();
    expect(calculateLabCost("retell-engine", { ...f, audioConnectedAt: undefined })!.durationSeconds).toBeNull();
    expect(calculateLabCost("retell-engine", { ...f, endedAt: undefined })!.durationSeconds).toBeNull();
    expect(calculateLabCost("retell-engine", { ...f, status: "stop_failed" })!.estimatedTotalUsd).toBeNull();
    const provider = calculateLabCost("retell-engine", { ...f, providerDurationSeconds: 41.25 })!;
    expect(provider.durationSeconds).toBe(41.25);
    expect(provider.durationBasis).toBe("provider_reported_duration");
  });
  it("uses the captured rates and serializes an independent source snapshot, not today's defaults", () => {
    const f = facts(); f.tariffSnapshot.rates.elevenAdditionalMinute = 0.123;
    const c = pricedLabReport("eleven-engine", f).cost!;
    f.tariffSnapshot.rates.elevenAdditionalMinute = 8;
    expect(c.lines[0].amountUsd).toBeCloseTo(0.1845);
    expect(c.tariff.rates.elevenAdditionalMinute).toBe(0.123);
    const reopened = JSON.parse(JSON.stringify(c));
    expect(reopened).toEqual(c);
    expect(reopened.tariff.sources.every((s: any) => s.url.startsWith("https://"))).toBe(true);
    expect(calculateLabCost("eleven-engine", { ...f, tariffSnapshot: undefined })).toBeUndefined();
  });
  it("common archive snapshot retains cost without exposing provider credentials", () => {
    const f: RetellReport = { ...facts(), id: "test", callId: "provider-call", instruction: "TEST only",
      status: "ended", promptHash: "f".repeat(64), monitorStatus: "ended", turns: [], observations: [],
      metrics: { guestTurns: 0, secretaryTurns: 0 }, engine: undefined };
    const run = comparisonSnapshot("eleven-engine", f);
    expect(run.cost?.tariff.checkedAt).toBe("2026-10-24");
    expect(run.cost?.profileId).toBe("baseline");
    expect(run).not.toHaveProperty("callId");
    expect(run).not.toHaveProperty("tariffSnapshot");
  });
});

describe("actual token accounting, not word/character guesses", () => {
  it("adds every tool round, cached input once, and counts incomplete requests as unmeasured", async () => {
    let round = 0;
    const stream: EngineStream = async function* () {
      round++;
      yield { type: "usage", input: 100, cachedInput: 25, output: 40 };
      yield { type: "usage", input: 100, cachedInput: 25, output: 40 }; // duplicate in a round
      yield { type: "complete", output: [], tools: round === 1 ? [{ call_id: "read", name: "read_test_context", arguments: "{}" }] : [] };
    };
    const engine = new SecretaryConversationEngine("owner", "TEST", stream);
    await engine.respond([{ role: "user", content: "test" }], new AbortController().signal, () => {});
    expect(engine.report.usage).toEqual({ requests: 2, measuredRequests: 2, input: 200, cachedInput: 50, output: 80 });
    const broken = new SecretaryConversationEngine("owner", "TEST", async function* () { yield { type: "text", text: "partial" }; throw Error("lost usage"); });
    await expect(broken.respond([], new AbortController().signal, () => {})).rejects.toThrow();
    expect(broken.report.usage).toMatchObject({ requests: 1, measuredRequests: 0 });
  });
  it("deduplicates Realtime responses and leaves unknown modalities/malformed usage unmeasured", () => {
    const meter = new RealtimeUsageMeter();
    const usage = { input_tokens: 150, output_tokens: 50,
      input_token_details: { text_tokens: 100, audio_tokens: 50, cached_tokens: 30, cached_tokens_details: { text_tokens: 20, audio_tokens: 10 } },
      output_token_details: { text_tokens: 30, audio_tokens: 20 } };
    meter.record("r1"); meter.record("r1", usage); meter.record("r1", usage);
    expect(meter.totals).toMatchObject({ requests: 1, measuredRequests: 1, textInput: 100, audioCached: 10 });
    const c = calculateLabCost("gpt", { ...facts(), model: "gpt-realtime-2.1", engine: undefined,
      voiceProvider: "openai", transport: "webrtc", realtimeUsage: meter.totals })!;
    expect(c.lines[0]).toMatchObject({ quantity: 80 / 1e6, rateUsd: 4 });
    expect(c.lines.find(l => l.label === "OpenAI Realtime · audio output")).toMatchObject({ rateUsd: 64 });
    expect(c.lines.some(l => l.label.includes("gpt-live"))).toBe(false);
    meter.record("r2", { ...usage, input_tokens: 999 });
    expect(meter.totals).toMatchObject({ requests: 2, measuredRequests: 1 });
  });
});
