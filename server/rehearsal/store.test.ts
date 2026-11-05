import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const archive = vi.hoisted(() => {
  const rows = new Map<string, any>();
  return { rows, save: vi.fn(async (owner: string, row: any) => rows.set(owner + ":" + row.id, structuredClone(row))),
    get: vi.fn(async (owner: string, id: string) => structuredClone(rows.get(owner + ":" + id))) };
});
vi.mock("../secretaryLab/devReportArchive", () => ({ devReportArchive: async () => archive }));
import { RehearsalStore } from "./store";
describe("owner-only persistent rehearsal recording settings", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "");
    archive.rows.clear(); archive.save.mockClear(); archive.get.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());
  it("defaults to no consent and persists across new store instances", async () => {
    const store = new RehearsalStore();
    expect(await store.settings("owner")).toEqual({ recordingConsent: false });
    await store.saveSettings("owner", true);
    expect(await new RehearsalStore().settings("owner")).toEqual({ recordingConsent: true });
    expect(await store.settings("other")).toEqual({ recordingConsent: false });
    await store.saveSettings("other", false);
    expect(await store.settings("owner")).toEqual({ recordingConsent: true });
    expect(archive.save.mock.calls[0][1].id).not.toEqual(archive.save.mock.calls[1][1].id);
  });
  it("revokes consent without deleting reports or earlier history", async () => {
    const history = { id: "history", kind: "rehearsal", requestId: "r", report: { turns: ["unchanged"] } } as any;
    const store = new RehearsalStore(); await store.save("owner", history);
    await store.saveSettings("owner", true); await store.saveSettings("owner", false);
    expect(await store.settings("owner")).toEqual({ recordingConsent: false });
    expect(await store.get("owner", "history")).toEqual(history);
  });
  it("never saves or reads settings on a deployment", async () => {
    vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    const store = new RehearsalStore();
    await expect(store.settings("owner")).rejects.toThrow("DEV_ONLY");
    await expect(store.saveSettings("owner", true)).rejects.toThrow("DEV_ONLY");
    expect(archive.save).not.toHaveBeenCalled(); expect(archive.get).not.toHaveBeenCalled();
  });
});
