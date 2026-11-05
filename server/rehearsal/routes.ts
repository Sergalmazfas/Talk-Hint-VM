import express, { type Express, type Request, type Response } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { requireBenchmarkAdmin } from "../benchmark/adminGate";
import { RehearsalRuntime } from "./runtime";
import { requireRehearsalDev } from "./store";
export function registerRehearsalRoutes(app: Express, runtime = new RehearsalRuntime()) {
  const base = "/api/admin/rehearsal";
  const tokens = new Map<string, { token: string; expires: number }>();
  app.use(base, (_req, res, next) => {
    try { requireRehearsalDev(); res.setHeader("Cache-Control", "no-store"); next(); }
    catch { res.sendStatus(404); }
  }, requireBenchmarkAdmin, express.json({ limit: "16kb" }));
  const handler = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      if (req.method !== "GET") {
        const expected = tokens.get(req.user!.id), supplied = req.get("X-Rehearsal-CSRF") ?? "";
        if (req.get("Origin") !== `https://${process.env.REPLIT_DEV_DOMAIN}` || !expected || expected.expires < Date.now() ||
          supplied.length !== expected.token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected.token)))
          return res.status(403).json({ error: "REHEARSAL_ORIGIN_OR_CSRF_RELOAD" });
      }
      await fn(req, res);
    } catch (e: any) {
      const status = [400, 401, 403, 404, 409, 422, 429].includes(e?.status) ? e.status : e?.name === "ZodError" ? 400 : 503;
      const code = /^[A-Z][A-Z0-9_]{2,100}$/.test(e?.message ?? "") ? e.message : "REHEARSAL_OPERATION_FAILED_NO_BLIND_RETRY";
      res.status(status).json({ error: code });
    }
  };
  const empty = (body: any) => {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
      throw Object.assign(Error("REHEARSAL_EMPTY_BODY_REQUIRED"), { status: 400 });
  };
  app.get(base, handler(async (req, res) => {
    let entry = tokens.get(req.user!.id);
    if (!entry || entry.expires < Date.now()) {
      entry = { token: randomBytes(32).toString("hex"), expires: Date.now() + 8 * 3600_000 };
      tokens.set(req.user!.id, entry);
    }
    res.json({ ...await runtime.snapshot(req.user!.id), csrf: entry.token });
  }));
  app.post(`${base}/scenes`, handler(async (req, res) => { res.status(201).json(await runtime.saveScene(req.user!.id, req.body)); }));
  app.post(`${base}/settings`, handler(async (req, res) => { res.json(await runtime.saveSettings(req.user!.id, req.body)); }));
  app.post(`${base}/sessions`, handler(async (req, res) => { res.status(201).json(await runtime.create(req.user!.id, req.body)); }));
  app.get(`${base}/sessions/:id`, handler(async (req, res) => { res.json(await runtime.get(req.user!.id, req.params.id)); }));
  for (const name of ["connected", "stop", "captureAudio", "analyse"] as const) {
    const path = name === "captureAudio" ? "audio" : name;
    app.post(`${base}/sessions/:id/${path}`, handler(async (req, res) => {
      empty(req.body); res.json(await runtime[name](req.user!.id, req.params.id));
    }));
  }
  app.post(`${base}/sessions/:id/waiting-audio`, handler(async (req, res) => {
    res.json(runtime.waiting(req.user!.id, req.params.id, req.body));
  }));
  app.get(`${base}/sessions/:id/audio`, handler(async (req, res) => {
    const audio = await runtime.readAudio(req.user!.id, req.params.id);
    res.setHeader("Content-Type", audio.type); res.setHeader("Content-Length", audio.bytes.length);
    res.setHeader("X-Content-Type-Options", "nosniff"); res.send(audio.bytes);
  }));
}
