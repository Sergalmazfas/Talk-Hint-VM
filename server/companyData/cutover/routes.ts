import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import type { Pool } from "pg";
import { requireBenchmarkAdmin } from "../../benchmark/adminGate";
import { adminActionOrigin } from "../../adminWeb";
import { ModelError } from "../../projectModel/modelError";
import { CompanyCutover } from "./service";
import { cutoverActions, cutoverCandidate, reviewedCutoverApproval, type CutoverPolicy } from "./policy";
import { startCutoverWorker } from "./workerProcess";
export function registerCompanyCutover(app: Express, getPool: () => Promise<Pool>, options: {
  environment?: "development" | "production"; candidate?: CutoverPolicy; approval?: CutoverPolicy | null;
  service?: CompanyCutover; launch?: (operation: string) => Promise<void>;
} = {}) {
  const environment = options.environment ?? (process.env.NODE_ENV === "production" ? "production" : "development");
  const candidate = options.candidate ?? cutoverCandidate;
  const approval = options.approval === undefined ? reviewedCutoverApproval : options.approval;
  const base = "/api/admin/company-cutover";
  app.all(`${base}/*`, requireBenchmarkAdmin, adminActionOrigin, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.isAuthenticated?.() || !req.session || !req.user?.id)
      return res.status(401).json({ error: "Требуется вход владельца в браузере." });
    if (req.get("authorization"))
      return res.status(403).json({ error: "Для этого действия используется только браузерная сессия, не Bearer/MCP." });
    const owner = String(req.user.id);
    if (owner !== candidate.owner || environment !== candidate.environment)
      return res.status(403).json({ error: "Владелец или среда не совпадают." });
    try {
      const service = options.service ?? new CompanyCutover(await getPool(), environment, candidate, approval);
      if (req.method === "GET" && req.path === `${base}/status`) {
        const session = req.session as any;
        session.companyCutoverCsrf ??= randomBytes(32).toString("hex");
        return res.json({ ...await service.status(owner), csrfToken: session.companyCutoverCsrf });
      }
      if (!["/grant", "/execute"].some(path => req.path === base + path))
        return res.status(404).json({ error: "Неизвестное действие." });
      if (req.method !== "POST") return res.status(405).json({ error: "Требуется POST." });
      // Unlike bearer API actions, this operation always requires a browser Origin.
      if (req.get("origin") !== `${req.protocol}://${req.get("host")}`)
        return res.status(403).json({ error: "Требуется подтверждение с того же сайта." });
      if (!approval) return res.status(423).json({ error: "Включение ещё не разрешено владельцем." });
      const csrf = req.get("x-company-csrf"), expectedCsrf = (req.session as any).companyCutoverCsrf;
      if (typeof csrf !== "string" || typeof expectedCsrf !== "string" ||
          !/^[a-f0-9]{64}$/.test(csrf) || !/^[a-f0-9]{64}$/.test(expectedCsrf) ||
          !timingSafeEqual(Buffer.from(csrf), Buffer.from(expectedCsrf)))
        return res.status(403).json({ error: "Подтверждение сессии не совпало." });
      const body = req.body ?? {}, action = body.action;
      const keys = req.path.endsWith("/grant") ? ["action", "confirm", "expected"] : ["action", "confirm", "expected", "grant"];
      if (!cutoverActions.includes(action) || body.confirm !== true ||
          Object.keys(body).some(k => !keys.includes(k)) || !body.expected ||
          Object.keys(body.expected).sort().join(",") !== "manifestHash,revision,rootHash,workspace" ||
          !Number.isSafeInteger(body.expected.revision) || typeof body.expected.workspace !== "string" ||
          !/^[a-f0-9]{64}$/.test(body.expected.rootHash) || !/^[a-f0-9]{64}$/.test(body.expected.manifestHash))
        throw new ModelError(400, "Требуется точное подтверждение источника.");
      if (req.path.endsWith("/grant")) return res.json({ grant: await service.grant(owner, action, body.expected) });
      if (typeof body.grant !== "string" || !/^[a-f0-9]{64}$/.test(body.grant))
        throw new ModelError(400, "Нужно одноразовое разрешение.");
      const operation = await service.enqueue(owner, action, body.expected, body.grant);
      // Child gets only durable operation ID. It must independently claim it once.
      void (options.launch ? options.launch(operation) : startCutoverWorker(operation, d => service.diagnostic(operation, d)))
        .catch(error => service.fail(operation, error).catch(() => undefined));
      return res.status(202).json({ operation, state: "queued" });
    } catch (e) {
      const status = e instanceof ModelError ? e.status : 409;
      return res.status(status).json({ error: status === 423 ? "Запись или включение временно закрыты." :
        "Операция не подтверждена. Проверьте статус; не отправляйте повторно вслепую." });
    }
  });
}
