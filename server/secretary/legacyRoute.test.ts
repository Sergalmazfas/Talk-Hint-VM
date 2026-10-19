import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { registerLegacyTestCallRoute } from "./legacyRoute";
vi.mock("../auth", () => ({ authMiddleware: (req: any, res: any, next: any) => {
  if (!req.header("x-test-owner")) return res.sendStatus(401);
  next();
} }));
describe("retired legacy test dialer", () => {
  it("returns 401 anonymously and 410 for owners without any provider call", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
    try {
      const app = express();
      app.use(express.json());
      registerLegacyTestCallRoute(app);
      expect((await request(app).post("/start-call").send({ target: "+12025550123" })).status).toBe(401);
      expect((await request(app).post("/start-call").set("x-test-owner", "alice").send({ target: "+12025550123" })).status).toBe(410);
      expect(network).not.toHaveBeenCalled();
      const source = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
      expect(source).toContain("registerLegacyTestCallRoute(app)");
      expect(source).not.toContain('app.post("/start-call"');
    } finally { network.mockRestore(); }
  });
});
