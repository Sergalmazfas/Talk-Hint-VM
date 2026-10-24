import express, { type Express } from "express";
import { requireBenchmarkAdmin } from "../benchmark/adminGate";
import { retellSecretaryLab, type RetellSecretaryLab } from "./retell";

export function registerRetellLabRoutes(app: Express, lab: RetellSecretaryLab = retellSecretaryLab) {
  const base = "/api/admin/secretary-lab/retell";
  app.use(base, requireBenchmarkAdmin, express.json({ limit: "16kb" }), (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (process.env.NODE_ENV !== "development") { res.sendStatus(404); return; }
    next();
  });
  const error = (res: express.Response, e: any) => {
    const status = [400, 401, 402, 403, 404, 409, 422, 429, 503].includes(e?.status) ? e.status : 503;
    res.status(status).json({ error: e?.status ? e.message : "Retell: стенд временно недоступен" });
  };
  app.get(base, async (req, res) => {
    try { res.json(await lab.readiness(req.user!.id)); } catch (e) { error(res, e); }
  });
  app.post(`${base}/sessions`, async (req, res) => {
    try { res.status(201).json(await lab.create(req.user!.id, req.body)); } catch (e) { error(res, e); }
  });
  app.get(`${base}/sessions/:id`, (req, res) => {
    try { res.json(lab.report(req.user!.id, req.params.id)); } catch (e) { error(res, e); }
  });
  app.post(`${base}/sessions/:id/connected`, async (req, res) => {
    if (Object.keys(req.body ?? {}).length) return res.status(400).json({ error: "Only an empty body is accepted" });
    try { res.json(await lab.connected(req.user!.id, req.params.id)); } catch (e) { error(res, e); }
  });
  app.post(`${base}/sessions/:id/observations`, (req, res) => {
    try { res.json(lab.observe(req.user!.id, req.params.id, req.body)); } catch (e) { error(res, e); }
  });
  app.delete(`${base}/sessions/:id`, async (req, res) => {
    if (Object.keys(req.body ?? {}).length) return res.status(400).json({ error: "Only an empty body is accepted" });
    try { res.json({ report: await lab.stop(req.user!.id, req.params.id) }); } catch (e) { error(res, e); }
  });
}
