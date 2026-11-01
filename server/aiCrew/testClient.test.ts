import { afterEach, describe, expect, it, vi } from "vitest";
import { crewTestDeadline, crewTestRpc } from "../../scripts/lib/crew-test-rpc";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const key = "not-a-secret-fixture".repeat(4);
describe("crew-test bounded read deadline, no retry", () => {
  function clock() {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const c = new AbortController();
      setTimeout(() => c.abort(new DOMException("Timeout", "TimeoutError")), ms);
      return c.signal;
    });
  }
  it("allows the observed 37-second structure read, once, with no change to write deadlines", async () => {
    clock();
    const fetcher = vi.fn((_url: any, options: any) => new Promise<any>((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Error("ABORTED")));
      setTimeout(() => resolve({ ok: true, json: async () => ({ result: { content: [
        { type: "text", text: JSON.stringify({ modelsCalled: 0, modelWrites: 0, summary: { ok: 689, problems: 398 } }) },
      ] } }) }), 37_000);
    }));
    const result = crewTestRpc("tools/call", { name: "crew_structure_check", arguments: {} }, key, fetcher as any);
    await vi.advanceTimersByTimeAsync(37_000);
    expect(await result).toMatchObject({ modelsCalled: 0, modelWrites: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(AbortSignal.timeout).toHaveBeenCalledWith(90_000);
    expect(crewTestDeadline("tools/call", { name: "crew_test_start" })).toBe(20_000);
    expect(crewTestDeadline("tools/call", { name: "crew_test_writeoff_legacy_unknown" })).toBe(20_000);
    expect(crewTestDeadline("tools/list")).toBe(20_000);
  });
  it("still stops a slow write at 20s without resending it", async () => {
    clock();
    const fetcher = vi.fn((_url: any, options: any) => new Promise<any>((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Error("ABORTED")));
    }));
    const result = expect(crewTestRpc("tools/call", { name: "crew_test_start" }, key, fetcher as any)).rejects.toThrow("ABORTED");
    await vi.advanceTimersByTimeAsync(20_000); await result;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("structure timeout is bounded at 90s, with no automatic retry", async () => {
    clock();
    const fetcher = vi.fn((_url: any, options: any) => new Promise<any>((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Error("ABORTED")));
    }));
    const result = expect(crewTestRpc("tools/call", { name: "crew_structure_check" }, key, fetcher as any)).rejects.toThrow("ABORTED");
    await vi.advanceTimersByTimeAsync(90_000); await result;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("an error response is not retried and does not expose provider error text", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, json: async () => ({ error: { message: "private error" } }) }));
    await expect(crewTestRpc("tools/call", { name: "crew_test_start" }, key, fetcher as any))
      .rejects.toThrow("MCP_UNCONFIRMED_STOP_NO_RETRY");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
