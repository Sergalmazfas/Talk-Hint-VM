import { Router, type Express, type Request, type RequestHandler } from "express";
import { ChatError, createConversation, sendMessage, uploadAttachment, requestId, publicAttachment } from "./contracts";
import type { ChatService } from "./service";
import { z } from "zod";

function owner(req: Request): string {
  const user = req.user as any;
  const id = user?.id || user?.claims?.sub;
  if (typeof id !== "string" || !id || /^(chatgpt:|thcg\.|thmobile\.|productcrew:|thpc\.)/.test(id))
    throw new ChatError("UNAUTHORIZED", 401);
  return id;
}
export function chatRouter(auth: RequestHandler, service: () => Promise<ChatService>) {
  const r = Router();
  r.use(auth);
  r.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const origin = req.get("origin");
    const expected = `${req.protocol}://${req.get("host")}`;
    if (origin && origin !== expected) return res.status(403).json({ error: "CHAT_ORIGIN_REJECTED" });
    if (!["GET", "HEAD"].includes(req.method)) {
      // Native Bearer credentials cannot be supplied automatically by a browser.
      // Cookie callers must be same-origin and send an explicit intent header.
      const bearer = /^Bearer [^\s]+$/.test(req.headers.authorization || "");
      if (!bearer && (!origin || req.get("x-talkhint-chat") !== "1"))
        return res.status(403).json({ error: "CHAT_ORIGIN_REJECTED" });
    }
    next();
  });
  const handle = (fn: (req: Request, svc: ChatService, user: string, res: any) => Promise<any>): RequestHandler =>
    async (req, res) => {
      try { const user = owner(req); return await fn(req, await service(), user, res); }
      catch (e: any) {
        if (e?.name === "ZodError") return res.status(400).json({ error: "INVALID_REQUEST" });
        if (e instanceof ChatError) return res.status(e.status).json({ error: e.code });
        console.error("[Chat1A] database/storage operation failed", { code: e?.code });
        return res.status(503).json({ error: "CHAT_STORAGE_UNAVAILABLE" });
      }
    };
  r.get("/capabilities", handle(async (_req, svc, _user, res) => res.json(await svc.capabilities())));
  r.get("/conversations", handle(async (req, svc, user, res) => {
    const cursor = req.query.cursor ? requestId.parse(req.query.cursor) : undefined;
    res.json(await svc.repo.list(user, cursor));
  }));
  r.post("/conversations", handle(async (req, svc, user, res) => {
    const body = createConversation.parse(req.body);
    res.json({ conversation: await svc.repo.create(user, body.clientRequestId, body.title) });
  }));
  r.get("/conversations/:id/messages", handle(async (req, svc, user, res) => {
    const id = requestId.parse(req.params.id);
    const before = req.query.beforeSequence === undefined ? undefined : Number(req.query.beforeSequence);
    if (before !== undefined && (!Number.isSafeInteger(before) || before <= 0)) throw new ChatError("INVALID_CURSOR", 400);
    res.json(await svc.repo.messages(user, id, before));
  }));
  r.get("/conversations/:id/messages/:messageId", handle(async (req, svc, user, res) => {
    res.json({ message: await svc.repo.one(user, requestId.parse(req.params.id), requestId.parse(req.params.messageId)) });
  }));
  r.post("/conversations/:id/messages", handle(async (req, svc, user, res) => {
    const result = await svc.send(user, requestId.parse(req.params.id), sendMessage.parse(req.body));
    res.status(result.created ? 202 : 200).json({ message: result.message, reply: result.reply });
  }));
  r.post("/conversations/:id/messages/:messageId/confirm-plan", handle(async (req, svc, user, res) => {
    const body = z.object({ planHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body);
    res.json(await svc.confirmPlan(user, requestId.parse(req.params.id), requestId.parse(req.params.messageId), body.planHash));
  }));
  r.post("/attachments", handle(async (req, svc, user, res) => res.json(await svc.upload(user, uploadAttachment.parse(req.body)))));
  r.get("/attachments/:id/info", handle(async (req, svc, user, res) => {
    res.json({ attachment: publicAttachment(await svc.repo.attachment(user, requestId.parse(req.params.id))) });
  }));
  r.get("/attachments/:id", handle(async (req, svc, user, res) => {
    const { attachment, bytes } = await svc.download(user, requestId.parse(req.params.id));
    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  }));
  return r;
}
export function registerChat1A(app: Express, auth: RequestHandler) {
  let runtime: Promise<ChatService> | undefined;
  const load = async () => {
    const { pool, dbReady } = await import("../db");
    await dbReady;
    if (!pool) throw new ChatError("CHAT_STORAGE_UNAVAILABLE", 503);
    const [{ ChatRepository }, { ChatService }, { ResponsesChatProvider }] = await Promise.all([
      import("./repository"), import("./service"), import("./provider"),
    ]);
    return new ChatService(new ChatRepository(pool), new ResponsesChatProvider());
  };
  app.use("/api/chat-v1", chatRouter(auth, () => runtime ??= load().catch(e => { runtime = undefined; throw e; })));
}
