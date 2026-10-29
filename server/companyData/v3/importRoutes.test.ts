import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
vi.mock("../../benchmark/adminGate", () => ({
  requireBenchmarkAdmin: (req: any, res: any, next: any) =>
    req.get("x-admin") === "yes" ? next() : res.sendStatus(403),
}));
import { importLines, registerCompanyImport } from "./importRoutes";
import { semanticHash, textHash } from "../valueTree";
import { ddlV3 } from "./schema";
import type { ImportApproval } from "./importApproval";

const manifest = { schemaVersion: 3, schemaDigest: textHash(ddlV3()), sourceOwner: "dev-owner",
  sourceEnvironment: "development", sourceWorkspace: "accepted-shadow-B", revision: 912,
  rootHash: "a".repeat(64), semanticHash: "b".repeat(64), recordCount: 1, recordsDigest: "c".repeat(64) };
const approval: ImportApproval = { confirmed: true, importApproved: true, targetOwner: "owner",
  targetEnvironment: "development", sourceOwner: "dev-owner", sourceEnvironment: "development",
  sourceWorkspace: manifest.sourceWorkspace, revision: 912, manifestHash: semanticHash(manifest) };
const csrfToken = "d".repeat(64), base = "/api/admin/company-import";
describe("candidate import HTTP security (synthetic only)", () => {
  let app: express.Express;
  const grant = vi.fn(), consume = vi.fn(), getPool = vi.fn();
  function setup(policy: ImportApproval | null = approval, env: "development" | "production" = "development") {
    app = express(); app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = req.get("x-user") ? { id: req.get("x-user") } : undefined;
      req.isAuthenticated = () => !!req.user && req.get("x-session") === "yes";
      req.session = req.get("x-session") === "yes" ? { companyImportCsrf: csrfToken } : undefined;
      next();
    });
    registerCompanyImport(app, getPool, { approval: policy, environment: env,
      service: { grant, consume } as any });
  }
  const post = (path: string, user = "owner", csrf = csrfToken, session = true) =>
    request(app).post(`${base}/${path}`).set("x-admin", "yes").set("x-user", user)
      .set("x-session", session ? "yes" : "no").set("x-company-csrf", csrf)
      .set("Origin", "http://127.0.0.1").set("Host", "127.0.0.1");
  beforeEach(() => {
    vi.clearAllMocks(); setup();
    grant.mockResolvedValue("e".repeat(64));
    consume.mockImplementation(async (_auth, _token, _m, records, active) => {
      const rows = []; for await (const row of records) rows.push(row);
      return { imported: rows.length, activated: active };
    });
  });
  it("defaults to locked; Publish alone never authorizes an import", async () => {
    setup(null);
    expect((await post("grant").send({ manifest })).status).toBe(423);
    expect(grant).not.toHaveBeenCalled();
  });
  it("rejects non-admin, wrong session owner, bearer-only and wrong environment", async () => {
    expect((await request(app).post(`${base}/grant`).send({ manifest })).status).toBe(403);
    expect((await post("grant", "other").send({ manifest })).status).toBe(403);
    expect((await post("grant", "owner", csrfToken, false).set("Authorization", "Bearer ignored")
      .send({ manifest })).status).toBe(401);
    setup(approval, "production");
    expect((await post("grant").send({ manifest })).status).toBe(403);
  });
  it("requires both same-origin and session CSRF; rejects spoofed owner and activation", async () => {
    expect((await post("grant", "owner", "bad").send({ manifest })).status).toBe(403);
    expect((await post("grant").set("Origin", "https://evil.test").send({ manifest })).status).toBe(403);
    expect((await post("grant").send({ manifest, owner: "owner" })).status).toBe(409);
    expect((await post("grant").send({ manifest, activate: true })).status).toBe(409);
    expect(grant).not.toHaveBeenCalled();
  });
  it("binds the exact fresh manifest, not a B2 test, changed revision or swapped package", async () => {
    for (const patch of [{ revision: 913 }, { sourceWorkspace: "B2-test" },
      { sourceEnvironment: "production" }, { semanticHash: "f".repeat(64) },
      { sourceOwner: "other" }]) {
      expect((await post("grant").send({ manifest: { ...manifest, ...patch } })).status).toBe(409);
    }
    expect(grant).not.toHaveBeenCalled();
  });
  it("grants at most ten minutes for the authenticated target; never body fields", async () => {
    expect((await post("grant").send({ manifest })).status).toBe(201);
    expect(grant).toHaveBeenCalledWith({ ownerKey: "owner", isOwner: true, csrfVerified: true },
      manifest, "owner", 600_000);
    expect(getPool).not.toHaveBeenCalled();
  });
  it("streams records and hardcodes no activation, without full-buffer parsing", async () => {
    const body = JSON.stringify({ manifest }) + "\n" +
      JSON.stringify({ table: "company_v3_frames", row: { workspace_id: manifest.sourceWorkspace } }) + "\n";
    const r = await post("consume").set("Content-Type", "application/x-ndjson")
      .set("x-company-import-grant", "e".repeat(64)).send(body);
    expect(r.status).toBe(200); expect(r.body).toEqual({ imported: 1, activated: false });
    expect(consume).toHaveBeenCalledTimes(1);
  });
  it("does not expose storage errors, credentials or request contents", async () => {
    grant.mockRejectedValueOnce(new Error("PRIVATE_TOKEN_SQL"));
    const r = await post("grant").send({ manifest });
    expect(r.status).toBe(409); expect(JSON.stringify(r.body)).not.toContain("PRIVATE_TOKEN");
  });
  it("parser preserves split UTF8, rejects malformed/truncated and oversized lines", async () => {
    async function* chunks(b: Buffer) { for (let i = 0; i < b.length; i++) yield b.subarray(i, i + 1); }
    const rows = [];
    for await (const row of importLines(chunks(Buffer.from('{"text":"😀"}\n')))) rows.push(row);
    expect(rows).toEqual([{ text: "😀" }]);
    async function drain(input: AsyncIterable<Buffer>) { for await (const _ of importLines(input)) { /* consume */ } }
    await expect(drain(chunks(Buffer.from('{"bad":')))).rejects.toThrow();
    async function* big() { yield Buffer.alloc(20 * 1024 * 1024 + 1, 32); }
    await expect(drain(big())).rejects.toThrow("line limit");
  });
});
