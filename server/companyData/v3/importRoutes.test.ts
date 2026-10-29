import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../benchmark/adminGate", () => ({
  requireBenchmarkAdmin: (req: any, res: any, next: any) => req.get("x-admin") === "yes" ? next() : res.sendStatus(403),
}));
import { importLines, registerCompanyImport } from "./importRoutes";
import { reviewedAccountBinding as binding, type ImportApproval } from "./importApproval";
import { semanticHash, textHash } from "../valueTree";
import { ddlV3 } from "./schema";
import type { ReviewedPackage } from "./reviewedPackage";

const manifest = { schemaVersion: 3 as const, schemaDigest: textHash(ddlV3()), sourceOwner: binding.sourceOwner,
  sourceEnvironment: "development", sourceWorkspace: "fresh-encoder-not-B2", revision: 912,
  sourceBWorkspace: binding.sourceBWorkspace, scope: "new-country" as const,
  rootHash: "a".repeat(64), semanticHash: "b".repeat(64), recordCount: 1, recordsDigest: "c".repeat(64) };
const pin: ReviewedPackage = {manifest, manifestHash: semanticHash(manifest),
  objectName: "private/fixed.ndjson", fileSha256: "f".repeat(64), ndjsonBytes: 1000,
  maximumLineBytes: 1000, documentCount: 84, archiveCount: 242};
const approval: ImportApproval = {confirmed: true, importApproved: true, targetOwner: binding.targetOwner,
  targetEnvironment: "production", sourceOwner: binding.sourceOwner, sourceEnvironment: "development",
  sourceWorkspace: manifest.sourceWorkspace, revision: 912, manifestHash: pin.manifestHash};
