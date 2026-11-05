import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState } from "../aiCrew/domain";
import { bindPhoneRollout, changePhoneVariant, rolloutState, selectedPhoneConfiguration } from "./phoneRollout";
import { RetellEngineRegistry } from "../secretaryLab/retellEngine";
import { SECRETARY_CALL_LIMIT_MS } from "./limits";

class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent: any[] = [];
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; this.emit("close"); }
}
const registries: RetellEngineRegistry[] = [];
afterEach(() => { registries.splice(0).forEach(r => r.dispose()); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("Owner-approved Dev mechanisms promoted to telephone C, with exact C reserve", () => {
  it("reads an old saved C as streaming-v1 without rewriting existing state/history", async () => {
    const s = initialState();
    s.secretaryPhoneRollout = { variant: "C", changedAt: "previous", changedBy: "owner",
      reviews: [{ callRef: "existing", ordinal: 1 }] };
    const before = structuredClone(s);
    expect(rolloutState(s)).toMatchObject({ variant: "C", conversationVersion: "streaming-v1" });
    bindPhoneRollout(() => ({ read: async () => s, change: async () => { throw Error("Read only"); } }));
    expect(await selectedPhoneConfiguration()).toEqual({ variant: "C", conversationVersion: "streaming-v1" });
    expect(s).toEqual(before);
  });
  it("reserve selection persists across restart and changes neither model variant nor other state", () => {
    const s = initialState(), previous = structuredClone(s);
    changePhoneVariant(s, { revision: 0, variant: "C", conversationVersion: "C-reserve" }, "owner");
    const restored = JSON.parse(JSON.stringify(s));
    expect(rolloutState(restored)).toMatchObject({ variant: "C", conversationVersion: "C-reserve" });
    for (const key of ["control", "agents", "tasks", "runs", "testSeries"] as const)
      expect((restored as any)[key]).toEqual((previous as any)[key]);
    changePhoneVariant(restored, { revision: 0, variant: "C", conversationVersion: "streaming-v1" }, "owner");
    expect(rolloutState(restored).conversationVersion).toBe("streaming-v1");
    expect(() => changePhoneVariant(restored, { revision: 1, variant: "C", conversationVersion: "C-reserve" }, "owner"))
      .toThrow("STALE_REVISION");
    expect(() => changePhoneVariant(restored, { revision: 0, variant: "C", conversationVersion: "other" }, "owner")).toThrow();
    expect(() => changePhoneVariant(restored, { revision: 0, variant: "C", voice: "other" }, "owner")).toThrow();
  });
  it.each(["streaming-v1", "C-reserve"] as const)("freezes %s at phone admission; limits stay 600 s", version => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    vi.useFakeTimers();
    let selected = version;
    const failed = vi.fn();
    const registry = new RetellEngineRegistry(undefined, { phone: true, phoneProfile: () => "C",
      phoneConversationVersion: () => selected, onFailure: failed });
    registries.push(registry);
    const reservation = registry.reserve("owner", "Ask total price. Keep budget $400. Never pay.", "phone-task");
    selected = version === "streaming-v1" ? "C-reserve" : "streaming-v1";
    registry.registered("phone-task", "call_fixture");
    registry.attach(new Socket() as any, `/retell-phone-engine/${reservation.ticket}/call_fixture`);
    const entry = (registry as any).entries.get("phone-task");
    expect(entry.buffer.deps.advanceCompletedTurn).toBe(version === "streaming-v1");
    expect(entry.buffer.deps.retellStreaming).toBe(version === "streaming-v1");
    expect(registry.diagnostics("phone-task")!.runtime).toMatchObject({
      variant: "C", conversationVersion: version, reasoning: "low", maxOutput: 300,
    });
    expect(entry.engine.instructions).toContain("$400");
    expect(entry.waiting).toBeUndefined(); // No rehearsal waiting/manners/timer enters telephone.
    expect(entry.expiresAt - Date.now()).toBe(SECRETARY_CALL_LIMIT_MS);
    vi.advanceTimersByTime(180_001);
    expect(failed).not.toHaveBeenCalled();
    expect(entry.closed).toBe(false);
    vi.advanceTimersByTime(SECRETARY_CALL_LIMIT_MS - 180_001);
    expect(failed).toHaveBeenCalledOnce();
  });
  it("new and reserve telephone C retain identical instructions/model and only differ in buffer flags", () => {
    const prompts: string[] = [];
    for (const version of ["streaming-v1", "C-reserve"] as const) {
      const registry = new RetellEngineRegistry(undefined, { phone: true, phoneProfile: () => "C",
        phoneConversationVersion: () => version });
      registries.push(registry);
      const r = registry.reserve("owner", "Confirm availability, $400 total, arrive in 2 hours. Never pay.", version);
      const entry = (registry as any).entries.get(version);
      prompts.push(entry.engine.instructions.replace(/Current time: [^\n]+/, "CLOCK"));
      expect(r.engine.model).toBe("gpt-6-sol");
    }
    expect(prompts[0]).toBe(prompts[1]);
  });
});
