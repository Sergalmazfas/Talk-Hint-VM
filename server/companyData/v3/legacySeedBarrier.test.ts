import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../active", () => ({activeCompanyRepository: vi.fn(async () => null), hasNormalizedCompanySource: vi.fn(async () => false)}));
import { PgModelRepository } from "../../projectModel/repository";
import { blocksLegacySeed, reviewedAccountBinding } from "./importApproval";
afterEach(() => vi.unstubAllEnvs());
describe("confirmed owner's production legacy seed barrier", () => {
  it("is exact-owner/environment only, independent of import consent", () => {
    expect(blocksLegacySeed(reviewedAccountBinding.targetOwner, "production")).toBe(true);
    expect(blocksLegacySeed(reviewedAccountBinding.targetOwner, "development")).toBe(false);
    expect(blocksLegacySeed("other", "production")).toBe(false);
  });
  it("book GET and a legacy write cannot insert or update the owner's model before cutover", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const query = vi.fn(async () => ({rows: [], rowCount: 0}));
    const repo = new PgModelRepository(async () => ({query} as any));
    await expect(repo.read(reviewedAccountBinding.targetOwner, "new-country")).rejects.toThrow("Создание начальной модели отключено");
    await expect(repo.updateMany(reviewedAccountBinding.targetOwner, 0,
      [{type: "recordDecision", note: "not written"}] as any, "new-country")).rejects.toThrow("Создание начальной модели отключено");
    expect(query.mock.calls.some(c => /\b(INSERT|UPDATE|DELETE)\b/i.test(c[0]))).toBe(false);
  });
});
