import { beforeEach, describe, expect, it, vi } from "vitest";
const { documentRead } = vi.hoisted(() => ({ documentRead: vi.fn() }));
vi.mock("./repository", () => ({
  IncrementalCompanyRepository: class {
    readDocumentSnapshot = documentRead;
    read() {} readRevision() {} commitDelta() {}
  },
}));
import { activeCompanyDocument, activeCompanyRepository, hasNormalizedCompanySource } from "../active";

function pool(v3: boolean, v2 = false) {
  return { query: vi.fn(async (sql: string, params?: any[]) => {
    if (sql.includes("to_regclass")) return { rows: [{ company_table: "company_workspaces", company_v3_table: "company_v3_workspaces" }] };
    if (sql.includes("company_v3_workspaces")) return { rows: [], rowCount: v3 && params?.[0] === "owner" ? 1 : 0 };
    if (sql.includes("company_workspaces")) return { rows: [], rowCount: v2 ? 1 : 0 };
    throw new Error("Unexpected SQL");
  }) } as any;
}
describe("v3 candidate routing stays owner/environment-bound", () => {
  beforeEach(() => documentRead.mockReset());
  it("does not select a retained test or shadow candidate", async () => {
    expect(await activeCompanyRepository(pool(false), "owner")).toBeNull();
    expect(await hasNormalizedCompanySource(pool(false), "owner")).toBe(false);
  });
  it("selects only an explicitly active v3 source", async () => {
    expect(await activeCompanyRepository(pool(true), "owner")).not.toBeNull();
    expect(await activeCompanyRepository(pool(true), "other")).toBeNull();
  });
  it("uses the direct reader and never falls back on corruption", async () => {
    const p = pool(true);
    documentRead.mockResolvedValueOnce({ revision: 932, document: { text: "exact" } });
    expect(await activeCompanyDocument(p, "owner", "production", "D")).toEqual({ revision: 932, text: "exact" });
    expect(documentRead).toHaveBeenCalledWith("owner", "new-country", "D");
    documentRead.mockRejectedValueOnce(new Error("corrupt"));
    await expect(activeCompanyDocument(p, "owner", "production", "D")).rejects.toThrow("corrupt");
    expect(p.query.mock.calls.some((c: any[]) => c[0].includes("company_document_versions"))).toBe(false);
  });
  it("refuses two active catalogues", async () => {
    await expect(activeCompanyRepository(pool(true, true), "owner")).rejects.toThrow("Two active");
    await expect(activeCompanyDocument(pool(true, true), "owner", "production", "D")).rejects.toThrow("Two active");
  });
});
