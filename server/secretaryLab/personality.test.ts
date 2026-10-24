import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElevenEngineLab } from "./elevenEngine";
import { ELEVEN_CATALOG } from "./elevenApi";
import { RetellSecretaryLab, type RetellLabProfile } from "./retell";
import { RetellEngineRegistry } from "./retellEngine";
import { comparisonSnapshot } from "./comparisonSnapshot";
import { initialKatya } from "../secretary/personalities/katya";
import { SECRETARY_TEST_CONTEXT } from "./testContext";
import type { SecretaryConversationEngine } from "../secretary/conversationEngine";
import type { ComparisonRepository } from "./comparisonStore";
import type { SavedComparison } from "../../shared/secretaryLabComparison";
import { resolveLabPersonality, parseLabPersonality } from "./personality";

const catalog = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../secretary/personalities/store", () => ({
  availablePersonalityVersion: catalog.read,
}));
const selection = { id: "shared-catalog-id", version: 2, mode: "work" as const };
const binding = () => ({ personalityId: selection.id, version: 2, mode: selection.mode,
  snapshot: { ...initialKatya, id: selection.id, version: 2, status: "available" as const } });
const instruction = "Collect an approved TEST message, no real delivery.";
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.unstubAllEnvs(); vi.clearAllMocks(); });

function fixture() {
  vi.stubEnv("NODE_ENV", "development");
  catalog.read.mockImplementation(async (id, version, mode) => {
    if (id !== selection.id || version !== 2)
      throw Object.assign(new Error("Stale or unavailable catalog version"), { status: 409 });
    return { ...binding(), mode };
  });
  const rows = new Map<string, SavedComparison>();
  const store: ComparisonRepository = {
    checkpoint: async (_owner, id, content) => {
      const saved = { ...content, id, createdAt: new Date().toISOString(), expiresAt: "2099-01-01T00:00:00Z" };
      rows.set(id, JSON.parse(JSON.stringify(saved))); return saved;
    },
    save: async () => { throw Error("Use common checkpoint"); },
    list: async () => [...rows.values()], get: async id => rows.get(id),
    remove: async id => rows.delete(id), evaluate: async () => undefined, purge: async () => {},
  };
  const elevenApi: any = {
    voice: async () => ({ voice_id: ELEVEN_CATALOG.voiceId, category: "premade",
      labels: { gender: "female", accent: "american" } }),
    request: async () => ({ agents: [] }), workspaceSafe: async () => {},
    create: vi.fn(async () => "test-agent"), inspect: async () => {},
    signedUrl: async () => "wss://example.invalid/test", remove: async () => {},
  };
  const stream = async function* () {
    yield { type: "text" as const, text: "Здравствуйте, тест." };
    yield { type: "complete" as const, output: [], tools: [] };
  };
  const makeEleven = () => new ElevenEngineLab(store, elevenApi,
    async () => { throw Error("No clones in this test"); }, stream, () => true, async () => {});
  const eleven = makeEleven(); cleanup.push(() => eleven.dispose());
  const registry = new RetellEngineRegistry(stream);
  const retellApi: any = {
    ensureAgent: async () => ({ id: "test-agent", version: 0 }),
    inspectAgent: async () => ({ id: "test-agent", version: 0 }),
    request: vi.fn(async () => ({ call_id: "test-web", access_token: "test-only", transport: "gateway",
      ice_servers: [], expires_at: Date.now() + 60000 })),
  };
  const profile: RetellLabProfile = { agentName: "test", mode: "retell-engine", check: async () => ({}),
    reserve: (...args) => registry.reserve(...args), registered: (...args) => registry.registered(...args),
    ended: id => registry.ended(id) };
  const retell = new RetellSecretaryLab(retellApi, Date.now, () => true, profile);
  cleanup.push(() => retell.dispose());
  const body = { instruction, consent: true, clientRequestId: randomUUID(), personality: selection };
  return { eleven, retell, registry, rows, makeEleven, elevenApi, retellApi, body };
}

