import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeLedger } from "./ledger";
import { LIMIT_MICRO_USD, SERIES, sha } from "./contracts";
import { realtimeCost, sessionReserve } from "./cost";
import { NativeSession, type TransportFactory } from "./adapter";
import { setup } from "./protocol";
import { sendJudge, JUDGE_MODEL } from "./judge";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => fs.rm(d, { recursive: true, force: true }))); });
async function path() { const dir = await fs.mkdtemp(join(tmpdir(), "hint-native-test-")); dirs.push(dir); return join(dir, "ledger.json"); }
const usage = {
  input_tokens: 30, output_tokens: 5,
  input_token_details: { text_tokens: 10, audio_tokens: 20, cached_tokens: 5,
    cached_tokens_details: { text_tokens: 2, audio_tokens: 3 } },
  output_token_details: { text_tokens: 5, audio_tokens: 0 },
};
const bounds = { durationMs: 1000, maxResponses: 3, maxOutputTokens: 50, instructionBytes: 1024, ownerBytes: 100 };
describe("separate durable $15 series", () => {
  it("retains unknown in full across restarts and prohibits retries by ID or payload", async () => {
    const p = await path(), ledger = await NativeLedger.open(p);
    await ledger.reserve("first", "session", 100, sha("payload"));
    const durable = JSON.parse(await fs.readFile(p, "utf8"));
    expect(durable.entries[0].status).toBe("reserved");
    await ledger.close();
    const next = await NativeLedger.open(p);
    expect(next.held()).toBe(100);
    expect(next.snapshot().entries[0].status).toBe("unknown");
    await expect(next.reserve("first", "session", 100, sha("different"))).rejects.toThrow("NO_RETRY");
    await expect(next.reserve("changed-id", "session", 100, sha("payload"))).rejects.toThrow("NO_RETRY");
    await next.close();
  });
  it("uses actual known cost but retains the full reserve for unknown requests", async () => {
    const ledger = await NativeLedger.open(await path());
    await ledger.reserve("a", "control", 100, sha("a"));
    await ledger.finish("a", 25, { httpStatus: 101, requestId: "provider-receipt" });
    await ledger.reserve("b", "diagnostic", 200, sha("b")); await ledger.unknown("b");
    expect(ledger.held()).toBe(225);
    expect(ledger.snapshot()).toMatchObject({ series: SERIES, limitMicro: LIMIT_MICRO_USD });
    await ledger.close();
  });
  it("enforces one writer and refuses another series or an over-budget request", async () => {
    const p = await path(), ledger = await NativeLedger.open(p);
    await expect(NativeLedger.open(p)).rejects.toThrow();
    await ledger.reserve("a", "judge", LIMIT_MICRO_USD, sha("a"));
    await expect(ledger.reserve("b", "judge", 1, sha("b"))).rejects.toThrow("BUDGET_EXHAUSTED");
    await ledger.close();
    const state = JSON.parse(await fs.readFile(p, "utf8")); state.series = "previous-series";
    await fs.writeFile(p, JSON.stringify(state));
    await expect(NativeLedger.open(p)).rejects.toThrow();
  });
  it("refuses release of an unknown or spending above reserve", async () => {
    const ledger = await NativeLedger.open(await path());
    await ledger.reserve("a", "session", 100, sha("a"));
    await expect(ledger.finish("a", 101)).rejects.toThrow("OUTSIDE_RESERVATION");
    await ledger.unknown("a");
    await expect(ledger.finish("a", 0)).rejects.toThrow("NOT_ACTIVE");
    expect(ledger.held()).toBe(100); await ledger.close();
  });
  it("accounts all audio/text/cache modalities without treating missing usage as zero", () => {
    expect(realtimeCost(usage)).toBe(698);
    expect(() => realtimeCost({})).toThrow("USAGE_UNKNOWN");
    expect(() => realtimeCost({ ...usage, input_tokens: 29 })).toThrow("MODALITY_MISMATCH");
    expect(() => realtimeCost({ ...usage, input_token_details: {
      ...usage.input_token_details, cached_tokens_details: undefined,
    } })).toThrow("CACHE_USAGE_UNKNOWN");
    const reserve = sessionReserve(bounds);
    expect(reserve).toBeGreaterThan(698);
    expect(sessionReserve({ ...bounds, maxResponses: 6 })).toBeGreaterThan(reserve * 1.7);
    expect(() => sessionReserve({ ...bounds, maxResponses: 0 })).toThrow("INVALID_SESSION_BOUND");
  });
  it("default transport cannot even reserve money or start a connection", async () => {
    const ledger = await NativeLedger.open(await path());
    const session = new NativeSession({
      provider: "openai", model: "gpt-realtime-2.1", goal: "saved", requestId: "no-spend",
      audioSha256: sha("audio"), corpusHash: sha("corpus"), bounds, kind: "session",
      catalogIds: ["gpt-realtime-2.1"],
    }, ledger);
    await expect(session.open()).rejects.toThrow("PREPARATION_ONLY");
    expect(ledger.snapshot().entries).toHaveLength(0); await session.close(); await ledger.close();
  });
  it("awaits durable reservation before a fake socket, then settles usage with its receipt", async () => {
    const p = await path(), ledger = await NativeLedger.open(p);
    let receive!: (m: unknown) => void, diskChecked = false, at = 0;
    const outbound: any[] = [];
    const factory: TransportFactory = (_provider, model, onMessage, _fail, _ready, receipt) => {
      receive = onMessage;
      receipt(101, "request-id");
      void fs.readFile(p, "utf8").then(bytes => {
        diskChecked = JSON.parse(bytes).entries[0].status === "reserved";
        receive({ type: "session.created" });
        receive({ type: "session.updated", session: (setup("openai", model, "saved", 50) as any).session });
      });
      return { send(v) { outbound.push(v); }, close: vi.fn() };
    };
    const session = new NativeSession({
      provider: "openai", model: "gpt-realtime-2.1", goal: "saved", requestId: "fake",
      audioSha256: sha("audio"), corpusHash: sha("corpus"), bounds, kind: "session",
      catalogIds: ["gpt-realtime-2.1"],
    }, ledger, factory, () => at);
    await session.open(); expect(diskChecked).toBe(true);
    session.beginAudio(0); session.audio(Buffer.alloc(160, 255)); session.owner("context");
    receive({ type: "response.created", response: { id: "r" } });
    at = 100; receive({ type: "response.output_text.delta", response_id: "r", delta: "Hello there." });
    at = 200; receive({ type: "response.done", response: { id: "r", status: "completed", usage } });
    await session.close();
    expect(ledger.snapshot().entries[0]).toMatchObject({ status: "spent", charged: 698, requestId: "request-id" });
    expect(outbound.map(m => m.type)).toEqual(["session.update", "input_audio_buffer.append", "conversation.item.create"]);
    await ledger.close();
  });
  it("an interrupted or missing-billing fake session holds its full reserve", async () => {
    const ledger = await NativeLedger.open(await path());
    let receive!: (m: unknown) => void;
    const session = new NativeSession({
      provider: "openai", model: "gpt-realtime-2.1", goal: "saved", requestId: "unknown",
      audioSha256: sha("audio"), corpusHash: sha("corpus"), bounds, kind: "control",
      catalogIds: ["gpt-realtime-2.1"],
    }, ledger, (_p, model, recv) => {
      receive = recv;
      queueMicrotask(() => receive({ type: "session.updated",
        session: (setup("openai", model, "saved", 50) as any).session }));
      return { send() {}, close() {} };
    });
    await session.open();
    receive({ type: "response.created", response: { id: "pending" } });
    await session.close();
    expect(ledger.snapshot().entries[0]).toMatchObject({ status: "unknown", charged: sessionReserve(bounds) });
    await ledger.close();
  });
  it("judge requests are durably reserved, preserve null hints and settle known usage", async () => {
    const p = await path(), ledger = await NativeLedger.open(p);
    const fetcher = vi.fn().mockImplementation(async (_url, options) => {
      const state = JSON.parse(await fs.readFile(p, "utf8"));
      expect(state.entries[0].status).toBe("reserved");
      const body = JSON.parse(options.body), evidence = JSON.parse(body.messages[1].content);
      expect(evidence.items[0].hint).toBe("");
      return new Response(JSON.stringify({
        model: "gpt-4.1-mini-2025-04-14", usage: { prompt_tokens: 100, completion_tokens: 50 },
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
          items: [{ turnId: "g", grounding: 0, relevance: 0, speakability: 0, translation: 0 }],
        }) } }],
      }), { headers: { "x-request-id": "judge-receipt" } });
    });
    const result = await sendJudge(ledger, {
      requestPrefix: "judge", goal: "saved", author: "gpt-realtime-2.1", catalogIds: [JUDGE_MODEL],
      reference: [{ id: "g", role: "guest", text: "Question?", startMs: 0, endMs: 1000 }],
      observations: [{
        turnId: "g", speechEndMs: 900, hint: null, firstWordMs: null, fullHintMs: null,
        autoEotMs: null, ambiguous: false, reason: "NO_HINT",
      }],
    }, fetcher);
    expect(result.quality).toBe(0);
    expect(ledger.snapshot().entries[0]).toMatchObject({ status: "spent", charged: 120, requestId: "judge-receipt" });
    await ledger.close();
  });
  it("a failed fake judge is unknown and never retried", async () => {
    const ledger = await NativeLedger.open(await path());
    const fetcher = vi.fn().mockRejectedValue(Error("connection failed"));
    const run = {
      requestPrefix: "judge-fail", goal: "saved", author: "gpt-realtime-2.1", catalogIds: [JUDGE_MODEL],
      reference: [{ id: "g", role: "guest" as const, text: "Question?", startMs: 0, endMs: 1000 }],
      observations: [{
        turnId: "g", speechEndMs: 900, hint: null, firstWordMs: null, fullHintMs: null,
        autoEotMs: null, ambiguous: false, reason: "NO_HINT",
      }],
    };
    await expect(sendJudge(ledger, run, fetcher)).rejects.toThrow("connection failed");
    await expect(sendJudge(ledger, run, fetcher)).rejects.toThrow("NO_RETRY");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(ledger.snapshot().entries[0].status).toBe("unknown"); await ledger.close();
  });
});
