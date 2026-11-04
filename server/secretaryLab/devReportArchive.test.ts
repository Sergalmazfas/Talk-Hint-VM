import { afterEach, expect, it, vi } from "vitest";
import { DEV_REPORT_DDL, DevReportArchive } from "./devReportArchive";
const env = () => { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "0"); };
afterEach(() => vi.unstubAllEnvs());
it("creates only a guarded Dev table; upsert/read/list are owner scoped, without TTL or deletes", async () => {
  env(); const query = vi.fn().mockResolvedValue({ rows: [{ id: "id", report: { id: "id" } }] });
  const a = new DevReportArchive({ query } as any, true);
  await a.save("owner", { id: "id", metrics: { secretaryTurns: 9 }, engine: { access_token: "must disappear" } } as any);
  await a.get("owner", "id"); await a.list("owner");
  expect(query.mock.calls[0][0]).toBe(DEV_REPORT_DDL);
  expect(query.mock.calls[1][1].slice(0, 2)).toEqual(["id", "owner"]);
  expect(query.mock.calls[1][1][2]).not.toContain("must disappear");
  expect(JSON.parse(query.mock.calls[1][1][2]).metrics.secretaryTurns).toBe(9);
  expect(query.mock.calls[2][1]).toEqual(["owner", "id"]);
  expect(query.mock.calls[3][1]).toEqual(["owner"]);
  expect(query.mock.calls.map(c => c[0]).join(" ")).not.toMatch(/expires|DELETE|DROP|TRUNCATE/);
  expect(query.mock.calls[1][0]).toContain("owner_id=EXCLUDED.owner_id");
});
it("production/deployed/non-Dev database refuse even initialization", async () => {
  const query = vi.fn(); env();
  await expect(new DevReportArchive({ query } as any, false).list("owner")).rejects.toThrow("DEV_ONLY");
  vi.stubEnv("NODE_ENV", "production");
  await expect(new DevReportArchive({ query } as any, true).get("owner", "id")).rejects.toThrow("DEV_ONLY");
  env(); vi.stubEnv("REPLIT_DEPLOYMENT", "1");
  await expect(new DevReportArchive({ query } as any, true).list("owner")).rejects.toThrow("DEV_ONLY");
  expect(query).not.toHaveBeenCalled();
});
it("reports foreign-ID conflict and retries SQL initialization after failure", async () => {
  env(); const query = vi.fn().mockRejectedValueOnce(Error("db unavailable"))
    .mockResolvedValue({ rows: [] });
  const a = new DevReportArchive({ query } as any, true);
  await expect(a.save("owner", { id: "id" } as any)).rejects.toThrow("db unavailable");
  await expect(a.save("owner", { id: "id" } as any)).rejects.toThrow("OWNER_CONFLICT");
  expect(query.mock.calls[1][0]).toBe(DEV_REPORT_DDL);
});
