import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  createSecretaryTask: vi.fn(),
  createLiveSecretaryTask: vi.fn(),
  attachSecretaryCall: vi.fn(),
  getSecretaryTaskById: vi.fn(),
  getLiveSecretaryTaskByClientRequest: vi.fn(),
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
vi.mock("../dialer", () => ({
  hangupSecretaryCall: vi.fn(),
}));

import { registerSecretaryRoutes } from "../routes";
import { hangupSecretaryCall } from "../dialer";
import { signSecretaryConfirmation } from "../confirmation";

const task = {
  id: "task-1",
  clientRequestId: "810f8906-4b66-4fee-9c41-2d21f41703b1",
  userId: "owner-a",
  phoneNumber: "+19545551234",
  instruction: "Ask about the returned deposit.",
  voiceProvider: "elevenlabs",
  status: "queued",
  mode: "queued",
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
    mocks.createLiveSecretaryTask.mockResolvedValue({ task: { ...task, mode: "live", status: "starting", attempts: 1 }, created: true });
    mocks.getLiveSecretaryTaskByClientRequest.mockResolvedValue(undefined);
    mocks.attachSecretaryCall.mockResolvedValue({ ...task, mode: "live", status: "ringing", attempts: 1, callSid: "CA0123456789abcdef0123456789abcdef" });
    mocks.getSecretaryTaskById.mockResolvedValue({ ...task, userId: "owner-a", mode: "live", status: "connected", callSid: "CA0123456789abcdef0123456789abcdef" });
    (hangupSecretaryCall as any).mockResolvedValue(undefined);
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

  it("creates and dials a live task exactly once immediately", async () => {
    const dial = vi.fn().mockResolvedValue({ sid: "CA0123456789abcdef0123456789abcdef", callId: "call-1" });
    const server = express();
    server.use(express.json());
    registerSecretaryRoutes(server as any, { dial, notify: vi.fn() });
    const response = await request(server).post("/api/secretary/tasks").set("x-test-user-id", "owner-a").send({
      phoneNumber: "+19545551234",
      instruction: "Ask about the returned deposit.",
      live: true,
      clientRequestId: "810f8906-4b66-4fee-9c41-2d21f41703b1",
      confirmationToken: signSecretaryConfirmation("owner-a", "Ask about the returned deposit."),
    });
    expect(response.status).toBe(201);
    expect(response.body.task.mode).toBe("live");
    expect(mocks.createLiveSecretaryTask).toHaveBeenCalledOnce();
    expect(mocks.createSecretaryTask).not.toHaveBeenCalled();
    expect(dial).toHaveBeenCalledOnce();
    expect(mocks.attachSecretaryCall).toHaveBeenCalledWith("task-1", "CA0123456789abcdef0123456789abcdef", "call-1");
  });

  it("does not retry a live call after an ambiguous create failure", async () => {
    const dial = vi.fn().mockRejectedValue(new Error("network timeout"));
    const server = express();
    server.use(express.json());
    registerSecretaryRoutes(server as any, { dial, notify: vi.fn() });
    const response = await request(server).post("/api/secretary/tasks").set("x-test-user-id", "owner-a").send({
      phoneNumber: "+19545551234",
      instruction: "Ask about the returned deposit.",
      live: true,
      clientRequestId: "810f8906-4b66-4fee-9c41-2d21f41703b1",
      confirmationToken: signSecretaryConfirmation("owner-a", "Ask about the returned deposit."),
    });
    expect(response.status).toBe(202);
    expect(response.body.task.mode).toBe("live");
    expect(dial).toHaveBeenCalledOnce();
    expect(mocks.attachSecretaryCall).not.toHaveBeenCalled();
    mocks.getLiveSecretaryTaskByClientRequest.mockResolvedValue({
      ...task, mode: "live", status: "starting", attempts: 1,
    });
    const repeated = await request(server).post("/api/secretary/tasks")
      .set("x-test-user-id", "owner-a")
      .send({
        phoneNumber: "+19545551234",
        instruction: "Ask about the returned deposit.",
        live: true,
        clientRequestId: "810f8906-4b66-4fee-9c41-2d21f41703b1",
        confirmationToken: signSecretaryConfirmation("owner-a", "Ask about the returned deposit."),
      });
    expect(repeated.status).toBe(200);
    expect(repeated.body.task.status).toBe("starting");
    expect(dial).toHaveBeenCalledOnce();
  });

  it("requires a client request UUID and reuses an existing request without dialing", async () => {
    const server = express();
    server.use(express.json());
    const dial = vi.fn();
    registerSecretaryRoutes(server as any, { dial, notify: vi.fn() });
    const body = {
      phoneNumber: "+19545551234",
      instruction: "Ask about the returned deposit.",
      live: true,
      confirmationToken: signSecretaryConfirmation("owner-a", "Ask about the returned deposit."),
    };
    const missingKey = await request(server).post("/api/secretary/tasks")
      .set("x-test-user-id", "owner-a").send(body);
    expect(missingKey.status).toBe(400);
    expect(mocks.createLiveSecretaryTask).not.toHaveBeenCalled();

    mocks.getLiveSecretaryTaskByClientRequest
      .mockResolvedValueOnce({ ...task, mode: "live", status: "completed", attempts: 1 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({ ...task, mode: "live", status: "completed", attempts: 1 });
    const repeated = await request(server).post("/api/secretary/tasks")
      .set("x-test-user-id", "owner-a")
      .send({ ...body, confirmationToken: undefined, clientRequestId: "810f8906-4b66-4fee-9c41-2d21f41703b1" });
    expect(repeated.status).toBe(200);
    expect(repeated.body.task.status).toBe("completed");
    expect(repeated.body.task.clientRequestId).toBe("810f8906-4b66-4fee-9c41-2d21f41703b1");
    expect(dial).not.toHaveBeenCalled();
    expect(mocks.createLiveSecretaryTask).not.toHaveBeenCalled();

    const missingNewToken = await request(server).post("/api/secretary/tasks")
      .set("x-test-user-id", "owner-a")
      .send({ ...body, clientRequestId: "a10f8906-4b66-4fee-9c41-2d21f41703b1", confirmationToken: undefined });
    expect(missingNewToken.status).toBe(403);

    const now = Date.now();
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now - 16 * 60_000);
    const expiredToken = signSecretaryConfirmation("owner-a", "Ask about the returned deposit.");
    dateSpy.mockRestore();
    const expiredRepeat = await request(server).post("/api/secretary/tasks")
      .set("x-test-user-id", "owner-a")
      .send({ ...body, confirmationToken: expiredToken, clientRequestId: "810f8906-4b66-4fee-9c41-2d21f41703b1" });
    expect(expiredRepeat.status).toBe(200);
    expect(mocks.createLiveSecretaryTask).not.toHaveBeenCalled();
  });

  it("rejects a request-key conflict before confirmation can create a new attempt", async () => {
    mocks.getLiveSecretaryTaskByClientRequest.mockRejectedValue(
      Object.assign(new Error("This clientRequestId was already used for a different assignment."), { status: 409 }),
    );
    const server = express();
    server.use(express.json());
    const dial = vi.fn();
    registerSecretaryRoutes(server as any, { dial, notify: vi.fn() });
    const response = await request(server).post("/api/secretary/tasks")
      .set("x-test-user-id", "owner-a")
      .send({
        phoneNumber: "+19545551234",
        instruction: "Different assignment.",
        live: true,
        clientRequestId: "810f8906-4b66-4fee-9c41-2d21f41703b1",
      });
    expect(response.status).toBe(409);
    expect(mocks.createLiveSecretaryTask).not.toHaveBeenCalled();
    expect(dial).not.toHaveBeenCalled();
  });

  it("does not dial when concurrent copies resolve to the same durable intent", async () => {
    const dial = vi.fn().mockResolvedValue({ sid: "CA0123456789abcdef0123456789abcdef", callId: "call-1" });
    const starting = { ...task, mode: "live", status: "starting", attempts: 1 };
    mocks.createLiveSecretaryTask
      .mockResolvedValueOnce({ task: starting, created: true })
      .mockResolvedValueOnce({ task: starting, created: false });
    const server = express();
    server.use(express.json());
    registerSecretaryRoutes(server as any, { dial, notify: vi.fn() });
    const body = {
      phoneNumber: "+19545551234",
      instruction: "Ask about the returned deposit.",
      live: true,
      clientRequestId: "810f8906-4b66-4fee-9c41-2d21f41703b1",
      confirmationToken: signSecretaryConfirmation("owner-a", "Ask about the returned deposit."),
    };
    const submit = () => request(server).post("/api/secretary/tasks")
      .set("x-test-user-id", "owner-a").send(body);
    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(dial).toHaveBeenCalledOnce();
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

  it("only lets the owner hang up an active live call", async () => {
    const server = app();
    const denied = await request(server).post("/api/secretary/tasks/task-1/hangup").set("x-test-user-id", "owner-b");
    expect(denied.status).toBe(404);
    expect(hangupSecretaryCall).not.toHaveBeenCalled();
    const allowed = await request(server).post("/api/secretary/tasks/task-1/hangup").set("x-test-user-id", "owner-a");
    expect(allowed.status).toBe(200);
    expect(hangupSecretaryCall).toHaveBeenCalledWith("CA0123456789abcdef0123456789abcdef");
  });

  it("does not hand a live task to the retry queue", async () => {
    mocks.retrySecretaryTask.mockResolvedValue(undefined);
    mocks.listSecretaryTasks.mockResolvedValue([{ ...task, mode: "live", status: "failed", attempts: 1 }]);
    const dial = vi.fn();
    const server = express();
    server.use(express.json());
    registerSecretaryRoutes(server as any, { dial, notify: vi.fn() });
    const response = await request(server).post("/api/secretary/tasks/task-1/retry")
      .set("x-test-user-id", "owner-a");
    expect(response.status).toBe(409);
    expect(mocks.retrySecretaryTask).toHaveBeenCalledWith("owner-a", "task-1");
    expect(dial).not.toHaveBeenCalled();
  });
});