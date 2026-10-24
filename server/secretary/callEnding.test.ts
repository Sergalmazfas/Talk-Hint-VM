import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretaryCallEnding, parseSecretaryEndRequest } from "./callEnding";
import { SecretaryLiveEndTool } from "./liveEndTool";

afterEach(() => vi.useRealTimers());
const request = { reason: "completed", farewell: "Спасибо, до свидания!" } as const;

describe("Secretary controlled telephone ending", () => {
  it("requires an explicit valid tool request, never a transcript keyword", async () => {
    vi.useFakeTimers();
    const end = vi.fn(async () => {}), fail = vi.fn();
    const closing = new SecretaryCallEnding(end, fail);
    closing.played(request.farewell);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(end).not.toHaveBeenCalled();
    closing.request(request);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(end).not.toHaveBeenCalled();
    closing.close();
  });

  it.each(["Спасибо, до свидания!", "Thank you, goodbye!", "Gracias, ¡adiós!"])(
    "waits for played farewell and quiet window in %s, and ends once", async farewell => {
      vi.useFakeTimers();
      const end = vi.fn(async () => {}), fail = vi.fn();
      const closing = new SecretaryCallEnding(end, fail);
      closing.request({ reason: "follow_up", farewell });
      closing.played("Earlier summary was played.");
      closing.played(farewell);
      await vi.advanceTimersByTimeAsync(2499);
      expect(end).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(end).toHaveBeenCalledTimes(1);
      closing.played(farewell);
      closing.request(request);
      await vi.advanceTimersByTimeAsync(5000);
      expect(end).toHaveBeenCalledTimes(1);
      expect(fail).not.toHaveBeenCalled();
    });

  it.each(["new guest speech", "hold request", "transfer", "guest correction"])(
    "%s cancels a pending end without another call", async () => {
      vi.useFakeTimers();
      const end = vi.fn(async () => {});
      const closing = new SecretaryCallEnding(end, vi.fn());
      closing.request(request);
      closing.played(request.farewell);
      await vi.advanceTimersByTimeAsync(1000);
      closing.cancel();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(end).not.toHaveBeenCalled();
      closing.close();
    });

  it("continuing Secretary speech cancels a scheduled end", async () => {
    vi.useFakeTimers();
    const end = vi.fn(async () => {}), closing = new SecretaryCallEnding(end, vi.fn());
    closing.request(request);
    closing.played(request.farewell);
    closing.played("Yes, let me clarify that.");
    await vi.advanceTimersByTimeAsync(5000);
    expect(end).not.toHaveBeenCalled();
    closing.close();
  });

  it("recognizes a farewell split across played transcript fragments", async () => {
    vi.useFakeTimers();
    const end = vi.fn(async () => {}), closing = new SecretaryCallEnding(end, vi.fn());
    closing.request({ reason: "completed", farewell: "Thank you, goodbye." });
    closing.played("Thank you,");
    await vi.advanceTimersByTimeAsync(4000);
    expect(end).not.toHaveBeenCalled();
    closing.played("goodbye.");
    await vi.advanceTimersByTimeAsync(2500);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("surfaces provider failure without retrying hangup or dialing", async () => {
    vi.useFakeTimers();
    const end = vi.fn(async () => { throw new Error("synthetic"); }), fail = vi.fn();
    const closing = new SecretaryCallEnding(end, fail);
    closing.request(request);
    closing.played(request.farewell);
    await vi.advanceTimersByTimeAsync(5000);
    expect(end).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { reason: "silence", farewell: "bye" },
    { ...request, taskId: "another-task" }, { ...request, farewell: " " },
    { ...request, farewell: "x".repeat(301) }])("rejects unsafe or unscoped requests %#", value => {
    expect(parseSecretaryEndRequest(value)).toBeUndefined();
  });
});

describe("Native Live ending tool exchange", () => {
  it("handles only a valid tool, deduplicates and resumes the backend after completion", () => {
    const sent: any[] = [], prepared = vi.fn();
    const tool = new SecretaryLiveEndTool(e => sent.push(e), prepared);
    tool.event({ type: "response.created", response: { id: "backend-1" } });
    const event = { type: "response.output_item.done", response_id: "backend-1",
      item: { type: "function_call", call_id: "call-1", name: "prepare_call_end", arguments: JSON.stringify(request) } };
    tool.event(event);
    tool.event(event);
    expect(prepared).toHaveBeenCalledExactlyOnceWith(request);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0].item.output).prepared).toBe(true);
    tool.event({ type: "response.completed", response: { id: "backend-1" } });
    expect(sent.at(-1)).toEqual({ type: "response.create" });
  });

  it.each(["dial", "end_another_call", "prepare_call_end"])("rejects unsupported/invalid %s", name => {
    const sent: any[] = [], prepared = vi.fn();
    const tool = new SecretaryLiveEndTool(e => sent.push(e), prepared);
    tool.event({ type: "response.created", response: { id: "backend-1" } });
    tool.event({ type: "response.output_item.done", item: {
      type: "function_call", call_id: "call-1", name, arguments: '{"reason":"silence"}',
    } });
    expect(prepared).not.toHaveBeenCalled();
    expect(JSON.parse(sent[0].item.output).prepared).toBe(false);
  });
});
