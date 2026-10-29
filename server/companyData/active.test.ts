import { describe, expect, it, vi } from "vitest";
import { activeCompanyDocument } from "./active";
import { textHash } from "./valueTree";
describe("active owner-bound company document", () => {
  it("leaves the old source selected before schema publication", async () => {
    const query = vi.fn(async () => ({ rows: [{ company_table: null }], rowCount: 1 }));
    expect(await activeCompanyDocument({ query } as any, "a", "production", "D")).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("does not activate a shadow workspace", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ company_table: "company_workspaces" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await activeCompanyDocument({ query } as any, "a", "production", "D")).toBeNull();
    expect(query.mock.calls[1][0]).toContain("storage_generation='normalized'");
    expect(query.mock.calls[1][1]).toEqual(["a", "production"]);
  });
  it("returns the selected revision with verified exact text", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ company_table: "company_workspaces" }] })
      .mockResolvedValueOnce({ rows: [{ workspace_id: "w", current_revision: 7 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ text_body: "😀", utf8_sha256: textHash("😀") }], rowCount: 1 });
    expect(await activeCompanyDocument({ query } as any, "a", "production", "D"))
      .toEqual({ text: "😀", revision: 7 });
    expect(query.mock.calls[2][1]).toEqual(["w", "D", 7]);
  });
  it("refuses stale JSON fallback if the active document is missing or corrupt", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ company_table: "company_workspaces" }] })
      .mockResolvedValueOnce({ rows: [{ workspace_id: "w", current_revision: 7 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ text_body: "bad", utf8_sha256: textHash("good") }], rowCount: 1 });
    await expect(activeCompanyDocument({ query } as any, "a", "production", "D")).rejects.toThrow("fallback is forbidden");
    expect(query).toHaveBeenCalledTimes(3);
  });
});
