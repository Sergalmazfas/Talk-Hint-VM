import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createRequestLoggingMiddleware } from "../requestLogging";

describe("request logging privacy", () => {
  it("logs metadata for photo OCR responses without logging recognized text", async () => {
    const log = vi.fn();
    const app = express();
    app.use(createRequestLoggingMiddleware(log));
    app.post("/api/prepare/image", (_req, res) => {
      res.json({ text: "OCR_PRIVATE_NAME 42 Example Street" });
    });

    const response = await request(app).post("/api/prepare/image").send({});

    expect(response.status).toBe(200);
    const loggedOutput = log.mock.calls.map(([message]) => message).join("\n");
    expect(loggedOutput).toContain("POST /api/prepare/image 200 in ");
    expect(loggedOutput).not.toContain("OCR_PRIVATE_NAME");
    expect(loggedOutput).not.toContain("42 Example Street");
  });

  it("does not log private incoming headers for Twilio/media requests", async () => {
    const log = vi.fn();
    const app = express();
    app.use(createRequestLoggingMiddleware(log));
    app.post("/api/twilio/media", (_req, res) => res.json({ ok: true }));

    await request(app)
      .post("/api/twilio/media")
      .set("Authorization", "Bearer PRIVATE_AUTH_TOKEN");

    const loggedOutput = log.mock.calls.map(([message]) => message).join("\n");
    expect(loggedOutput).toContain("POST /api/twilio/media");
    expect(loggedOutput).not.toContain("PRIVATE_AUTH_TOKEN");
  });
});