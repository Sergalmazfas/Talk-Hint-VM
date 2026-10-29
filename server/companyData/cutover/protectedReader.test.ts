import { afterEach, describe, expect, it, vi } from "vitest";
import { PgModelRepository } from "../../projectModel/repository";
import { blocksLegacySeed, reviewedAccountBinding } from "../v3/importApproval";
import { semanticHash } from "../valueTree";
const model = () => ({ schema: 1, revision: 918, elements: [], relations: [],
  documents: [], proposals: [], taskDrafts: [], decisions: [] });
const root = () => ({ ...model(), alternatives: [{ id: "new-country", title: "Новая страна", model: model() }] });
describe("checkpoint reader under the actual protected production owner predicate", () => {
  afterEach(() => vi.unstubAllEnvs());
  function database(corrupt = false) {
    const state = root();
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("CREATE TABLE")) return { rows: [] };
      if (sql.includes("to_regclass('public.company_workspaces')"))
        return { rows: [{ company_table: null, company_v3_table: null }] };
      if (sql.includes("to_regclass('public.company_cutover_controls')")) return { rows: [{ present: "controls" }] };
      if (sql.includes("FROM company_cutover_controls")) return { rows: [
        { phase: "checkpoint", writes_open: false, checkpoint_id: "cp", workspace_id: "w" }] };
      if (sql.includes("FROM company_cutover_checkpoints")) return { rows: [
        { revision: 918, payload: state, archive_owner_key: "technical-cp",
          semantic_sha: corrupt ? "bad" : semanticHash(state) }] };
      if (sql.startsWith("WITH RECURSIVE")) return { rows: [] };
      throw new Error("Unexpected SQL; checkpoint must not seed or read another legacy row");
    });
    return { query, connect: vi.fn() };
  }
  it("keeps blocksLegacySeed TRUE yet reads the bound checkpoint without calling ensure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const owner = reviewedAccountBinding.targetOwner;
    expect(blocksLegacySeed(owner, "production")).toBe(true);
    const pool = database();
    const result = await new PgModelRepository(async () => pool as any).read(owner, "new-country");
    expect(result.revision).toBe(918);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(pool.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO talkhint_project_models"))).toBe(false);
  });
  it("refuses a corrupt checkpoint rather than seeding or falling back", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const pool = database(true);
    await expect(new PgModelRepository(async () => pool as any)
      .read(reviewedAccountBinding.targetOwner, "new-country")).rejects.toMatchObject({ status: 503 });
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
