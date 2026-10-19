import express, { type Express, type Request, type Response, type RequestHandler, type NextFunction } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { BrowserSecurity, WEB_TTL } from "./browserSecurity";
import { renderBrowserPage, type BrowserPage } from "./browserViews";
import { digest, fail, grantScopes, markerId, type Credentials, type MarkerStore, type Scope } from "./security";
import type { CallConfirmations } from "./confirmations";
import type { IntegrationConfig } from "./routes";

export interface AuthorizationRequest {
  response_type: "code"; client_id: string; redirect_uri: string; resource: string;
  scope: string; state: string; code_challenge: string; code_challenge_method: "S256";
}
export interface BrowserAuth {
  login(email: string, password: string): Promise<{ id: string; email?: string }>;
}
interface OwnerTicket { kind: "owner"; sub: string; label: string; exp: number; browser: string }
interface Flow {
  kind: "flow"; purpose: "oauth" | "call" | "manage"; exp: number; browser: string; nonce: string;
  authorization?: AuthorizationRequest; confirmation?: string;
}
interface ApprovalLink { kind: "approval-link"; confirmation: string; exp: number }

/** Isolated browser surface. Never receives or calls a dialer. */
export function registerBrowserIntegration(app: Express, config: IntegrationConfig, store: MarkerStore,
  credentials: Credentials, confirmations: CallConfirmations, ownerAuth: RequestHandler,
  auth: BrowserAuth, oauth: {
    validate(query: unknown): AuthorizationRequest;
    scopes(value: string): Scope[];
    finish(owner: string, request: AuthorizationRequest, allow: boolean): Promise<string>;
  }) {
  const security = new BrowserSecurity(config.signingKey, config.origin);
  const attempts = new Map<string, { count: number; until: number }>();
  const form = express.urlencoded({ extended: false, limit: "32kb" });
  app.use(["/api/chatgpt/browser", "/api/chatgpt/approve", "/api/chatgpt/oauth/authorize",
    "/api/chatgpt/connections/manage"], (_req, res, next) => {
    res.set({ "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY" });
    next();
  });
  const page = (res: Response, model: BrowserPage, status = 200) => {
    const nonce = randomBytes(18).toString("base64url");
    return res.status(status).set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      "Permissions-Policy": "microphone=(), camera=(), geolocation=()",
    }).type("html").send(renderBrowserPage(model, nonce));
  };
  const wrap = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
    (req, res, next) => { Promise.resolve().then(() => fn(req, res, next)).catch(error => {
      if (res.headersSent) return;
      const code = error instanceof z.ZodError ? 400 : Number(error?.status) || 503;
      page(res, { kind: "status", title: "Действие не выполнено",
        message: code >= 500 ? "Сервис временно недоступен. Действие не выполнялось; начните подключение заново." :
          "Запрос недействителен, истёк или не принадлежит этому аккаунту. Начните заново. Не повторяйте набор номера." },
      code >= 400 && code <= 503 ? code : 503);
    }); };
  const makeFlow = (req: Request, res: Response, fields: Pick<Flow, "purpose" | "authorization" | "confirmation">) =>
    security.seal({ kind: "flow", ...fields, nonce: randomUUID(), exp: Date.now() + WEB_TTL,
      browser: digest(security.binding(req, res)) });
  const readFlow = (req: Request, token: unknown, purpose?: Flow["purpose"]) => {
    const flow = security.open<Flow>(token, "flow");
    if (flow.browser !== digest(security.binding(req)) ||
        !["oauth", "call", "manage"].includes(flow.purpose) ||
        (purpose && flow.purpose !== purpose)) return fail(403, "Wrong browser flow");
    return flow;
  };
  const readOwner = async (req: Request): Promise<OwnerTicket | undefined> => {
    const raw = security.ownerCookie(req);
    if (!raw) return;
    let owner: OwnerTicket;
    try { owner = security.open<OwnerTicket>(raw, "owner"); }
    catch (error: any) { if (error.status >= 500) throw error; return; }
    if (owner.browser !== digest(security.binding(req))) return;
    const marker = await store.get(markerId(raw));
    return marker?.userId === owner.sub ? owner : undefined;
  };
  const requireOwner = async (req: Request) => await readOwner(req) ?? fail(401, "Sign in required");
  const setOwner = async (req: Request, res: Response, user: { id: string; email?: string }) => {
    const prior = security.ownerCookie(req);
    if (prior) await store.consume(markerId(prior));
    const exp = Date.now() + WEB_TTL;
    const token = security.seal({ kind: "owner", sub: user.id, label: user.email || user.id, exp,
      browser: digest(security.binding(req)) });
    await store.put({ id: markerId(token), userId: user.id, expiresAt: new Date(exp) });
    security.setOwner(res, token);
  };
  const fields = (req: Request, token: string) => ({
    flow: token, csrf: security.csrf(security.binding(req), token, security.ownerCookie(req)),
  });
  const post = (req: Request, purpose?: Flow["purpose"]) => {
    const token = z.string().max(24000).parse(req.body?.flow);
    security.checkPost(req, token, req.body?.csrf);
    return { token, flow: readFlow(req, token, purpose) };
  };
  const claimReview = async (owner: OwnerTicket, token: string, exp: number) => {
    const id = markerId(`web-review:${token}`);
    const existing = await store.get(id);
    if (existing && existing.userId !== owner.sub) return fail(403, "Owner changed");
    await store.put({ id, userId: owner.sub, expiresAt: new Date(exp) });
  };
  const consumeReview = async (owner: OwnerTicket, token: string) => {
    const id = markerId(`web-review:${token}`);
    if ((await store.get(id))?.userId !== owner.sub) return fail(403, "Review required");
    if (!(await store.consume(id))) return fail(409, "Review already submitted");
  };
  const review = async (req: Request, res: Response, token: string) => {
    const flow = readFlow(req, token);
    const owner = await readOwner(req);
    if (!owner) return page(res, { kind: "login", ...fields(req, token) });
    const common = { ...fields(req, token), account: owner.label };
    if (flow.purpose === "oauth") {
      const authorization = oauth.validate(flow.authorization);
      const scopes = oauth.scopes(authorization.scope);
      await claimReview(owner, token, flow.exp);
      return page(res, { kind: "consent", ...common, scopes });
    }
    if (flow.purpose === "call") {
      const { claims, approved } = await confirmations.inspect(flow.confirmation!, owner.sub);
      await claimReview(owner, token, flow.exp);
      return page(res, { kind: "approval", ...common, ...claims.call!,
        expiresAt: new Date(claims.exp).toISOString(), approved });
    }
    return page(res, { kind: "connections", ...common, connections: (await store.list(owner.sub)).map(row =>
      ({ id: row.id, scopes: grantScopes(row.id), expiresAt: row.expiresAt.toISOString() })) });
  };
  const reviewURL = (token: string) => `/api/chatgpt/browser/review?flow=${encodeURIComponent(token)}`;

  // Non-HTML clients retain the existing owner-authenticated authorization API.
  app.get("/api/chatgpt/oauth/authorize", (req, res, next) => {
    if (!req.headers.accept?.includes("text/html")) return next();
    wrap(async (req, res) => {
      const authorization = oauth.validate(req.query); // Validate before rendering or redirecting.
      oauth.scopes(authorization.scope);
      const token = makeFlow(req, res, { purpose: "oauth", authorization });
      // A new binding cookie is not reflected in req until the next request.
      res.redirect(303, reviewURL(token));
    })(req, res, next);
  });
  app.get("/api/chatgpt/approve", wrap(async (req, res) => {
    const link = security.open<ApprovalLink>(req.query.ticket, "approval-link");
    await confirmations.inspect(link.confirmation); // Fail closed in the read-only stage.
    const token = makeFlow(req, res, { purpose: "call", confirmation: link.confirmation });
    res.redirect(303, reviewURL(token));
  }));
  app.get("/api/chatgpt/connections/manage", wrap(async (req, res) => {
    const token = makeFlow(req, res, { purpose: "manage" });
    res.redirect(303, reviewURL(token));
  }));
  app.get("/api/chatgpt/browser/review", wrap(async (req, res) => {
    const token = z.string().max(24000).parse(req.query.flow);
    return review(req, res, token);
  }));
  app.post("/api/chatgpt/browser/login", form, wrap(async (req, res) => {
    const { token } = post(req);
    const input = z.object({ flow: z.string(), csrf: z.string(),
      email: z.string().email().max(254), password: z.string().min(1).max(1024) }).strict().parse(req.body);
    const key = req.ip || "unknown";
    const current = attempts.get(key);
    if (current && current.until > Date.now() && current.count >= 5) return fail(429, "Try later");
    if (!current || current.until <= Date.now()) {
      if (attempts.size >= 1024) attempts.clear();
      attempts.set(key, { count: 1, until: Date.now() + 5 * 60_000 });
    } else current.count++;
    let user: { id: string; email?: string };
    try { user = await auth.login(input.email, input.password); }
    catch { return page(res, { kind: "login", ...fields(req, token),
      message: "Вход не выполнен. Проверьте данные или войдите через существующий TalkHint." }, 401); }
    await setOwner(req, res, user);
    res.redirect(303, reviewURL(token));
  }));
  // Exchange the already existing same-origin TalkHint login, never an MCP token.
  app.post("/api/chatgpt/browser/session", wrap(async (req, _res, next) => {
    post(req);
    next();
  }), ownerAuth, wrap(async (req, res) => {
    const { token } = post(req);
    if (!req.user?.id) return fail(401, "Owner required");
    await setOwner(req, res, req.user);
    res.json({ next: reviewURL(token) });
  }));
  app.post("/api/chatgpt/browser/consent", form, wrap(async (req, res) => {
    const { token, flow } = post(req, "oauth");
    const { decision } = z.object({ flow: z.string(), csrf: z.string(),
      decision: z.enum(["allow", "deny"]) }).strict().parse(req.body);
    const owner = await requireOwner(req);
    await consumeReview(owner, token);
    const target = await oauth.finish(owner.sub, oauth.validate(flow.authorization), decision === "allow");
    res.redirect(303, target);
  }));
  app.post("/api/chatgpt/browser/approve", form, wrap(async (req, res) => {
    const { token, flow } = post(req, "call");
    const { decision } = z.object({ flow: z.string(), csrf: z.string(),
      decision: z.enum(["approve", "deny"]) }).strict().parse(req.body);
    const owner = await requireOwner(req);
    await confirmations.inspect(flow.confirmation!, owner.sub);
    await consumeReview(owner, token);
    if (decision === "approve") await confirmations.approve(flow.confirmation!, owner.sub);
    else await confirmations.deny(flow.confirmation!, owner.sub);
    return page(res, { kind: "status",
      title: decision === "approve" ? "Один вызов одобрен" : "Вызов отклонён",
      message: decision === "approve" ?
        "Номер не набирался. Вернитесь в ChatGPT: он сможет запросить запуск только этого задания до истечения подтверждения." :
        "Разрешение на этот запрос не выдано. Номер не набирался." });
  }));
  app.post("/api/chatgpt/browser/revoke", form, wrap(async (req, res) => {
    const { token } = post(req, "manage");
    const { id } = z.object({ flow: z.string(), csrf: z.string(), id: z.string().max(256) }).strict().parse(req.body);
    const owner = await requireOwner(req);
    if (!(await store.list(owner.sub)).some(row => row.id === id)) return fail(404, "Connection not found");
    await store.expire(id, owner.sub);
    res.redirect(303, reviewURL(token));
  }));
  app.post("/api/chatgpt/browser/logout", form, wrap(async (req, res) => {
    post(req);
    const raw = security.ownerCookie(req);
    if (raw) await store.consume(markerId(raw));
    security.clearOwner(res);
    return page(res, { kind: "status", title: "Web-сеанс завершён",
      message: "Вы вышли из страницы подключения. Сеанс iOS и разрешения ChatGPT не изменены; разрешения отзываются отдельно." });
  }));
  return {
    approvalURL(confirmation: string) {
      const { exp } = credentials.read(confirmation, "confirmation");
      return `${config.origin}/api/chatgpt/approve?ticket=${encodeURIComponent(
        security.seal({ kind: "approval-link", exp, confirmation }))}`;
    },
  };
}
