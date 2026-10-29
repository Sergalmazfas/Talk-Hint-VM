import { describe, expect, it, vi } from "vitest";
import { checkpointDocument, lockCompanyWrite } from "./guard";
import { semanticHash } from "../valueTree";
import { reviewedAccountBinding } from "../v3/importApproval";
describe("durable cutover guard and owner checkpoint", () => {
  const control = (extra = {}) => ({ phase: "verifying", writes_open: false,
    checkpoint_id: "cp", workspace_id: "w", ...extra });
  function db(c: any, doc: any = null) {
    return { query: vi.fn(async (sql: string) =>
      sql.includes("to_regclass") ? { rows: [{ present: "company_cutover_controls" }] } :
      sql.includes("FROM company_cutover_controls") ? { rows: c ? [c] : [] } :
      sql.includes("checkpoint_documents") ? { rows: doc ? [doc] : [] } : { rows: [] }) };
  }
  it("blocks before, during and after failed/reversed activation, survives a new guard invocation", async () => {
    for (const phase of ["shadow", "verifying", "checkpoint"]) {
      const mock = db(control({ phase }));
      await expect(lockCompanyWrite(mock as any, "o", "production")).rejects.toMatchObject({ status: 423 });
      await expect(lockCompanyWrite(mock as any, "o", "production")).rejects.toMatchObject({ status: 423 });
      expect(mock.query.mock.calls[0][0]).toContain("pg_advisory_xact_lock_shared");
    }
  });
  it("opens ONLY explicit active writes; protects production owner before a control row exists", async () => {
    await expect(lockCompanyWrite(db(control({ phase: "active", writes_open: true })) as any, "o", "production"))
      .resolves.toBeUndefined();
    await expect(lockCompanyWrite(db(null) as any, reviewedAccountBinding.targetOwner, "production"))
      .rejects.toMatchObject({ status: 423 });
    await expect(lockCompanyWrite(db(null) as any, "ordinary-other-owner", "production")).resolves.toBeUndefined();
  });
  it("binds document to owner/environment/workspace and verifies its digest, no JSON fallback", async () => {
    const document = { id: "D", text: "Журнал 😀" };
    const mock = db(control({ phase: "checkpoint" }), { revision: "915", document, document_sha: semanticHash(document) });
    expect(await checkpointDocument(mock as any, "owner", "production", "new-country", "D"))
      .toEqual({ revision: 915, document });
    expect(mock.query.mock.calls.at(-1)?.[1]).toEqual(["cp", "owner", "production", "w", "new-country", "D"]);
    await expect(checkpointDocument(db(control({ phase: "checkpoint" }),
      { revision: 1, document, document_sha: "bad" }) as any, "owner", "production", "new-country", "D"))
      .rejects.toMatchObject({ status: 503 });
  });
});
