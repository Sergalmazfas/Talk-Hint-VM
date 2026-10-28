import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  query: vi.fn(), check: vi.fn(), verify: vi.fn(), admin: vi.fn(),
  bootstrap: vi.fn(),
  config: { owner: "fixture-owner", environment: "production", allowed: true },
}));
vi.mock("../db", () => ({ pool: { query: f.query } }));
vi.mock("../benchmark/adminGate", () => ({ requireBenchmarkAdmin: f.admin }));
vi.mock("./service", () => ({ labConfiguration: () => f.config, abortHintLabProcessing: vi.fn(), bootstrapLab: f.bootstrap }));
vi.mock("./process", () => ({ checkHintLabRuntime: f.check }));
vi.mock("./mail", () => ({ GmailLabMail: class { verify = f.verify; } }));
import { registerCallLabRoutes } from "./routes";

function route() {
  const post = vi.fn();
  registerCallLabRoutes({ post, get: vi.fn() } as any);
  const [, gate, handler] = post.mock.calls.find(c => c[0].endsWith("/enable"))!;
  expect(gate).toBe(f.admin);
  return handler;
}
function response() {
  const res: any = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}
beforeEach(() => {
  vi.clearAllMocks();
  f.config.allowed = true;
  f.check.mockResolvedValue({});
  f.verify.mockResolvedValue(undefined);
  f.query.mockResolvedValue({ rows: [{ connection_id: "fixture", recipient: "owner@example.invalid" }] });
});
describe("explicit private laboratory activation", () => {
  it("offers an admin-only phone page and readiness check with explicit owner binding, never activation", async () => {
    const post = vi.fn(), get = vi.fn();
    registerCallLabRoutes({ post, get } as any);
    const page = get.mock.calls.find(c => c[0] === "/api/admin/call-lab")!;
    expect(page[1]).toBe(f.admin);
    const [, gate, handler] = post.mock.calls.find(c => c[0].endsWith("/readiness"))!;
    expect(gate).toBe(f.admin);
    const res = { ...response(), set: vi.fn() } as any; res.set.mockReturnValue(res);
    await handler({ user: { id: "fixture-owner" }, body: {} }, res);
    expect(f.bootstrap).toHaveBeenCalledWith(expect.anything(), { expectedOwnerId: "fixture-owner", startup: false });
    expect(f.query.mock.calls.every(c => !c[0].includes("UPDATE"))).toBe(true);
    expect(f.verify).not.toHaveBeenCalled();
  });
  it("rejects other users without touching controls or resources", async () => {
    const res = response();
    await route()({ user: { id: "other" }, body: { confirm: "hint-owner-only" } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(f.query).not.toHaveBeenCalled();
  });
  it("requires explicit confirmation and a configured runtime", async () => {
    const res = response();
    await route()({ user: { id: "fixture-owner" }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(f.query).not.toHaveBeenCalled();
    f.config.allowed = false;
    await route()({ user: { id: "fixture-owner" }, body: { confirm: "hint-owner-only" } }, res);
    expect(res.status).toHaveBeenLastCalledWith(503);
  });
  it("checks pinned resources before activation and excludes older calls", async () => {
    const res = response();
    await route()({ user: { id: "fixture-owner" }, body: { confirm: "hint-owner-only" } }, res);
    expect(f.check).toHaveBeenCalledOnce();
    expect(f.verify).toHaveBeenCalledOnce();
    expect(f.query.mock.calls[1][0]).toContain("activated_at=CASE WHEN enabled THEN activated_at ELSE now() END");
    expect(f.query.mock.calls[1][0]).toContain("'hint-daily:' || key");
    expect(f.query.mock.calls[1][0]).toContain("ON CONFLICT(key) DO UPDATE SET enabled=true");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ noHistoricalReplay: true }));
  });
  it("does not activate when worker readiness fails", async () => {
    f.check.mockRejectedValueOnce(new Error("fixture failure"));
    const res = response();
    await route()({ user: { id: "fixture-owner" }, body: { confirm: "hint-owner-only" } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(f.query).toHaveBeenCalledTimes(1);
  });
});