describe("catalog personalities in the two browser Engine transports", () => {
  it("builds identical personality rules and TEST context for Eleven and Retell, and retains TEST permissions", async () => {
    const f = fixture();
    const a = await f.eleven.create("owner", { ...f.body, voice: "catalog", profileId: "baseline" });
    const b = await f.retell.create("owner", f.body);
    const elevenEngine = (f.eleven as any).sessions.get(a.id).engine as SecretaryConversationEngine;
    const retellEngine = (f.registry as any).entries.get(b.id).engine as SecretaryConversationEngine;
    const withoutClock = (s: string) => s.replace(/Current time: [0-9T:.Z-]+/, "Current time: FIXED");
    expect(withoutClock(elevenEngine.instructions)).toBe(withoutClock(retellEngine.instructions));
    for (const engine of [elevenEngine, retellEngine]) {
      expect(engine.instructions).toContain(JSON.stringify(initialKatya.rules));
      expect(engine.instructions).toContain(JSON.stringify(SECRETARY_TEST_CONTEXT));
      expect(engine.instructions).toContain("Tools are TEST ONLY");
      expect(engine.instructions).toContain("Hello, I’m Катя");
      expect(engine.report.personality).toEqual({ ...selection, name: "Катя" });
      const args = '{"sender":"TEST","message":"Meet at eight"}';
      engine.execute("save_test_message", args, new AbortController().signal);
      engine.execute("save_test_message", args, new AbortController().signal);
      expect(engine.report.actions).toHaveLength(1);
      expect(engine.report.actions[0].result).toMatchObject({ testOnly: true, delivered: false, calendarWritten: false });
      expect(() => engine.execute("send_real_notification", "{}", new AbortController().signal)).toThrow();
    }
    expect(a.report.personality).toEqual(b.report.personality);
    expect(a.report.profileId).toBe("baseline");
    expect(b.report.profileId).toBe("default");
    expect(f.elevenApi.create).toHaveBeenCalledTimes(1);
    expect(f.retellApi.request).toHaveBeenCalledTimes(1);
    await f.eleven.stop("owner", a.id);
  });
  it("keeps an admitted version frozen on retries, even if the catalog changes, and rejects a new choice with the old ID", async () => {
    const f = fixture();
    const input = { ...f.body, voice: "catalog" };
    const a = await f.eleven.create("owner", input);
    const b = await f.retell.create("owner", f.body);
    catalog.read.mockRejectedValue(Object.assign(new Error("Catalog changed"), { status: 409 }));
    expect((await f.eleven.create("owner", input)).id).toBe(a.id);
    expect((await f.retell.create("owner", f.body)).id).toBe(b.id);
    await expect(f.eleven.create("owner", { ...input, personality: null })).rejects.toMatchObject({ status: 409 });
    await expect(f.retell.create("owner", { ...f.body, personality: { ...selection, mode: "personal" } })).rejects.toMatchObject({ status: 409 });
    expect(f.elevenApi.create).toHaveBeenCalledTimes(1);
    expect(f.retellApi.request).toHaveBeenCalledTimes(1);
    await f.eleven.stop("owner", a.id);
  });
  it("archives identity/version/profile in the common report and reads it after a fresh Lab instance", async () => {
    const f = fixture();
    const a = await f.eleven.create("owner", { ...f.body, voice: "catalog", profileId: "flash" });
    const b = await f.retell.create("owner", f.body);
    await f.eleven.stop("owner", a.id);
    const restarted = f.makeEleven(); cleanup.push(() => restarted.dispose());
    const reread = await restarted.report("owner", a.id);
    expect(reread.report.personality).toEqual({ ...selection, name: "Катя" });
    expect(reread.report.profileId).toBe("flash");
    const retellSnapshot = JSON.parse(JSON.stringify(comparisonSnapshot("retell-engine", b.report)));
    expect(retellSnapshot.personality).toEqual({ ...selection, name: "Катя" });
    expect(retellSnapshot.profileId).toBe("default");
    expect(JSON.stringify(retellSnapshot)).not.toContain("test-only");
  });
  it("rejects invalid or stale catalog choices before paid admission", async () => {
    const f = fixture();
    await expect(f.eleven.create("owner", { ...f.body, voice: "catalog", personality: { ...selection, version: 1 } })).rejects.toMatchObject({ status: 409 });
    await expect(f.retell.create("owner", { ...f.body, personality: { ...selection, id: "retired" } })).rejects.toMatchObject({ status: 409 });
    expect(f.elevenApi.create).not.toHaveBeenCalled();
    expect(f.retellApi.request).not.toHaveBeenCalled();
    expect(() => parseLabPersonality({ ...selection, rules: "override" })).toThrow();
    expect(() => parseLabPersonality({ ...selection, mode: "other-owner" })).toThrow();
  });
  it("keeps no-personality TEST behavior and does not read cards, phone assignments or catalog", async () => {
    const f = fixture();
    const a = await f.eleven.create("owner", { ...f.body, voice: "catalog", personality: null });
    const b = await f.retell.create("owner", { ...f.body, personality: null });
    expect(catalog.read).not.toHaveBeenCalled();
    expect(a.report.personality).toBeNull();
    expect(b.report.personality).toBeNull();
    const prompt = (f.eleven as any).sessions.get(a.id).engine.instructions;
    expect(prompt).not.toContain("SECRETARY PERSONALITY");
    expect(prompt).toContain("Do not assign yourself a personal name");
    expect(await resolveLabPersonality(null)).toBeUndefined();
    await f.eleven.stop("owner", a.id);
  });
});
