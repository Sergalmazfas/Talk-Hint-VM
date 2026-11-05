import { describe, expect, it, vi } from "vitest";
import { defaultRehearsalScenes, rehearsalInstruction, rehearsalVersions, sceneFromInput } from "./catalog";
import { requireRehearsalDev } from "./store";
describe("rehearsal immutable plans and isolated profiles", () => {
  it("has tires, overnight parking and washing with explicit plans", () => {
    const scenes = defaultRehearsalScenes();
    expect(scenes).toHaveLength(3);
    expect(scenes[0].plan.goal).toContain("295/75R22.5");
    for (const scene of scenes) {
      expect(scene.plan.executor).toBe("secretary");
      expect(scene.plan.targetPhone).toBeUndefined();
      expect(scene.plan.sayAsk.length).toBeGreaterThan(0);
      expect(rehearsalInstruction(scene)).toContain("Wait for the seller's first phrase");
      expect(rehearsalInstruction(scene).length).toBeLessThanOrEqual(4000);
    }
  });
  it("does not split a structured thought on a comma or semicolon", () => {
    const base = defaultRehearsalScenes()[0].plan;
    const item = "Say that the invoice is paid; no second payment, no booking.";
    const scene = sceneFromInput("s", { title: "Owner scenario", plan: { ...base, sayAsk: [item] } });
    expect(scene.plan.sayAsk).toEqual([item]);
    expect(defaultRehearsalScenes()[0].plan.sayAsk).not.toEqual([item]);
  });
  it.each([{ targetPhone: "+15555551234" }, { executor: "hint" }, { unknownField: true }])("rejects expanded capabilities %j", patch => {
    expect(() => sceneFromInput("s", { title: "new", plan: { ...defaultRehearsalScenes()[0].plan, ...patch } })).toThrow();
  });
  it("pins profiles without claiming a code snapshot verifies production", () => {
    const versions = rehearsalVersions();
    expect(versions.map(v => v.id)).toEqual(["production-C", "dev-C", "saved-A"]);
    expect(versions[0].productionVerified).toBe(false);
    expect(versions[0].waiting).toBe(false); expect(versions[1].waiting).toBe(true);
    expect(new Set(versions.map(v => v.hash)).size).toBe(3);
    expect(rehearsalVersions()).toEqual(versions);
  });
  it.each(["production", "test"])("rejects environment %s", mode => {
    vi.stubEnv("NODE_ENV", mode); expect(requireRehearsalDev).toThrow("REHEARSAL_DEV_ONLY"); vi.unstubAllEnvs();
  });
  it("even development is refused on a deployment", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    expect(requireRehearsalDev).toThrow(); vi.unstubAllEnvs();
  });
});
