import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./diagnostics", async original => ({ ...await original<any>(), assertNoOtherCutoverProcess: vi.fn() }));
import { assertNoOtherCutoverProcess } from "./diagnostics";
import { CompanyCutover } from "./service";
import { cutoverCandidate } from "./policy";
import { semanticHash } from "../valueTree";

describe("reconciliation guards and audit", () => {
  const expected = { workspace: cutoverCandidate.workspace, revision: 912,
    rootHash: cutoverCandidate.rootHash, manifestHash: cutoverCandidate.manifestHash };
  let service: CompanyCutover, db: any, pool: any, failure: any, c: any, w: any, lease: boolean, root: any, busy: boolean;
  beforeEach(() => {
    vi.restoreAllMocks(); vi.mocked(assertNoOtherCutoverProcess).mockReset();
    vi.mocked(assertNoOtherCutoverProcess).mockResolvedValue(undefined);
    failure = { operation_id: "old", action: "activate", state: "failed" };
    c = { phase: "shadow", writes_open: false, current_operation_id: "new", workspace_id: expected.workspace,
      manifest_hash: expected.manifestHash };
    w = { workspace_id: expected.workspace, current_revision: 912, root_hash: expected.rootHash, generation: "shadow" };
    root = {}; lease = true; busy = false;
    db = { release: vi.fn(), query: vi.fn(async (sql: string) => {
      if (sql.includes("pg_try_advisory")) return { rows: [{ locked: lease }] };
      if (sql.includes("FROM company_v3_workspaces")) return { rows: [w] };
      if (sql.includes("to_regclass")) return { rows: [{ present: true }] };
      if (sql.includes("FROM company_cutover_controls")) return { rows: [c] };
      if (sql.includes("SELECT operation_id,action,state")) return { rows: [failure] };
      if (sql.includes("SELECT action,state")) return { rows: [failure] };
      if (sql.includes("SELECT 1 FROM company_cutover_operations")) return { rows: [], rowCount: busy ? 1 : 0 };
      if (sql.includes("company_v3_document_heads")) return { rows: [] };
      return { rows: [], rowCount: 1 };
    }) };
    pool = { connect: vi.fn(async () => db), query: db.query };
    const policy = { ...cutoverCandidate, semanticHash: semanticHash(root) };
    service = new CompanyCutover(pool, "production", policy, policy);
    vi.spyOn(service as any, "root").mockImplementation(async (...args: any[]) => {
      if (args[2]) await args[2](root, {});
      return root;
    });
    vi.spyOn(service, "diagnostic").mockResolvedValue(undefined);
  });
  const reconcile = () => (service as any).reconcile(cutoverCandidate.owner, expected, "new", "old");
  it("rejects live worker before a transaction or changes", async () => {
    vi.mocked(assertNoOtherCutoverProcess).mockRejectedValue(new Error("CUTOVER_OTHER_WORKER_ALIVE"));
    await expect(reconcile()).rejects.toThrow("OTHER_WORKER_ALIVE"); expect(pool.connect).not.toHaveBeenCalled();
  });
  it("refuses an occupied legacy write transaction", async () => {
    lease = false; await expect(reconcile()).rejects.toThrow("WRITE_LEASE_BUSY");
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
  });
  for (const changed of ["phase", "writes", "generation", "operation", "manifest", "failure", "revision"] as const)
    it(`rejects changed ${changed} without updating the original failed operation`, async () => {
      if (changed === "phase") c.phase = "verifying";
      if (changed === "writes") c.writes_open = true;
      if (changed === "generation") w.generation = "normalized";
      if (changed === "operation") c.current_operation_id = "someone-else";
      if (changed === "manifest") c.manifest_hash = "changed";
      if (changed === "failure") failure.state = "running";
      if (changed === "revision") w.current_revision = 913;
      await expect(reconcile()).rejects.toThrow();
      expect(db.query.mock.calls.some(([s]: any[]) => s.startsWith("UPDATE"))).toBe(false);
    });
  it("refuses another queued/running operation", async () => {
    busy = true; await expect(reconcile()).rejects.toThrow("OTHER_OPERATION_BUSY");
  });
  it("refuses full semantic SHA mismatch", async () => {
    root = { changed: true };
    vi.spyOn(service as any, "root").mockResolvedValue(root);
    await expect(reconcile()).rejects.toThrow("BASELINE_SHA_MISMATCH");
  });
  it("refuses missing or substituted documents", async () => {
    await expect(reconcile()).rejects.toThrow("DOCUMENT_BASELINE_MISMATCH");
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
  });
  it("requires a failed activation; old grant is bound to the exact failed operation", async () => {
    failure.state = "succeeded";
    await expect(service.grant(cutoverCandidate.owner, "reconcile", expected)).rejects.toMatchObject({ status: 423 });
    failure.state = "failed";
    await service.grant(cutoverCandidate.owner, "reconcile", expected);
    const insert = db.query.mock.calls.find(([s]: any[]) => s.includes("INSERT INTO company_cutover_grants"));
    expect(insert[1][4]).toEqual({ ...expected, reconciliationOf: "old" });
    await expect(service.grant(cutoverCandidate.owner, "activate", expected)).rejects.toMatchObject({ status: 423 });
    expect(db.query.mock.calls.some(([s]: any[]) => s.startsWith("UPDATE company_cutover_operations"))).toBe(false);
  });
  it("requires exact CAS pin before granting reconciliation", async () => {
    await expect(service.grant(cutoverCandidate.owner, "reconcile", { ...expected, rootHash: "a".repeat(64) }))
      .rejects.toMatchObject({ status: 409 });
  });
});
