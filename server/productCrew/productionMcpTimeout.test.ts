import { afterEach, describe, expect, it, vi } from "vitest";
import { callProductionMcp, productionMcpDiagnostic } from "../../script/product-crew-production-mcp.mjs";
afterEach(() => vi.useRealTimers());
const env = { PRODUCT_CREW_KEY: "a".repeat(43) };
describe("bounded operator wait, unchanged MCP credentials and no retries", () => {
  it.each([undefined, 120000])("aborts once at the selected deadline %s", async timeoutMs => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url, opts) => new Promise((_resolve, reject) =>
      opts.signal.addEventListener("abort", () => reject(Error("aborted")), { once: true })));
    const result = callProductionMcp("tools/list", undefined, { env, fetcher, ...(timeoutMs ? { timeoutMs } : {}) })
      .catch(productionMcpDiagnostic);
    const wait = timeoutMs ?? 60000;
    await vi.advanceTimersByTimeAsync(wait - 1);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ category: "timeout" }); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  });
  it.each([0, -1, 120001, Infinity, NaN])("rejects an unbounded/invalid deadline %s before sending", async timeoutMs => {
    const fetcher = vi.fn();
    await expect(callProductionMcp("tools/list", undefined, { env, fetcher, timeoutMs })).rejects.toThrow("bounded");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
