import { afterEach, describe, expect, it, vi } from "vitest";
import { assertModelWriteAllowed, modelWritesFrozen } from "./migrationFreeze";
import { PgModelRepository } from "../projectModel/repository";
import { CompanyModelRepository } from "./repository";
import { IncrementalCompanyRepository } from "./v3/repository";
import { reviewedAccountBinding } from "./v3/importApproval";
const owner = reviewedAccountBinding.sourceOwner;
afterEach(() => vi.unstubAllEnvs());
describe("frozen Dev owner model, calls and production unaffected", () => {
  it("is exact-owner and Dev-only", () => {
    expect(modelWritesFrozen(owner, "development")).toBe(true);
    expect(modelWritesFrozen("other", "development")).toBe(false);
    expect(modelWritesFrozen(owner, "production")).toBe(false);
    expect(() => assertModelWriteAllowed(owner, "production")).not.toThrow();
  });
  it("rejects all three model writer generations before acquiring a database connection", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const connect = vi.fn(() => { throw new Error("Database must not be acquired"); });
    const pool = {connect} as any;
    const legacy = new PgModelRepository(connect);
    const normalized = new CompanyModelRepository(connect, "development");
    const v3 = new IncrementalCompanyRepository(pool, "development");
    await expect(legacy.updateMany(owner, 912, [{}] as any)).rejects.toThrow("заморожена");
    await expect(normalized.updateMany(owner, 912, [{}] as any)).rejects.toThrow("заморожена");
    await expect(v3.commitDelta(owner, 912, vi.fn(), owner)).rejects.toThrow("заморожена");
    expect(connect).not.toHaveBeenCalled();
  });
  it("does not seed a frozen owner if its legacy record is missing", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const query = vi.fn(async () => ({rows: [], rowCount: 0}));
    const repo = new PgModelRepository(async () => ({query} as any));
    await expect(repo.read(owner)).rejects.toThrow("не создаётся");
    expect(query.mock.calls.some(c => /\b(INSERT|UPDATE|DELETE)\b/i.test(c[0]))).toBe(false);
  });
});
