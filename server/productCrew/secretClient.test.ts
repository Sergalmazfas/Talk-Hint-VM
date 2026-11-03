import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Standalone Node CLI intentionally has no TS build dependency.
import { callProductionMcp, verifyProductionMcp, productionMcpDiagnostic } from "../../script/product-crew-production-mcp.mjs";
const key = "fixture_client_Secrets_key_".repeat(3);
const env = { PRODUCT_CREW_KEY: key };
afterEach(() => vi.useRealTimers());
describe("Dev to production MCP client safety", () => {
  it("classifies a refusal without leaking response text, credentials or changing retry rules", async () => {
    for (const [message, code] of [["Invalid transaction size", "TRANSACTION_SIZE"],
      ["P.PREP или её ID уже существует; ничего не заменено.", "PREP_COLLISION"],
      ["arbitrary private internal detail", "UNCLASSIFIED_REFUSAL"]]) {
      const fetcher = vi.fn(async (_url, init) => Response.json({
        jsonrpc: "2.0", id: JSON.parse(init.body).id, result: { isError: true,
          content: [{ type: "text", text: JSON.stringify({ status: 409, error: message }) }] },
      }));
      let caught;
      try { await callProductionMcp("tools/call", { name: "create_hint_call_prep_role" }, { env, fetcher }); }
      catch (error) { caught = error; }
      expect(productionMcpDiagnostic(caught)).toEqual({ category: "tool_refusal",
        httpStatus: 200, rpcStatus: 409, reasonCode: code });
      expect(String(caught)).not.toContain(message);
      expect(JSON.stringify(productionMcpDiagnostic(caught))).not.toContain(key);
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it("never classifies a secret-bearing payload using its text and never trusts raw exceptions", async () => {
    const fetcher = vi.fn(async (_url, init) => Response.json({
      jsonrpc: "2.0", id: JSON.parse(init.body).id, result: { isError: true,
        content: [{ type: "text", text: JSON.stringify({ status: 409, error: key }) }] },
    }));
    let caught;
    try { await callProductionMcp("tools/list", undefined, { env, fetcher }); } catch (error) { caught = error; }
    expect(productionMcpDiagnostic(caught)).toEqual({ category: "sensitive_response" });
    expect(productionMcpDiagnostic(Error(key))).toEqual({ category: "unclassified" });
  });
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
  it("allows slow snapshot reads but aborts after 60 seconds without retry", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Error(`unsafe timeout ${key}`)));
    }));
    const pending = callProductionMcp("tools/list", undefined, { env, fetcher });
    const rejection = expect(pending).rejects.toThrow("Production MCP request failed");
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(45000);
    await rejection;
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("accepts a roadmap response arriving after the old 15 second limit", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_url, init) => {
      await new Promise(resolve => setTimeout(resolve, 18000));
      expect(init.signal.aborted).toBe(false);
      return Response.json({ jsonrpc: "2.0", id: JSON.parse(init.body).id,
        result: { structuredContent: { result: { revision: 919 } } } });
    });
    const pending = callProductionMcp("tools/call", { name: "get_roadmap", arguments: {} }, { env, fetcher });
    await vi.advanceTimersByTimeAsync(18000);
    expect(await pending).toMatchObject({ structuredContent: { result: { revision: 919 } } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("does not retransmit an ambiguous write at the longer snapshot deadline", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Error("ambiguous")));
    }));
    const pending = callProductionMcp("tools/call", { name: "update_structure", arguments: {} }, { env, fetcher });
    const rejected = expect(pending).rejects.toThrow("No automatic retry");
    await vi.advanceTimersByTimeAsync(60000);
    await rejected;
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
