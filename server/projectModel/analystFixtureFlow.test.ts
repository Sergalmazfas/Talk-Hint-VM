import { describe, expect, it } from "vitest";
import { advanceFixtureRun, createFixtureRun, type FixtureAdapters, type FixtureCheckpoint, type FixtureClaim, type FixtureJournal } from "./analystFixtureFlow";
import { defaultAnalystPreparation } from "../../shared/competitiveAnalystTemplate";
import { initialModel } from "./seed";

/** JSON-backed fake of the SAME owner model journal; never a production store. */
function journal(rows = new Map<string, string>()): FixtureJournal & { rows: Map<string, string> } {
  return { rows,
    read: async (owner, run) => JSON.parse(rows.get(`${owner}:${run}`) ?? "null"),
    write: async (owner, run, expected, next) => {
      const old = JSON.parse(rows.get(`${owner}:${run}`) ?? "null") as FixtureCheckpoint | null;
      if (old?.version !== (expected ?? undefined) || next.owner !== owner || next.runId !== run) throw new Error("409 journal conflict");
      rows.set(`${owner}:${run}`, JSON.stringify(next));
    },
  };
}
const sources = [{ id: "one", url: "https://example.test/one" }, { id: "two", url: "https://example.test/two" }];
const limits = () => defaultAnalystPreparation(initialModel()).limits;
const claim = (after = "ТЕСТ: годовой план"): FixtureClaim => ({
  section: "Цены", field: "annual-plan", before: "ТЕСТ: старый план", after, milestone: "released_claim",
  evidence: "ЯВНО СИНТЕТИЧЕСКОЕ свидетельство", publishedAt: null, releasedAt: null,
  platform: "web", country: "US", plan: "annual",
});
function adapters(claims: FixtureClaim[] = [claim()]): FixtureAdapters {
  return { mode: "offline_fixture", now: () => 1000, estimateUsd: () => .01,
    collect: async s => ({ sourceId: s.id, url: s.url, kind: "page", content: "ТЕСТ, не сетевой запрос" }),
    extract: async () => claims,
  };
}
async function finish(j: FixtureJournal, a: FixtureAdapters, owner = "owner", run = "run") {
  for (let i = 0; i < 30; i++) {
    const s = await advanceFixtureRun(j, a, owner, run);
    if (s.phase === "complete" || s.phase === "limited") return s;
  }
  throw new Error("Unbounded fixture loop");
}
describe("offline contract, not CrewAI execution", () => {
  it("resumes serialized checkpoints and merges one finding with multiple sources/directions", async () => {
    const j = journal(), a = adapters(); let collects = 0;
    const collect = a.collect; a.collect = async s => { collects++; return collect(s); };
    await createFixtureRun(j, "owner", "run", "canonical-fixture-id", sources, limits(), 1000);
    const first = await advanceFixtureRun(j, a, "owner", "run"); expect(first.phase).toBe("extract");
    const restarted = journal(j.rows); // Only persisted JSON remains.
    const completed = await finish(restarted, a);
    expect(collects).toBe(2); expect(completed.findings).toHaveLength(1);
    expect(completed.findings[0]).toMatchObject({ recipient: "Сергей", destinations: ["finance", "product"], sourceIds: ["one", "two"] });
    expect(completed.findings[0].sourceUrls).toEqual(sources.map(s => s.url));
    expect(await advanceFixtureRun(restarted, a, "owner", "run")).toEqual(completed);
    expect(collects).toBe(2);
    await expect(createFixtureRun(j, "owner", "run", "canonical-fixture-id", sources, limits(), 1000)).rejects.toThrow(/409/);
  });
  it("does not silently restart missing runs, cross owners, accept production URLs or overwrite checkpoints", async () => {
    const j = journal(), a = adapters();
    await expect(advanceFixtureRun(j, a, "owner", "missing")).rejects.toThrow(/Unknown checkpoint/);
    await createFixtureRun(j, "owner", "run", "fixture", sources, limits(), 1000);
    await expect(advanceFixtureRun(j, a, "other", "run")).rejects.toThrow(/Unknown/);
    await expect(createFixtureRun(j, "owner", "live", "fixture", [{ id: "real", url: "https://vocalingo.app" }], limits(), 1000)).rejects.toThrow(/synthetic/);
    const old = (await j.read("owner", "run"))!;
    await advanceFixtureRun(j, a, "owner", "run");
    await expect(j.write("owner", "run", 0, old)).rejects.toThrow(/409/);
  });
  it("caps retries, reports checked and inaccessible sources, never claims the competitor has no changes", async () => {
    const j = journal(), a = adapters([]); let fails = 0;
    a.collect = async s => {
      if (s.id === "two") { fails++; throw new Error("simulated unavailable"); }
      return { sourceId: s.id, url: s.url, kind: "page", content: "ТЕСТ" };
    };
    await createFixtureRun(j, "owner", "run", "fixture", sources, limits(), 1000);
    const s = await finish(j, a);
    expect(fails).toBe(limits().maxAttempts);
    expect(s.checkedSourceIds).toEqual(["one"]); expect(s.unavailableSourceIds).toEqual(["two"]);
    expect(s.summary).toContain("Изменений в проверенных источниках не обнаружено");
    expect(s.summary).toContain("не вывод об отсутствии изменений");
  });
  it("fails closed on unknown cost, budget exhaustion and elapsed duration before provider operations", async () => {
    for (const mode of ["unknown", "budget", "elapsed"] as const) {
      const j = journal(), a = adapters(); let called = false;
      a.collect = async () => { called = true; throw new Error("must not execute"); };
      a.estimateUsd = () => mode === "unknown" ? null : mode === "budget" ? 100 : 0;
      if (mode === "elapsed") a.now = () => 1000000;
      await createFixtureRun(j, "owner", "run", "fixture", sources, limits(), 1000);
      expect((await finish(j, a)).phase).toBe("limited"); expect(called).toBe(false);
    }
  });
  it("retains contradictory evidence and rejects metadata-as-watching / personal review claims", async () => {
    const j = journal(), a = adapters(); let n = 0;
    a.extract = async () => [claim(n++ === 0 ? "ТЕСТ $10" : "ТЕСТ $20")];
    await createFixtureRun(j, "owner", "run", "fixture", sources, limits(), 1000);
    const s = await finish(j, a);
    expect(s.findings).toHaveLength(2); expect(s.contradictions).toHaveLength(1);
    expect(s.contradictions[0].values).toEqual(["ТЕСТ $10", "ТЕСТ $20"]);
    const j2 = journal(), b = adapters([{ ...claim(), milestone: "demonstrated" }]);
    b.collect = async s => ({ sourceId: s.id, url: s.url, kind: "metadata", content: "Только выдача поиска" });
    await createFixtureRun(j2, "owner", "run", "fixture", sources, limits(), 1000);
    expect((await finish(j2, b)).findings).toEqual([]);
    const j3 = journal(), c = adapters([{ ...claim(), milestone: "personally_tested" as any }]);
    await createFixtureRun(j3, "owner", "run", "fixture", sources, limits(), 1000);
    expect((await finish(j3, c)).findings).toEqual([]);
  });
  it("does not swallow a journal write failure or advance to the next expensive step", async () => {
    const j = journal(), a = adapters(); let extracted = 0;
    a.extract = async () => { extracted++; return [claim()]; };
    await createFixtureRun(j, "owner", "run", "fixture", sources, limits(), 1000);
    const failed: FixtureJournal = { ...j, write: async () => { throw new Error("simulated DB failure"); } };
    await expect(advanceFixtureRun(failed, a, "owner", "run")).rejects.toThrow(/DB failure/);
    expect(extracted).toBe(0); expect((await j.read("owner", "run"))!.version).toBe(0);
  });
});
