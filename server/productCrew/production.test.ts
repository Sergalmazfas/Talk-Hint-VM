import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { productionProductRepository } from "./production";
import { activeCompanyRepository } from "../companyData/active";

vi.mock("../companyData/active", () => ({ activeCompanyRepository: vi.fn() }));
const factory = vi.mocked(activeCompanyRepository);
beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); factory.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
function fixture(open = true, present = true) {
  const target = { read: vi.fn().mockResolvedValue({ revision: 919 }),
    update: vi.fn().mockResolvedValue({ revision: 920 }),
    updateMany: vi.fn().mockResolvedValue({ revision: 920 }),
    readDocumentSnapshot: vi.fn().mockResolvedValue({ revision: 919 }) };
  factory.mockResolvedValue(target as any);
  const query = vi.fn().mockResolvedValue({ rows: present ? [{ workspace_id: "fixture", writes_open: open }] : [] });
  const pool = { query } as unknown as Pool;
  const getPool = vi.fn().mockResolvedValue(pool);
  return { repo: productionProductRepository(getPool), target, query, getPool, pool };
}
describe("production MCP source boundary", () => {
  it("selects the active normalized v3 production source for the authenticated owner without legacy SQL", async () => {
    const f = fixture();
    await f.repo.read("owner", "new-country");
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("w.environment='production'"), ["owner"]);
    expect(f.query.mock.calls[0][0]).toContain("c.phase='active'");
    expect(f.query.mock.calls[0][0]).toContain("w.schema_version=3");
    expect(f.target.read).toHaveBeenCalledWith("owner", "new-country");
    expect(f.query.mock.calls[0][0]).not.toMatch(/INSERT|UPDATE|DELETE|talkhint_project_models/);
  });
  it("keeps read access when writes are closed, but denies both single and batch writes", async () => {
    const f = fixture(false);
    await f.repo.read("owner");
    await expect(f.repo.updateMany!("owner", 919, [], "new-country")).rejects.toMatchObject({ status: 423 });
    await expect(f.repo.update("owner", 919, {} as any, "new-country")).rejects.toMatchObject({ status: 423 });
    expect(f.target.updateMany).not.toHaveBeenCalled(); expect(f.target.update).not.toHaveBeenCalled();
  });
  it("never falls back to Dev/legacy/checkpoint if the active source is absent", async () => {
    const f = fixture(true, false);
    await expect(f.repo.read("owner")).rejects.toMatchObject({ status: 423 });
    expect(factory).not.toHaveBeenCalled();
  });
  it("rejects ambiguous routing and does not manufacture a source", async () => {
    const f = fixture(); factory.mockResolvedValue(null);
    await expect(f.repo.read("owner")).rejects.toMatchObject({ status: 423 });
    factory.mockRejectedValue(new Error("Two active company sources"));
    await expect(f.repo.read("owner")).rejects.toThrow("Two active");
  });
  it("does not touch any database outside production or for another hypothesis", async () => {
    const f = fixture();
    await expect(f.repo.read("owner", "original")).rejects.toMatchObject({ status: 403 });
    vi.stubEnv("NODE_ENV", "development");
    await expect(f.repo.read("owner")).rejects.toMatchObject({ status: 503 });
    expect(f.getPool).not.toHaveBeenCalled();
  });
  it("preserves CAS/commands and owner binding on atomic writes and direct document reads", async () => {
    const f = fixture();
    await f.repo.updateMany!("owner", 919, [], "new-country");
    expect(f.target.updateMany).toHaveBeenCalledWith("owner", 919, [], "new-country");
    await f.repo.readDocumentSnapshot!("other-owner", "new-country", "DOC-FIXTURE");
    expect(f.target.readDocumentSnapshot).toHaveBeenCalledWith("other-owner", "new-country", "DOC-FIXTURE");
    expect(f.query).toHaveBeenLastCalledWith(expect.any(String), ["other-owner"]);
  });
});
