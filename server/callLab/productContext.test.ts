import { describe, expect, it, vi } from "vitest";
vi.mock("../companyData/active", () => ({ activeCompanyDocument: vi.fn(async () => null) }));
vi.mock("../projectModel/history", () => ({ unpackModel: vi.fn(async (_p, _o, state) => state) }));
vi.mock("../projectModel/hypotheses", () => ({ readHypothesis: vi.fn(state => state) }));
import { attachProductFollowup } from "./productContext";
describe("per-call product context boundary", () => {
  it("selects distinct earlier owner/environment calls and reads canonical journal, no writes", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ report: { call_id: "previous", ended_at: "2026-10-27" } }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ owner_key: "only-owner", state: {
        revision: 885, documents: [{ id: "DOC-TALKHINT-IMPROVEMENT-JOURNAL", text: '{"cases":[]}' }],
      } }] });
    const r = await attachProductFollowup({ query } as any,
      { call_id: "current", ended_at: "2026-10-28", qa_status: "QA: принято" }, null,
      { owner: "only-owner", environment: "production" });
    expect(query.mock.calls[0][1]).toEqual(["only-owner", "production", "current", "2026-10-28"]);
    expect(query.mock.calls[0][0]).toContain("DISTINCT ON (call_sid)");
    expect(query.mock.calls[0][0]).toContain("created_at DESC");
    expect(query.mock.calls[0][0]).toContain("synthetic");
    expect(query.mock.calls[1][0]).toContain("owner_key=$1");
    expect(query.mock.calls[1][0]).toContain("owner_key NOT LIKE 'company-archive:%'");
    expect(query.mock.calls[1][1]).toEqual(["only-owner"]);
    expect(query.mock.calls.every(c => c[0].trim().startsWith("SELECT"))).toBe(true);
    expect(r.product_followup.sourceRevision).toBe(885);
    expect(r.product_followup.previous.map(p => p.callId)).toEqual(["previous"]);
  });
  it("shadow import with only a technical archive does not become the owner's journal", async () => {
    const archive = { owner_key: "company-archive:company-import-fixture", state: {
      revision: 912, documents: [{ id: "DOC-TALKHINT-IMPROVEMENT-JOURNAL", text: '{"cases":[]}' }],
    } };
    const query = vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes("call_lab_jobs")) return { rows: [] };
      // Simulate both the former unscoped query and the new owner-scoped query.
      const rows = sql.includes("owner_key=$1") ? [archive].filter(r => r.owner_key === params[0]) : [archive];
      return { rowCount: rows.length, rows };
    });
    const r = await attachProductFollowup({ query } as any,
      { call_id: "current", deterministic: { acknowledged: 2, hints_ui_claimed: 1 } }, null,
      { owner: "production-owner", environment: "production" });
    expect(r.product_followup.contextStatus).toBe("unavailable");
    expect(r.product_followup.sourceRevision).toBeNull();
    expect(r.product_followup.issues[0].historyStatus).toBe("журнал недоступен");
    expect(query.mock.calls[1][1]).toEqual(["production-owner"]);
  });
  it("rejects another owner's row even if a malformed adapter returns it", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rowCount: 1, rows: [{ owner_key: "different-owner", state: {} }],
    });
    const r = await attachProductFollowup({ query } as any, { call_id: "current" }, null,
      { owner: "owner", environment: "production" });
    expect(r.product_followup.contextStatus).toBe("unavailable");
    expect(r.product_followup.sourceRevision).toBeNull();
  });
  it("rejects technical archive scope before any read", async () => {
    const query = vi.fn();
    const r = await attachProductFollowup({ query } as any, { call_id: "current" }, null,
      { owner: "company-archive:import", environment: "production" });
    expect(query).not.toHaveBeenCalled();
    expect(r.product_followup.contextStatus).toBe("unavailable");
  });
  it("does not guess a journal when several models match or reading fails", async () => {
    for (const response of [{ rowCount: 2, rows: [{}, {}] }, { rowCount: 0, rows: [] }]) {
      const query = vi.fn().mockRejectedValueOnce(Error("unavailable")).mockResolvedValueOnce(response);
      const r = await attachProductFollowup({ query } as any,
        { call_id: "current", deterministic: { acknowledged: 2, hints_ui_claimed: 1 } }, null,
        { owner: "owner", environment: "development" });
      expect(r.product_followup.contextStatus).toBe("unavailable");
      expect(r.product_followup.previous).toEqual([]);
      expect(r.product_followup.issues[0].tried).toEqual([]);
      expect(r.product_followup.sourceRevision).toBeNull();
    }
  });
});
