import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../../auth";
import { storage } from "../../storage";
import { isBenchmarkAdmin } from "../../benchmark/adminGate";
import { buildSecretaryInstructions } from "../agent";
import { confirmedSecretaryOwnerName } from "../ownerIdentity";
import { streamSecretaryResponse } from "../conversationEngine";
import { applyPersonality } from "./types";
import * as store from "./store";
import { outgoingSettings, saveOutgoingSetup } from "./outgoing";

const content = z.object({
  name: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(400),
  rules: z.string().trim().min(1).max(12000), examples: z.array(z.string().trim().min(1).max(1000)).max(20),
  modeGuidance: z.object({ personal: z.string().max(3000), work: z.string().max(3000) }).strict(),
});
const root = "/api/secretary-personalities";
const previews = new Map<string, { since: number; count: number; running: boolean }>();
const owner = (req: Request) => (req as any).user?.id as string;
async function admin(req: Request) {
  const user = await storage.getUser(owner(req));
  return isBenchmarkAdmin(user?.email);
}
function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try { await fn(req, res); } catch (e: any) {
      const status = e instanceof z.ZodError ? 400 : e.status ?? 503;
      res.status(status).json({ error: e instanceof z.ZodError ? "Проверьте поля формы" :
        e.status ? e.message : "Не удалось выполнить операцию с личностью" });
    }
  };
}
async function assignment(ownerId: string, number: string) {
  const n = await store.ownedNumber(ownerId, number), binding = await store.readBinding(ownerId, number);
  return { assignment: binding ?? null, support: {
    incoming: n.type === "work", outgoingRetell: true,
    note: n.type === "work"
      ? "Характер применяется к уже включённому входящему Work Secretary и исходящему Retell. Этот выбор не включает приём звонков."
      : "Личный входящий Secretary пока не реализован. Выбор применяется к исходящему Retell с этого номера. Выбор номера при наборе не изменяется.",
  } };
}
export function registerPersonalityRoutes(app: Express) {
  app.use(root, (req, res, next) => {
    if (!store.personalitiesEnabled()) return res.status(404).json({ error: "Каталог личностей пока доступен только в Dev" });
    next();
  }, authMiddleware);
  app.get(root + "/context", wrap(async (req, res) => {
    const numbers = await storage.getUserPhoneNumbers(owner(req));
    res.json({ numbers: numbers.map(n => ({ id: n.id, type: n.type, twilioNumber: n.twilioNumber, friendlyName: n.name })),
      admin: await admin(req) });
  }));
  app.get(root, wrap(async (req, res) => {
    const input = z.object({ q: z.string().max(100).default(""), cursor: z.string().max(1200).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      includeRetired: z.enum(["true", "false"]).optional() }).parse(req.query);
    res.json(await store.listPersonalities(input.q, input.cursor, input.limit,
      input.includeRetired === "true" && await admin(req)));
  }));
  app.get(root + "/numbers/:numberId", wrap(async (req, res) => res.json(await assignment(owner(req), String(req.params.numberId)))));
  app.get(root + "/numbers/:numberId/outgoing", wrap(async (req, res) =>
    res.json(await outgoingSettings(owner(req), String(req.params.numberId)))));
  app.put(root + "/numbers/:numberId/outgoing", wrap(async (req, res) => {
    const input = z.object({
      cardIds: z.array(z.string().min(1).max(100)).max(8),
      personalityId: z.string().min(1).max(100).nullable(), version: z.number().int().positive().nullable(),
    }).strict().refine(v => (v.personalityId === null) === (v.version === null)).parse(req.body);
    res.json(await saveOutgoingSetup(owner(req), String(req.params.numberId), input));
  }));
  app.put(root + "/numbers/:numberId", wrap(async (req, res) => {
    const input = z.object({ personalityId: z.string().min(1).max(100).nullable(), version: z.number().int().positive().nullable() })
      .strict().refine(v => (v.personalityId === null) === (v.version === null)).parse(req.body);
    await store.assignPersonality(owner(req), String(req.params.numberId), input.personalityId, input.version);
    res.json(await assignment(owner(req), String(req.params.numberId)));
  }));
  app.post(root + "/preview", wrap(async (req, res) => {
    const input = z.object({ numberId: z.string().min(1).max(100), text: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    const n = await store.ownedNumber(owner(req), input.numberId), binding = await store.readBinding(owner(req), n.id);
    const now = Date.now(), old = previews.get(owner(req));
    const budget = old && now - old.since < 3600000 ? old : { since: now, count: 0, running: false };
    if (budget.running || budget.count >= 30) throw store.problem(429, "Лимит текстовых проверок: 30 в час, одна одновременно");
    budget.count++; budget.running = true; previews.set(owner(req), budget);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
    const cancel = () => controller.abort(); res.once("close", cancel);
    try {
      const base = buildSecretaryInstructions(
        "Text-only TEST of conversational style. No actual call or external action is happening. " +
        "Respond directly to the supplied line, not a new phone greeting. No business facts or cards are supplied. Never invent them.",
        confirmedSecretaryOwnerName(owner(req)));
      let text = "";
      for await (const chunk of streamSecretaryResponse({
        instructions: applyPersonality(base, binding), input: [{ role: "user", content: input.text }], signal: controller.signal,
      }, { tools: [] })) if (chunk.type === "text") text += chunk.text;
      if (!text.trim()) throw store.problem(503, "Engine не вернул ответ");
      res.json({ text, personality: binding ? { id: binding.personalityId, name: binding.snapshot.name, version: binding.version } : null,
        mode: store.numberMode(n.type), model: "gpt-6.1-sol", testOnly: true });
    } finally { clearTimeout(timer); res.off("close", cancel); budget.running = false; }
  }));
  app.get(root + "/:id", wrap(async (req, res) => res.json(await store.personalityDetails(String(req.params.id)))));
  app.post(root, wrap(async (req, res) => {
    if (!await admin(req)) throw store.problem(403, "Только администратор каталога");
    const input = content.extend({ slug: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/) }).strict().parse(req.body);
    const { slug, ...data } = input;
    res.status(201).json(await store.createPersonality(slug, data));
  }));
  app.put(root + "/:id", wrap(async (req, res) => {
    if (!await admin(req)) throw store.problem(403, "Только администратор каталога");
    const input = content.extend({ expectedVersion: z.number().int().positive(), status: z.enum(["available", "retired"]) })
      .strict().parse(req.body);
    const { expectedVersion, status, ...data } = input;
    res.json(await store.revisePersonality(String(req.params.id), expectedVersion, status, data));
  }));
}