const csrfToken = "d".repeat(64), base = "/api/admin/company-import";
describe("one-button import HTTP security (synthetic services only)", () => {
  let app: express.Express;
  const grant = vi.fn(), consume = vi.fn(), status = vi.fn(), getPool = vi.fn(), openRecords = vi.fn();
  function setup(policy: ImportApproval | null = approval, env: "development" | "production" = "production",
    packagePin: ReviewedPackage | null = pin) {
    app = express(); app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = req.get("x-user") ? {id: req.get("x-user")} : undefined;
      req.isAuthenticated = () => !!req.user && req.get("x-session") === "yes";
      req.session = req.get("x-session") === "yes" ? {companyImportCsrf: csrfToken} : undefined;
      next();
    });
    registerCompanyImport(app, getPool, {approval: policy, environment: env, package: packagePin,
      service: {grant, consume, status} as any, openRecords});
  }
  const headers = (r: any, owner = binding.targetOwner, session = true) =>
    r.set("x-admin", "yes").set("x-user", owner).set("x-session", session ? "yes" : "no")
      .set("x-company-csrf", csrfToken).set("Origin", "http://127.0.0.1").set("Host", "127.0.0.1");
  const post = (owner = binding.targetOwner) => headers(request(app).post(`${base}/start`), owner);
  const body = () => ({confirm: true, manifestHash: pin.manifestHash});
  beforeEach(() => {
    vi.resetAllMocks(); setup();
    status.mockResolvedValue({state: "empty", activated: false});
    grant.mockResolvedValue("e".repeat(64));
    openRecords.mockImplementation(async function* () { yield {table: "company_v3_frames", row: {}}; });
    consume.mockImplementation(async (_auth, _token, _m, records, active) => {
      for await (const _ of records) { /* drain private stream */ }
      status.mockResolvedValue({state: "imported_shadow", activated: false});
      return {activated: active};
    });
  });
  it("Publish remains locked even with a confirmed pair and pinned source", async () => {
    setup(null);
    const r = await headers(request(app).get(`${base}/status`));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({bindingConfirmed: true, scope: "new-country",
      importApproved: false, readiness: "awaiting_owner_approval", activated: false});
    expect((await post().send(body())).status).toBe(423);
    expect(status).not.toHaveBeenCalled(); expect(getPool).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled(); expect(openRecords).not.toHaveBeenCalled();
  });
  it("rejects non-admin, wrong owner, bearer-only session and wrong environment", async () => {
    expect((await request(app).post(`${base}/start`).send(body())).status).toBe(403);
    expect((await post("other").send(body())).status).toBe(403);
    expect((await headers(request(app).post(`${base}/start`), binding.targetOwner, false)
      .set("Authorization", "Bearer ignored").send(body())).status).toBe(401);
    setup(approval, "development");
    expect((await post().send(body())).status).toBe(403);
    expect(grant).not.toHaveBeenCalled();
  });
  it("requires CSRF, same-origin and literal confirmation of the exact pinned manifest", async () => {
    expect((await post().set("x-company-csrf", "bad").send(body())).status).toBe(403);
    expect((await post().set("Origin", "https://evil.test").send(body())).status).toBe(403);
    for (const patch of [{confirm: false}, {manifestHash: "0".repeat(64)},
      {owner: "other"}, {activate: true}, {objectName: "other.ndjson"}, {url: "https://evil.test"}])
      expect((await post().send({...body(), ...patch})).status).toBe(409);
    expect(grant).not.toHaveBeenCalled();
  });
  it("has no upload/grant/consume HTTP routes", async () => {
    for (const path of ["grant", "consume", "activate"])
      expect((await headers(request(app).post(`${base}/${path}`)).send({manifest})).status).toBe(404);
    expect(openRecords).not.toHaveBeenCalled();
  });
  it("refuses absent or unreviewed packages without DB/storage access", async () => {
    setup(approval, "production", {...pin, manifest: {...manifest, revision: 913}});
    expect((await post().send(body())).status).toBe(423);
    setup(approval, "production", null);
    expect((await post().send(body())).status).toBe(423);
    expect(getPool).not.toHaveBeenCalled(); expect(openRecords).not.toHaveBeenCalled();
  });
  it("one confirmation obtains a private ten-minute grant and consumes only server-fetched records", async () => {
    const r = await post().send(body());
    expect(r.status).toBe(202);
    expect(r.body).toEqual({state: "running", activated: false});
    expect(JSON.stringify(r.body)).not.toContain("e".repeat(64));
    expect(grant).toHaveBeenCalledWith({ownerKey: binding.targetOwner, isOwner: true, csrfVerified: true},
      manifest, binding.targetOwner, 600_000);
    expect(openRecords).toHaveBeenCalledWith(pin);
    expect(consume).toHaveBeenCalledWith(expect.anything(), "e".repeat(64), manifest, expect.anything(), false);
    expect((await headers(request(app).get(`${base}/status`))).body.readiness).toBe("imported_shadow");
    expect((await post().send(body())).status).toBe(409); // no replay
  });
  it("does not retry an uncertain durable result, disclose errors or open storage", async () => {
    status.mockResolvedValue({state: "uncertain", activated: false});
    expect((await post().send(body())).status).toBe(409);
    expect(grant).not.toHaveBeenCalled(); expect(openRecords).not.toHaveBeenCalled();
    expect((await headers(request(app).get(`${base}/status`))).body.readiness).toBe("uncertain");
    status.mockRejectedValue(new Error("PRIVATE_SQL_TOKEN"));
    const r = await headers(request(app).get(`${base}/status`));
    expect(r.status).toBe(409); expect(JSON.stringify(r.body)).not.toContain("PRIVATE_SQL_TOKEN");
  });
  it("parser preserves split UTF8, rejects malformed and oversized lines", async () => {
    async function* chunks(b: Buffer) { for (let i = 0; i < b.length; i++) yield b.subarray(i, i + 1); }
    const rows = [];
    for await (const row of importLines(chunks(Buffer.from('{"text":"😀"}\n')))) rows.push(row);
    expect(rows).toEqual([{text: "😀"}]);
    async function drain(input: AsyncIterable<Buffer>) { for await (const _ of importLines(input)) { /* consume */ } }
    await expect(drain(chunks(Buffer.from('{"bad":')))).rejects.toThrow();
    async function* big() { yield Buffer.alloc(20 * 1024 * 1024 + 1, 32); }
    await expect(drain(big())).rejects.toThrow("line limit");
  });
});
