import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  createSecretaryTask: vi.fn(),
  listSecretaryTasks: vi.fn(),
  cancelSecretaryTask: vi.fn(),
  retrySecretaryTask: vi.fn(),
  startSecretaryWorker: vi.fn(),
}));

vi.mock("../../auth", () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    const userId = req.header("x-test-user-id");
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    req.user = { id: userId };
    next();
  },
}));

vi.mock("../../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: "assigned-number" }],
        }),
      }),
    }),
  },
  isDatabaseAvailable: () => true,
}));
vi.mock("../../voiceLab/store", () => ({
  getClone: async () => ({ status: "ready", voiceId: "test-voice" }),
  getCartesiaClone: async () => ({ status: "ready", voiceId: "test-voice" }),
}));
vi.mock("../../translation/cloneSpeech", () => ({
  requireReadyTranslatorClone: () => "test-voice",
}));

vi.mock("../tasks", async () => {
  const actual = await vi.importActual<typeof import("../tasks")>("../tasks");
  return {
    ...actual,
    ...mocks,
  };
});

import { registerSecretaryRoutes } from "../routes";
import { signSecretaryConfirmation } from "../confirmation";

const task = {
  id: "task-1",
  userId: "owner-a",
  phoneNumber: "+19545551234",
  instruction: "Ask about the returned deposit.",
  voiceProvider: "elevenlabs",
  status: "queued",
  outcome: null,
  summary: null,
  verifiedFacts: [],
  nextStep: null,
  transcript: "",
  callSid: null,
  callId: null,
  attempts: 0,
  attemptHistory: [],
  dialStartedAt: null,
  notificationStatus: "pending",
  notificationClaimedAt: null,
  notifiedAt: null,
  createdAt: new Date("2026-05-21T18:00:00.000Z"),
  updatedAt: new Date("2026-05-21T18:00:00.000Z"),
} as any;

function app() {
  const server = express();
  server.use(express.json());
  registerSecretaryRoutes(server as any, {
    dial: vi.fn(),
    notify: vi.fn(),
  });
  return server;
}

describe("Secretary owner-scoped routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-secret";
    process.env.OPENAI_API_KEY = "test-openai-key";
    mocks.createSecretaryTask.mockResolvedValue(task);
    mocks.listSecretaryTasks.mockResolvedValue([task]);
    mocks.cancelSecretaryTask.mockResolvedValue(task);
    mocks.retrySecretaryTask.mockResolvedValue(task);
  });

  it("requires authentication before listing tasks", async () => {
    const response = await request(app()).get("/api/secretary/tasks");
    expect(response.status).toBe(401);
    expect(mocks.listSecretaryTasks).not.toHaveBeenCalled();
  });

  it("lists only the authenticated owner's tasks", async () => {
    const response = await request(app())
      .get("/api/secretary/tasks")
      .set("x-test-user-id", "owner-a");
    expect(response.status).toBe(200);
    expect(response.body.tasks[0].id).toBe("task-1");
    expect(mocks.listSecretaryTasks).toHaveBeenCalledWith("owner-a");
  });

  it("binds task creation to the authenticated owner, never a body-supplied user id", async () => {
    const response = await request(app())
      .post("/api/secretary/tasks")
      .set("x-test-user-id", "owner-a")
      .send({
        userId: "owner-b",
        phoneNumber: "+19545551234",
        instruction: "Ask about the returned deposit.",
        voiceProvider: "cartesia",
        confirmationToken: signSecretaryConfirmation("owner-a", "Ask about the returned deposit."),
      });
    expect(response.status).toBe(201);
    expect(mocks.createSecretaryTask).toHaveBeenCalledWith("owner-a", {
      phoneNumber: "+19545551234",
      instruction: "Ask about the returned deposit.",
      voiceProvider: "cartesia",
    });
  });

  it("refuses to queue a call without the owner's confirmed Prepare assignment", async () => {
    const response = await request(app()).post("/api/secretary/tasks")
      .set("x-test-user-id", "owner-b")
      .send({
        phoneNumber: "+19545551234",
        instruction: "Ask about the returned deposit.",
        confirmationToken: signSecretaryConfirmation("owner-a", "Ask about the returned deposit."),
      });
    expect(response.status).toBe(403);
    expect(mocks.createSecretaryTask).not.toHaveBeenCalled();
  });

  it("passes the authenticated owner to cancel and retry operations", async () => {
    const server = app();
    const cancel = await request(server).post("/api/secretary/tasks/task-1/cancel")
      .set("x-test-user-id", "owner-a");
    const retry = await request(server).post("/api/secretary/tasks/task-1/retry")
      .set("x-test-user-id", "owner-a");
    expect(cancel.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(mocks.cancelSecretaryTask).toHaveBeenCalledWith("owner-a", "task-1");
    expect(mocks.retrySecretaryTask).toHaveBeenCalledWith("owner-a", "task-1");
  });

  it("does not reveal another owner's task when cancellation misses", async () => {
    mocks.cancelSecretaryTask.mockResolvedValue(undefined);
    mocks.listSecretaryTasks.mockResolvedValue([]);
    const response = await request(app())
      .post("/api/secretary/tasks/task-1/cancel")
      .set("x-test-user-id", "owner-b");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Secretary task not found.");
  });
});