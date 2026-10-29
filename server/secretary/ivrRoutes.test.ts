import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  press: vi.fn(async () => ({ ok: true, sent: true })),
  status: vi.fn(() => ({ active: true, waiting: true, menu: "For tires press 2.", menuHash: "hash" })),
  owner: vi.fn(),
}));
vi.mock("../auth", () => ({ authMiddleware: (req: any, res: any, next: any) => {
  if (!req.get("authorization")) return res.sendStatus(401);
  req.user = { id: req.get("authorization") }; next();
} }));
vi.mock("../db", () => ({ db: {} }));
vi.mock("./ivrPhone", () => ({ ownerIvr: mock.owner }));
import { registerSecretaryIvrRoutes } from "./ivrRoutes";
function app() { const a = express(); a.use(express.json()); registerSecretaryIvrRoutes(a); return a; }
const path = "/api/secretary/tasks/task/ivr";
beforeEach(() => {
  vi.clearAllMocks();
  mock.owner.mockImplementation(async (id: string, owner: string) => {
    if (owner !== "alice" || id !== "task") throw Error("Owner mismatch");
    return { press: mock.press, status: mock.status };
  });
});
describe("Secretary IVR owner browser actions", () => {
  it("requires owner authentication and denies a different owner", async () => {
    expect((await request(app()).get(path)).status).toBe(401);
    expect((await request(app()).get(path).set("Authorization", "bob")).status).toBe(404);
    expect(mock.press).not.toHaveBeenCalled();
  });
  it("renders a phone-friendly action form without injecting menu text into HTML", async () => {
    const response = await request(app()).get(path).set("Authorization", "alice");
    expect(response.status).toBe(200); expect(response.text).toContain('id="digits"');
    expect(response.text).toContain("textContent=current.menu");
    expect(response.headers["cache-control"]).toBe("no-store");
    const status = await request(app()).get(path + "?format=json").set("Authorization", "alice");
    expect(status.body.waiting).toBe(true);
  });
  it.each([undefined, "https://evil.example"])("rejects CSRF origin %s", async origin => {
    let r = request(app()).post(path).set("Host", "talkhint.app").set("Authorization", "alice").set("x-secretary-menu", "1");
    if (origin) r = r.set("Origin", origin);
    expect((await r.send({ digits: "2", menuHash: "hash" })).status).toBe(403);
    expect(mock.press).not.toHaveBeenCalled();
  });
  it("requires custom same-origin header and strictly scoped body", async () => {
    expect((await request(app()).post(path).set("Host", "talkhint.app").set("Origin", "https://talkhint.app")
      .set("Authorization", "alice").send({ digits: "2", menuHash: "hash" })).status).toBe(403);
    expect((await request(app()).post(path).set("Host", "talkhint.app").set("Origin", "https://talkhint.app")
      .set("Authorization", "alice").set("x-secretary-menu", "1")
      .send({ digits: "2", menuHash: "hash", userId: "bob" })).status).toBe(400);
  });
  it("forwards only the authenticated owner's digit and current menu hash", async () => {
    const response = await request(app()).post(path).set("Host", "talkhint.app").set("Origin", "https://talkhint.app")
      .set("Authorization", "alice").set("x-secretary-menu", "1").send({ digits: "2", menuHash: "hash" });
    expect(response.status).toBe(200);
    expect(mock.owner).toHaveBeenCalledWith("task", "alice");
    expect(mock.press).toHaveBeenCalledWith("2", "hash", expect.any(AbortSignal), true);
  });
});
