import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../benchmark/adminGate", () => ({
  requireBenchmarkAdmin: (req: any, res: any, next: any) => req.get("x-admin") === "yes" ? next() : res.sendStatus(403),
}));
import { registerCompanyCutover } from "./routes";
import { cutoverCandidate, reviewedCutoverApproval } from "./policy";

const base = "/api/admin/company-cutover", csrf = "d".repeat(64);
const source = { workspace: cutoverCandidate.workspace, revision: 912,
  rootHash: cutoverCandidate.rootHash, manifestHash: cutoverCandidate.manifestHash };
describe("cutover browser boundaries", () => {
  let app: express.Express;
  const service = { status: vi.fn(), grant: vi.fn(), enqueue: vi.fn(), fail: vi.fn() }, launch = vi.fn();
  function setup(approved = true) {
    app = express(); app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = req.get("x-user") ? { id: req.get("x-user") } : undefined;
      req.isAuthenticated = () => !!req.user && req.get("x-session") === "yes";
      req.session = req.get("x-session") === "yes" ? { companyCutoverCsrf: csrf } : undefined;
      next();
    });
    registerCompanyCutover(app, vi.fn(), { environment: "production",
      approval: approved ? cutoverCandidate : null, service: service as any, launch });
  }
  const headers = (r: any) => r.set("x-admin", "yes").set("x-user", cutoverCandidate.owner)
    .set("x-session", "yes").set("x-company-csrf", csrf)
    .set("Host", "127.0.0.1").set("Origin", "http://127.0.0.1");
  const body = () => ({ action: "activate", confirm: true, expected: source });
  beforeEach(() => {
    vi.resetAllMocks(); setup();
    service.status.mockResolvedValue({ source, phase: "shadow", writesOpen: false });
    service.grant.mockResolvedValue("e".repeat(64)); service.enqueue.mockResolvedValue("op");
    launch.mockResolvedValue(undefined); service.fail.mockResolvedValue(undefined);
  });
  it("ships with NO production approval; GET is read-only and action GET is 405", async () => {
    expect(reviewedCutoverApproval).toBeNull(); setup(false);
    expect((await headers(request(app).get(base + "/status"))).status).toBe(200);
    expect((await headers(request(app).get(base + "/grant"))).status).toBe(405);
    expect((await headers(request(app).post(base + "/grant")).send(body())).status).toBe(423);
    expect(service.grant).not.toHaveBeenCalled(); expect(service.enqueue).not.toHaveBeenCalled();
  });
  it("rejects anonymous/non-admin/wrong owner and bearer-only identity", async () => {
    expect((await request(app).get(base + "/status")).status).toBe(403);
    expect((await headers(request(app).get(base + "/status")).set("x-user", "other")).status).toBe(403);
    expect((await headers(request(app).get(base + "/status")).set("x-session", "no")
      .set("Authorization", "Bearer example")).status).toBe(401);
    expect((await headers(request(app).get(base + "/status"))
      .set("Authorization", "Bearer example")).status).toBe(403);
  });
  it("requires CSRF AND literal same-origin, even with a bearer header", async () => {
    expect((await headers(request(app).post(base + "/grant")).set("x-company-csrf", "a").send(body())).status).toBe(403);
    expect((await headers(request(app).post(base + "/grant")).set("Origin", "https://evil.test").send(body())).status).toBe(403);
    expect((await headers(request(app).post(base + "/grant")).unset("Origin")
      .set("Authorization", "Bearer example").send(body())).status).toBe(403);
    expect(service.grant).not.toHaveBeenCalled();
  });
  it("does not accept arbitrary commands, documents, owner fields or partial pins", async () => {
    for (const patch of [{ confirm: false }, { owner: "other" }, { command: "edit" },
      { action: "delete" }, { expected: { ...source, url: "https://evil.test" } },
      { expected: { ...source, rootHash: "bad" } }])
      expect((await headers(request(app).post(base + "/grant")).send({ ...body(), ...patch })).status).toBe(400);
    expect(service.grant).not.toHaveBeenCalled();
  });
  it("grant alone does not switch; execute queues exactly one operation", async () => {
    expect((await headers(request(app).post(base + "/grant")).send(body())).body.grant).toBe("e".repeat(64));
    expect(service.enqueue).not.toHaveBeenCalled(); expect(launch).not.toHaveBeenCalled();
    const r = await headers(request(app).post(base + "/execute")).send({ ...body(), grant: "e".repeat(64) });
    expect(r.status).toBe(202); expect(service.enqueue).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith("op");
  });
  it("no public retries/resume/upload endpoint", async () => {
    for (const p of ["resume", "upload", "seed"])
      expect((await headers(request(app).post(base + "/" + p)).send(body())).status).toBe(404);
  });
});
