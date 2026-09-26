import type { Express, Request, Response } from "express";
import { authMiddleware } from "../auth";
import { verifySecretaryConfirmation } from "./confirmation";
import { db } from "../db";
import { phoneNumbers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getClone, getCartesiaClone } from "../voiceLab/store";
import { requireReadyTranslatorClone } from "../translation/cloneSpeech";
import {
  cancelSecretaryTask,
  createSecretaryTask,
  listSecretaryTasks,
  retrySecretaryTask,
  startSecretaryWorker,
  toSecretaryTaskReport,
  type SecretaryWorkerDependencies,
} from "./tasks";

function ownerId(req: Request): string | undefined {
  return (req as any).user?.id as string | undefined;
}

function sendError(res: Response, error: unknown, fallback: string): void {
  const status = Number((error as any)?.status);
  const code = String((error as any)?.code ?? "");
  const message = typeof (error as any)?.message === "string" ? (error as any).message : fallback;
  if (code === "23505") {
    res.status(409).json({ error: "A Secretary call is already active, or this task cannot be started again yet." });
    return;
  }
  res.status(status >= 400 && status < 500 ? status : 503).json({ error: status ? message : fallback });
}

/** Mount authenticated owner-scoped APIs and start the bounded persistent worker. */
export function registerSecretaryRoutes(app: Express, deps: SecretaryWorkerDependencies): void {
  app.get("/api/secretary/tasks", authMiddleware, async (req, res) => {
    const userId = ownerId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const tasks = await listSecretaryTasks(userId);
      res.json({ tasks: tasks.map(toSecretaryTaskReport) });
    } catch (error) {
      sendError(res, error, "Could not load Secretary tasks.");
    }
  });

  app.post("/api/secretary/tasks", authMiddleware, async (req, res) => {
    const userId = ownerId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!verifySecretaryConfirmation(req.body?.confirmationToken, userId, req.body?.instruction)) {
      return res.status(403).json({ error: "Confirm this Secretary assignment in Prepare before starting the call." });
    }
    try {
      const [number] = await db.select({ id: phoneNumbers.id }).from(phoneNumbers)
        .where(eq(phoneNumbers.userId, userId)).limit(1);
      if (!number) throw Object.assign(new Error("Assign a TalkHint phone number before starting Secretary."), { status: 409 });
      const provider = req.body?.voiceProvider === "cartesia" ? "cartesia" : "elevenlabs";
      const clone = await (provider === "cartesia" ? getCartesiaClone(userId) : getClone(userId));
      try {
        requireReadyTranslatorClone(
          provider, clone,
          provider === "cartesia" ? process.env.CARTESIA_API_KEY : process.env.ELEVENLABS_API_KEY,
        );
      } catch {
        throw Object.assign(new Error("Set up a ready voice clone before starting Secretary."), { status: 409 });
      }
      if (!process.env.OPENAI_API_KEY) {
        throw Object.assign(new Error("Secretary conversation service is not configured."), { status: 503 });
      }
      const task = await createSecretaryTask(userId, {
        phoneNumber: req.body?.phoneNumber,
        instruction: req.body?.instruction,
        voiceProvider: req.body?.voiceProvider,
      });
      res.status(201).json({ task: toSecretaryTaskReport(task) });
    } catch (error) {
      sendError(res, error, "Could not save the Secretary task.");
    }
  });

  app.post("/api/secretary/tasks/:id/cancel", authMiddleware, async (req, res) => {
    const userId = ownerId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const task = await cancelSecretaryTask(userId, req.params.id);
      if (task) return res.json({ task: toSecretaryTaskReport(task) });
      const existing = await listSecretaryTasks(userId);
      if (!existing.some((item) => item.id === req.params.id)) {
        return res.status(404).json({ error: "Secretary task not found." });
      }
      res.status(409).json({ error: "Only a queued Secretary task can be cancelled." });
    } catch (error) {
      sendError(res, error, "Could not cancel the Secretary task.");
    }
  });

  app.post("/api/secretary/tasks/:id/retry", authMiddleware, async (req, res) => {
    const userId = ownerId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const task = await retrySecretaryTask(userId, req.params.id);
      if (task) return res.json({ task: toSecretaryTaskReport(task) });
      const existing = await listSecretaryTasks(userId);
      if (!existing.some((item) => item.id === req.params.id)) {
        return res.status(404).json({ error: "Secretary task not found." });
      }
      res.status(409).json({ error: "This Secretary task is not eligible for another attempt." });
    } catch (error) {
      sendError(res, error, "Could not retry the Secretary task.");
    }
  });

  startSecretaryWorker(deps);
}