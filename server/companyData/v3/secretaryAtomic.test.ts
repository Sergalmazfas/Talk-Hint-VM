import { describe, expect, it, vi } from "vitest";
import type { ModelCommand } from "../../../shared/projectModel";
import { authorizeSecretaryDepartmentBatch, bindSecretaryDepartmentPreparation } from "../../projectModel/transactionBatch";
import { buildTeamChange } from "../../productCrew/teamChanges";
import { IncrementalCompanyRepository, type PrepareDelta } from "./repository";

const controls = vi.hoisted(() => ({ open: true }));
vi.mock("../cutover/guard", () => ({
  lockCompanyWrite: vi.fn(async () => {
    if (!controls.open) throw Object.assign(new Error("writes closed"), { status: 423 });
  }),
}));
vi.mock("./businessContract", () => ({ readBusinessContract: vi.fn(async () => ({})) }));
vi.mock("./codec", async importOriginal => ({
  ...await importOriginal<typeof import("./codec")>(),
  encode: vi.fn(async () => "encoded-fixture"),
  replace: vi.fn(async () => "next-root-fixture"),
}));
vi.mock("./store", () => ({
  SqlFrameStore: class {
    stats = {}; sqlReads = 0;
    constructor(readonly db: any, readonly workspace: string) {}
    async get() { return {}; }
    async flush() { await this.db.query("fixture_flush"); }
  },
}));

// Real commitDelta and its SQL transaction flow; isolated SQL/frame doubles.
// No PostgreSQL connection or application data is used by these tests.
function harness(failure = "", stale = false) {
  const original = { revision: 10, root: "before", heads: [] as string[],
    documents: [] as string[], projections: [] as string[] };
  let durable = structuredClone(original), staged = structuredClone(original);
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    if (sql === "BEGIN") staged = structuredClone(durable);
    else if (sql === "ROLLBACK") staged = structuredClone(durable);
    else if (sql === "COMMIT") durable = structuredClone(staged);
    else if (sql.includes("SELECT * FROM company_v3_workspaces"))
      return { rows: [{ workspace_id: "fixture", schema_version: 3, generation: "normalized",
        current_revision: stale ? 11 : 10, root_hash: "before" }] };
    else if (sql === "fixture_flush") {
      staged.projections.push("all-fixture-projections");
      if (failure === "flush") throw new Error("injected flush failure");
    } else if (sql.includes("INSERT INTO company_v3_revision_heads")) staged.heads.push(values[2]);
    else if (sql.includes("INSERT INTO company_v3_document_heads")) {
      staged.documents.push(values[2]);
      if (failure === "document" && staged.documents.length === 3)
        throw new Error("injected middle-document failure");
    } else if (sql.includes("UPDATE company_v3_workspaces")) {
      if (failure === "cas") return { rows: [], rowCount: 0 };
      staged.revision = values[1]; staged.root = values[2];
      return { rows: [{ workspace_id: "fixture" }], rowCount: 1 };
    } else throw new Error(`Unexpected isolated SQL: ${sql}`);
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn(), pool = { connect: vi.fn(async () => ({ query, release })) };
  const repo = new IncrementalCompanyRepository(pool as any, "production");
  return { repo, query, release, original, durable: () => durable };
}

function prepareMacro() {
  const state = { operatingModel: { revisions: [{ version: 1, data: { nodes: [
    { id: "head-product", kind: "role", code: "HEAD.06", managerId: "owner", parentId: "dir-product" },
  ], links: [] } }] }, documents: [], elements: [] } as any;
  const commands: ModelCommand[] = buildTeamChange(state, "create_secretary_department_structure", {}).commands;
  commands.push({ type: "createElement", id: "PC-CHANGE-fixture",
    element: { coordination: { roleId: "secretary-project-head",
      processId: "DOC-SECRETARY-DEPARTMENT-STRUCTURE", state: "received" } } as any });
  authorizeSecretaryDepartmentBatch("owner", 10, commands);
  const prepare: PrepareDelta = async () => ({
    revisionAdvance: 7,
    edits: commands.map((c, i) => ({ path: ["fixture", String(i)], value: c,
      ...(c.type === "createDocument" ? { document: { hypothesis: "new-country", id: c.id! } } : {}) })),
  });
  bindSecretaryDepartmentPreparation("owner", 10, commands, "new-country", prepare);
  return prepare;
}

describe("real v3 commitDelta SQL transaction for the bounded Secretary macro", () => {
  it("commits revision, five document heads and projections together, with +7 revision", async () => {
    controls.open = true;
    const f = harness(), r = await f.repo.commitDelta("owner", 10, prepareMacro(), "owner");
    expect(r.revision).toBe(17);
    expect(f.durable()).toMatchObject({ revision: 17, root: "next-root-fixture",
      heads: ["next-root-fixture"], projections: ["all-fixture-projections"] });
    expect(f.durable().documents).toHaveLength(5);
    expect(f.query.mock.calls.filter(([sql]) => sql === "COMMIT")).toHaveLength(1);
    expect(f.query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(false);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it.each(["flush", "document", "cas"])("rolls back every part after %s failure", async failure => {
    controls.open = true;
    const f = harness(failure);
    await expect(f.repo.commitDelta("owner", 10, prepareMacro(), "owner")).rejects.toThrow();
    expect(f.query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
    expect(f.query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(false);
    expect(f.durable()).toEqual(f.original);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("still refuses a closed write gate and a stale revision", async () => {
    const closed = harness();
    controls.open = false;
    await expect(closed.repo.commitDelta("owner", 10, prepareMacro(), "owner")).rejects.toMatchObject({ status: 423 });
    expect(closed.durable()).toEqual(closed.original);
    controls.open = true;
    const stale = harness("", true);
    await expect(stale.repo.commitDelta("owner", 10, prepareMacro(), "owner")).rejects.toMatchObject({ status: 409 });
    expect(stale.durable()).toEqual(stale.original);
  });
  it("refuses an unbound seven-step delta and commits none of it", async () => {
    controls.open = true;
    const f = harness();
    const unbound: PrepareDelta = async () => ({ revisionAdvance: 7, edits: [{ path: ["fixture"], value: "invalid" }] });
    await expect(f.repo.commitDelta("owner", 10, unbound, "owner")).rejects.toMatchObject({ status: 400 });
    expect(f.durable()).toEqual(f.original);
    expect(f.query.mock.calls.some(([sql]) => sql === "fixture_flush")).toBe(false);
  });
});
