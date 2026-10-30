import { describe, expect, it, vi } from "vitest";
import { readContext } from "./repository";
import { DIRECTORY } from "./plan";
import { checkFrame, encode, frameHash, type Frame, type FrameStore } from "../companyData/v3/codec";
import type { SqlFrameStore } from "../companyData/v3/store";
import type { PoolClient } from "pg";

class Memory implements FrameStore {
  frames = new Map<string, Frame>();
  async put(frame: Frame) { const hash = frameHash(frame); this.frames.set(hash, frame); return hash; }
  async get(hash: string) {
    const frame = this.frames.get(hash);
    if (!frame) throw Error("Missing frame");
    return checkFrame(hash, { version: 1, frame });
  }
  async prefetch() {}
  async column(): Promise<never> { throw Error("Unexpected column reference"); }
}
async function setup(directoryText: string | undefined) {
  const store = new Memory();
  const documents = directoryText === undefined ? [] : [{ id: DIRECTORY, text: directoryText }];
  const root = await encode({ alternatives: [{ id: "new-country", model: {
    revision: 5, documents, elements: [],
    operatingModel: { revisions: [{ version: 4, data: { nodes: [], links: [] } }] },
  } }] }, store);
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (!sql.trimStart().startsWith("SELECT")) throw Error("Read-only reader emitted a write");
    // The deployed users schema has no first_name / last_name. Do NOT mock
    // that query as successful or bypass the ordinary production branch.
    if (/\bFROM users\b/.test(sql)) throw Object.assign(Error('column "first_name" does not exist'), { code: "42703" });
    if (sql.includes("FROM company_v3_workspaces")) {
      expect(params).toEqual(["owner-fixture", "production"]);
      return { rows: [{ workspace_id: "fixture", schema_version: 3, generation: "normalized",
        phase: "active", writes_open: true, current_revision: 918, root_hash: root, actor: "fixture" }] };
    }
    if (sql.includes("FROM secretary_tasks")) {
      expect(params).toEqual(["owner-fixture"]);
      return { rows: [{ id: "task-fixture", instruction: "Saved task" }] };
    }
    if (sql.includes("FROM secretary_outgoing_defaults")) {
      expect(params).toEqual(["owner-fixture"]);
      return { rows: [{ provider: "retell" }] };
    }
    return { rows: [] };
  });
  const read = () => readContext({ query } as unknown as PoolClient, "owner-fixture", "production",
    { store: store as unknown as SqlFrameStore }); // No test:true; all ordinary reads execute.
  return { query, read };
}

describe("ordinary production team reader SQL contract", () => {
  it("executes the production-only reads without querying nonexistent users name columns", async () => {
    const s = await setup(JSON.stringify({ owner: { name: "Сергей" } }));
    const c = await s.read();
    expect(c.secretaryOwnerName).toBe("Сергей");
    expect(c.secretaryTasks).toEqual([{ id: "task-fixture", instruction: "Saved task" }]);
    expect(c.secretaryDefault).toBe("retell");
    const sql = s.query.mock.calls.map(call => call[0]).join("\n");
    expect(sql).toContain("FROM secretary_tasks");
    expect(sql).toContain("FROM secretary_outgoing_defaults");
    expect(sql).not.toMatch(/\bFROM users\b|\bfirst_name\b|\blast_name\b/);
  });
  it.each([undefined, "{}", '{"owner":null}', '{"owner":{"name":null}}',
    '{"owner":{"name":42}}', '{"owner":{"name":"  "}}'])(
    "does not invent an owner name for missing/invalid name data %s", async text => {
      const s = await setup(text);
      expect((await s.read()).secretaryOwnerName).toBe("");
    });
  it("uses the current directory value, not a hard-coded owner name", async () => {
    const s = await setup('{"owner":{"name":"  Имя из текущей модели  "}}');
    expect((await s.read()).secretaryOwnerName).toBe("Имя из текущей модели");
  });
  it("does not conceal a corrupt company document as an empty owner name", async () => {
    const s = await setup("{not-json");
    await expect(s.read()).rejects.toThrow();
  });
});
