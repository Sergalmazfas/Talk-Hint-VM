import express, { type Express } from "express";
import { z } from "zod";
import { requireBenchmarkAdmin } from "../benchmark/adminGate";
import { comparisonEditInput, comparisonSaveInput, type ComparisonMode } from "../../shared/secretaryLabComparison";
import { comparisonSnapshot, comparisonText } from "./comparisonSnapshot";
import { COMPARISON_RETENTION_DAYS, type ComparisonRepository } from "./comparisonStore";
import type { LabReport } from "./service";
import type { RetellReport } from "./retell";

export type ComparisonReports = (owner: string) => Array<{ mode: ComparisonMode; report: LabReport | RetellReport }>;
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
export function registerComparisonRoutes(app: Express, store: ComparisonRepository, reports: ComparisonReports) {
  const base = "/api/admin/secretary-lab/comparisons";
  app.use(base, requireBenchmarkAdmin, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (process.env.NODE_ENV !== "development") return res.sendStatus(404);
    next();
  }, express.json({ limit: "16kb" }));
  const handler = (fn: (req: express.Request, res: express.Response) => Promise<unknown> | unknown): express.RequestHandler =>
    async (req, res) => {
      try { await fn(req, res); } catch (e: any) {
        const status = e instanceof z.ZodError ? 400 : [400, 404, 409, 429].includes(e?.status) ? e.status : 503;
        res.status(status).json({ error: e instanceof z.ZodError ? "Проверьте название, согласие, выбранные прогоны и оценку." :
          status === 503 ? "Хранилище сравнений недоступно. Данные не сохранены; повторите запрос." : e.message });
      }
    };
  const candidates = (owner: string) => reports(owner).filter(({ report }) => ["ended", "failed"].includes(report.status));
  app.get(`${base}/candidates`, handler((req, res) => res.json({
    runs: candidates(req.user!.id).map(({ mode, report }) => {
      const s = comparisonSnapshot(mode, report);
      return { mode, id: s.id, runtime: s.runtime, model: s.model, voice: s.voice, instruction: s.instruction, status: s.status, createdAt: s.createdAt };
    }),
  })));
  app.get(base, handler(async (_req, res) => {
    const items = await store.list();
    res.json({ retentionDays: COMPARISON_RETENTION_DAYS, items: items.map(item => ({
      ...item, runs: item.runs.map(({ mode, id, runtime, model, voice }) => ({ mode, id, runtime, model, voice })),
    })) });
  }));
  app.post(base, handler(async (req, res) => {
    const input = comparisonSaveInput.parse(req.body);
    if (new Set(input.sources.map(s => `${s.mode}:${s.id}`)).size !== input.sources.length) fail(400, "Прогон выбран несколько раз.");
    const available = candidates(req.user!.id);
    const sourceReports = input.sources.map(source => {
      const found = available.find(s => s.mode === source.mode && s.report.id === source.id);
      if (!found) fail(404, "Завершённый прогон не найден: он истёк, принадлежит другому владельцу или ещё активен.");
      return found!;
    });
    // Compare original instructions before redaction; distinct secrets/links must
    // not make unrelated assignments look equivalent.
    if (sourceReports.some(s => s.report.instruction.trim() !== sourceReports[0].report.instruction.trim()))
      fail(409, "Для честного сравнения выберите прогоны с одинаковым поручением.");
    const runs = sourceReports.map(s => comparisonSnapshot(s.mode, s.report));
    const result = await store.save(req.user!.id, {
      title: comparisonText(input.title, 160), instruction: runs[0].instruction, runs,
      evaluation: { score: input.evaluation.score, note: comparisonText(input.evaluation.note) },
    });
    res.status(201).json(result);
  }));
  app.use(`${base}/:id`, (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.sendStatus(404);
    next();
  });
  app.get(`${base}/:id`, handler(async (req, res) => {
    const item = await store.get(req.params.id); if (!item) fail(404, "Сравнение удалено или срок хранения истёк.");
    res.json(item);
  }));
  app.patch(`${base}/:id`, handler(async (req, res) => {
    const { evaluation } = comparisonEditInput.parse(req.body);
    const item = await store.evaluate(req.params.id, { score: evaluation.score, note: comparisonText(evaluation.note) });
    if (!item) fail(404, "Сравнение удалено или срок хранения истёк.");
    res.json(item);
  }));
  app.delete(`${base}/:id`, handler(async (req, res) => {
    if (Object.keys(req.body ?? {}).length) fail(400, "Тело запроса должно быть пустым.");
    if (!await store.remove(req.params.id)) fail(404, "Сравнение удалено или срок хранения истёк.");
    res.sendStatus(204);
  }));
}
