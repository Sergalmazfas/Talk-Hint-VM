import type { Express } from "express";
import { requireBenchmarkAdmin } from "../benchmark/adminGate";
import { adminActionOrigin } from "../adminWeb";
import { dbReady, pool } from "../db";
import { ModelError, requestSchema } from "./domain";
import { PgModelRepository, type ModelRepository } from "./repository";

const repository = new PgModelRepository(async () => {
  await dbReady;
  if (!pool) throw new Error("Database unavailable");
  return pool;
});

export function registerProjectModel(app: Express, repo: ModelRepository = repository) {
  // Defense in depth: safe even when mounted without the outer /api/admin gate.
  app.all("/api/admin/project-model", requireBenchmarkAdmin, adminActionOrigin, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const owner = String(req.user!.id);
    try {
      const hypothesis = req.query.hypothesis ?? "original";
      if (typeof hypothesis !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(hypothesis))
        return res.status(400).json({ error: "Некорректная гипотеза." });
      if (hypothesis !== "original" && process.env.NODE_ENV !== "development" &&
          !(await repo.hasActiveCompanySource?.(owner)))
        return res.status(404).json({ error: "Сравнение гипотез пока доступно только в Dev." });
      if (req.method === "GET") {
        if (req.query.revision !== undefined) {
          if (typeof req.query.revision !== "string" || !/^(0|[1-9][0-9]*)$/.test(req.query.revision) ||
              !Number.isSafeInteger(Number(req.query.revision)))
            return res.status(400).json({ error: "Некорректная ревизия." });
          if (!repo.readRevision) return res.status(503).json({ error: "Чтение прежних ревизий недоступно." });
          res.set("X-Model-Snapshot", "read-only");
          return res.json(await repo.readRevision(owner, Number(req.query.revision), hypothesis));
        }
        return res.json(await repo.read(owner, hypothesis));
      }
      if (req.query.revision !== undefined) return res.status(400).json({ error: "Прежняя ревизия доступна только для чтения." });
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Некорректное изменение модели", details: parsed.error.flatten() });
      return res.json(await repo.update(owner, parsed.data.revision, parsed.data.command, hypothesis));
    } catch (error) {
      if (error instanceof ModelError) return res.status(error.status).json({ error: error.message });
      // Never echo SQL / connection strings / raw submitted content.
      console.error("[ProjectModel] storage operation failed");
      return res.status(503).json({ error: "Не удалось сохранить или прочитать модель. Данные не подтверждены; повторите после восстановления базы." });
    }
  });
}
