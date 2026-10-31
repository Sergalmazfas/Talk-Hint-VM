import express, { type Express, type RequestHandler } from "express";
import { createHash, randomBytes } from "node:crypto";
import { equalCsrf, ProductCrewOwnerKey } from "./ownerKey";
import type { MarkerStore } from "../chatgpt/security";

/** Browser-session only: a key/OAuth bearer can never issue another key. */
export function registerOwnerKeyRoutes(app: Express, options: {
  origin: string;
  owner: string;
  admin: RequestHandler;
  keys: ProductCrewOwnerKey;
  csrfStore: MarkerStore;
  authorizedOwner: (owner: string) => Promise<boolean>;
}) {
  const base = "/api/admin/product-crew/owner-key";
  const marker = (token: string) => `productcrew:key-csrf:${createHash("sha256").update(token).digest("hex")}`;
  const guard: RequestHandler = (req, res, next) => {
    res.set({
      "Cache-Control": "no-store, private", "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    });
    if (!req.isAuthenticated?.() || !req.session || req.user?.id !== options.owner ||
        req.get("authorization") || req.get("x-api-key"))
      return void res.status(403).json({ error: "Требуется браузерная сессия владельца." });
    Promise.resolve(options.authorizedOwner(req.user.id)).then(allowed => {
      if (!allowed) return void res.status(403).json({ error: "Доступ владельца закрыт." });
      next();
    }).catch(() => res.status(503).json({ error: "Проверка владельца недоступна." }));
  };
  const safe = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): RequestHandler =>
    (req, res) => { Promise.resolve(fn(req, res)).catch(() => {
      // Never emit storage/driver messages, headers, bodies or generated keys.
      res.status(503).json({ error: "Операция не подтверждена. Обновите статус; не повторяйте создание автоматически." });
    }); };
  app.use(base, options.admin, guard);
  app.get(base, safe(async (req, res) => {
    const session = req.session as any;
    session.productCrewKeyCsrf = randomBytes(32).toString("hex");
    await options.csrfStore.put({ id: marker(session.productCrewKeyCsrf),
      userId: options.owner, expiresAt: new Date(Date.now() + 600000) });
    await new Promise<void>((resolve, reject) => req.session!.save(e => e ? reject(e) : resolve()));
    res.json({ status: await options.keys.status(), csrfToken: session.productCrewKeyCsrf,
      header: "X-API-Key", environment: "production", model: "new-country", lifetimeDays: 90 });
  }));
  const mutation: RequestHandler = (req, res, next) => {
    if (req.get("origin") !== options.origin || req.get("sec-fetch-site") === "cross-site" ||
        !equalCsrf(req.get("x-product-key-csrf"), (req.session as any).productCrewKeyCsrf))
      return void res.status(403).json({ error: "Origin/CSRF подтверждение не совпало." });
    if (!req.is("application/json") || req.body?.confirm !== true ||
        Object.keys(req.body).some(k => k !== "confirm"))
      return void res.status(400).json({ error: "Требуется явное подтверждение владельца." });
    next();
  };
  // Dedicated action CSRF tokens are consumed before the operation and saved.
  // A stale/replayed request fails rather than rotating a newly issued key.
  const consume = async (req: express.Request) => {
    const row = await options.csrfStore.consume(marker(req.get("x-product-key-csrf")!));
    if (!row || row.userId !== options.owner) return false;
    delete (req.session as any).productCrewKeyCsrf;
    await new Promise<void>((resolve, reject) => req.session!.save(e => e ? reject(e) : resolve()));
    return true;
  };
  app.post(base, express.json({ limit: "1kb" }), mutation, safe(async (req, res) => {
    if (!await consume(req)) return res.status(403).json({ error: "Подтверждение уже использовано или истекло. Обновите статус." });
    const issued = await options.keys.create();
    res.status(201).json(issued); // The sole response containing the raw key.
  }));
  app.post(`${base}/revoke`, express.json({ limit: "1kb" }), mutation, safe(async (req, res) => {
    if (!await consume(req)) return res.status(403).json({ error: "Подтверждение уже использовано или истекло. Обновите статус." });
    await options.keys.revoke();
    res.json({ revoked: true });
  }));
}
