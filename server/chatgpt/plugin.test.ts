import { describe, expect, it } from "vitest";
import { talkHintPluginPackage } from "./plugin";
import { savedTaskEvents } from "./savedEvents";

describe("separate TalkHint remote-MCP plugin", () => {
  it("has its own identity, existing OAuth/MCP endpoints and no fixed credentials", () => {
    const pack = talkHintPluginPackage("https://fixture.example.test");
    expect(pack.manifest.name).toBe("talkhint");
    expect(pack.manifest.extensions["com.openai"].interface.displayName).toBe("TalkHint Secretary");
    expect(pack.manifest.extensions["com.openai"].interface.capabilities).toEqual(["Read"]);
    const server = pack.mcp.mcpServers.talkhint;
    expect(server.type).toBe("streamable-http");
    expect(server.url).toBe("https://fixture.example.test/api/chatgpt/mcp");
    expect(server.extensions["com.openai"].auth).toMatchObject({
      type: "oauth", client: { mode: "provided", clientId: "talkhint-chatgpt", tokenEndpointAuthMethod: "none" },
      baseScopes: ["calls:read", "offline_access"],
    });
    const json = JSON.stringify(pack);
    for (const forbidden of ["clientSecret", "api_key", "Route Leader", "stdio", "hooks", "Bearer "])
      expect(json).not.toContain(forbidden);
  });
  it("only advertises write mode when explicitly injected, with no auto-enable", () => {
    const pack = talkHintPluginPackage("https://fixture.example.test", true);
    expect(pack.manifest.extensions["com.openai"].interface.capabilities).toContain("Write");
    expect(pack.mcp.mcpServers.talkhint.extensions["com.openai"].auth.baseScopes).not.toContain("secretary:start");
    expect(talkHintPluginPackage("https://fixture.example.test").mcp.mcpServers.talkhint
      .extensions["com.openai"].auth.baseScopes).not.toContain("secretary:start");
  });
  it.each(["http://example.test", "https://user:pass@example.test", "https://example.test/path", "https://example.test?x=1"])(
    "refuses an unsafe or non-origin endpoint: %s", value => expect(() => talkHintPluginPackage(value)).toThrow());
});
describe("saved backend event projection", () => {
  it("uses only stored checkpoints, ignores invalid dates and does not invent status transitions", () => {
    const events = savedTaskEvents({
      createdAt: new Date("2026-10-19T19:00:00Z"), updatedAt: new Date("2026-10-19T19:03:00Z"),
      dialStartedAt: new Date("2026-10-19T19:01:00Z"), streamEndedAt: new Date("2026-10-19T19:02:00Z"),
      attemptHistory: ["2026-10-19T19:01:00Z", "bad timestamp"],
      status: "completed", providerStatus: "completed",
    });
    expect(events.map(e => e.type)).toEqual(["task_created", "dial_attempt", "stream_ended", "state_snapshot"]);
    expect(events[3]).toMatchObject({ status: "completed", providerStatus: "completed" });
    expect(JSON.stringify(events)).not.toContain("ringing");
  });
});
