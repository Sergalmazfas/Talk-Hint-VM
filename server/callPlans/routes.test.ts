import express from "express";
import request from "supertest";
import { describe, it, expect, vi } from "vitest";
import { registerPreparedHintPlans } from "./routes";
import { createRequestLoggingMiddleware } from "../requestLogging";

function fixture() {
  const app = express(), pending = vi.fn(async (_owner: string) => [{ id: "p", plan: { goal: "PRIVATE_GOAL" } }]);
  const logs: string[] = [];
  app.use(createRequestLoggingMiddleware(line => logs.push(line)));
  registerPreparedHintPlans(app, (req, res, next) => {
    if (req.headers.authorization !== "Bearer fixture") return res.sendStatus(401);
    (req as any).user = { id: "alice" }; next();
  }, async () => ({ pending } as any));
  return { app, pending, logs };
}
describe("read-only Prepare Hint plan endpoint", () => {
  it("requires the existing app authentication", async () => {
    const { app, pending } = fixture();
    expect((await request(app).get("/api/prepare/hint-plans")).status).toBe(401);
    expect(pending).not.toHaveBeenCalled();
  });
  it("derives the owner only from the session, disables cache and never logs content", async () => {
    const { app, pending, logs } = fixture();
    const response = await request(app).get("/api/prepare/hint-plans?userId=bob").auth("fixture", { type: "bearer" });
    expect(response.status).toBe(200);
    expect(pending).toHaveBeenCalledExactlyOnceWith("alice");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.plans[0].id).toBe("p");
    expect(response.body.serverTime).toMatch(/Z$/);
    expect(logs.join(" ")).not.toMatch(/PRIVATE_GOAL|Bearer|fixture|bob/);
  });
  it("distinguishes empty results from service failures without leaking raw errors", async () => {
    const { app, pending } = fixture();
    pending.mockResolvedValueOnce([]);
    const empty = await request(app).get("/api/prepare/hint-plans").auth("fixture", { type: "bearer" });
    expect(empty.body.plans).toEqual([]);
    pending.mockRejectedValueOnce(new Error("private database details"));
    const failed = await request(app).get("/api/prepare/hint-plans").auth("fixture", { type: "bearer" });
    expect(failed.status).toBe(503);
    expect(failed.text).not.toContain("private database details");
  });
});
