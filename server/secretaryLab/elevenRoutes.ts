import express, { type Express } from "express";
import { requireBenchmarkAdmin } from "../benchmark/adminGate";
import { ElevenEngineLab } from "./elevenEngine";
import { ElevenLabError } from "./elevenApi";
import type { ComparisonRepository } from "./comparisonStore";

export let elevenEngineLab: ElevenEngineLab | undefined;
export function registerElevenEngineRoutes(app: Express, store: ComparisonRepository, lab = new ElevenEngineLab(store)) {
  elevenEngineLab = lab;
  const error = (res: express.Response, e: unknown) => {
    if (!res.headersSent) res.status(e instanceof ElevenLabError ? e.status : 503).json({
      error: e instanceof ElevenLabError ? e.message : "ElevenLabs / сохранение результата недоступны; подмены нет",
    }); else res.end();
  };
  // Provider-only capability endpoint, never a generic public OpenAI proxy.
  app.post("/eleven-engine-llm/:capability/v1/chat/completions", express.json({ limit: "128kb" }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try { await lab.completion(req.params.capability, req, res); } catch (e) { error(res, e); }
  });
  const base = "/api/admin/secretary-lab/eleven-engine";
  app.use(base, requireBenchmarkAdmin, express.json({ limit: "16kb" }), (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (process.env.NODE_ENV !== "development") { res.sendStatus(404); return; } next();
  });
  app.get(base, async (req, res) => { try { res.json(await lab.readiness(req.user!.id)); } catch (e) { error(res, e); } });
  app.post(`${base}/sessions`, async (req, res) => { try { res.status(201).json(await lab.create(req.user!.id, req.body)); } catch (e) { error(res, e); } });
  app.get(`${base}/sessions/:id`, async (req, res) => { try { res.json(await lab.report(req.user!.id, req.params.id)); } catch (e) { error(res, e); } });
  app.delete(`${base}/sessions/:id`, async (req, res) => {
    if (Object.keys(req.body ?? {}).length) return res.sendStatus(400);
    try { res.json(await lab.stop(req.user!.id, req.params.id)); } catch (e) { error(res, e); }
  });
  app.post(`${base}/sessions/:id/evaluation`, async (req, res) => { try { res.json(await lab.evaluate(req.user!.id, req.params.id, req.body)); } catch (e) { error(res, e); } });
  app.post(`${base}/sessions/:id/telemetry`, async (req, res) => { try { res.json(await lab.telemetry(req.user!.id, req.params.id, req.body)); } catch (e) { error(res, e); } });
  return lab;
}
