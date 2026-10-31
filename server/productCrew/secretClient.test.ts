import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Standalone Node CLI intentionally has no TS build dependency.
import { callProductionMcp, verifyProductionMcp } from "../../script/product-crew-production-mcp.mjs";
const key = "fixture_client_Secrets_key_".repeat(3);
const env = { PRODUCT_CREW_KEY: key };
afterEach(() => vi.useRealTimers());
describe("Dev to production MCP client safety", () => {
  it("has exactly one fixed HTTPS destination, no redirects, bounded wait and no retry", async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://talkhint.app/api/product-crew/mcp");
      expect(init.redirect).toBe("error");
      expect(init.cache).toBe("no-store");
      expect((init.headers as any)["X-API-Key"]).toBe(key);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const body = JSON.parse(init.body as string);
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
    });
    expect(await callProductionMcp("tools/list", undefined, { env, fetcher })).toEqual({ tools: [] });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("fails without calling the network when project Secrets are absent", async () => {
    const fetcher = vi.fn();
    for (const value of [undefined, "", "short"]) {
      await expect(callProductionMcp("tools/list", undefined, { env: { PRODUCT_CREW_KEY: value }, fetcher }))
        .rejects.toThrow("missing or invalid");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not echo network/provider errors, secret-containing responses, RPC failure or incorrect IDs", async () => {
    for (const fetcher of [
      async () => { throw Error(`unsafe request ${key}`); },
      async () => new Response(`unsafe response ${key}`, { status: 401 }),
      async (_url: string, init: RequestInit) => Response.json({
        jsonrpc: "2.0", id: JSON.parse(init.body as string).id, result: { echoed: key },
      }),
      async (_url: string, init: RequestInit) => Response.json({
        jsonrpc: "2.0", id: JSON.parse(init.body as string).id, result: { isError: true, content: [{ text: key }] },
      }),
      async () => Response.json({ jsonrpc: "2.0", id: "wrong", result: {} }),
    ]) {
      const spy = vi.fn(fetcher);
      await expect(callProductionMcp("tools/list", undefined, { env, fetcher: spy }))
        .rejects.toThrow("Production MCP request failed; result unconfirmed. No automatic retry.");
      expect(spy).toHaveBeenCalledOnce();
    }
  });
  it("aborts a stalled request after 15 seconds without retry", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Error(`unsafe timeout ${key}`)));
    }));
    const pending = callProductionMcp("tools/list", undefined, { env, fetcher });
    const rejection = expect(pending).rejects.toThrow("Production MCP request failed");
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("post-publish probe only reads tools, team and roadmap and verifies a consistent revision", async () => {
    const methods: any[] = [];
    const fetcher = vi.fn(async (_url, init) => {
      const b = JSON.parse(init.body); methods.push([b.method, b.params?.name]);
      const result = b.method === "tools/list" ? { tools: [{ name: "get_team" }, { name: "get_roadmap" }] }
        : { structuredContent: { result: { revision: 919, roles: [] } } };
      return Response.json({ jsonrpc: "2.0", id: b.id, result });
    });
    expect(await verifyProductionMcp({ env, fetcher })).toMatchObject({
      environment: "production", model: "new-country", revision: 919, roles: 0, readOnly: true,
    });
    expect(methods).toEqual([["tools/list", undefined], ["tools/call", "get_team"], ["tools/call", "get_roadmap"]]);
  });
  it("rejects acceptance exposure and a revision changing during the read", async () => {
    const fetcher = async (_url, init) => {
      const b = JSON.parse(init.body);
      return Response.json({ jsonrpc: "2.0", id: b.id, result: b.method === "tools/list"
        ? { tools: [{ name: "get_team" }, { name: "get_roadmap" }] }
        : { structuredContent: { result: { revision: b.params.name === "get_team" ? 919 : 920, roles: [] } } } });
    };
    await expect(verifyProductionMcp({ env, fetcher })).rejects.toThrow("revision not verified");
    await expect(verifyProductionMcp({ env, fetcher: async (_u, init) => Response.json({
      jsonrpc: "2.0", id: JSON.parse(init.body).id,
      result: { tools: [{ name: "get_team" }, { name: "get_roadmap" }, { name: "review_result" }] },
    }) })).rejects.toThrow("Unexpected production tool contract");
  });
});
