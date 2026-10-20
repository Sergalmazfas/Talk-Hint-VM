import express, { type Express, type Request, type Response, type RequestHandler, type NextFunction } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { BrowserSecurity, WEB_TTL, BROWSER_REFERRER_POLICY, browserFormAction } from "./browserSecurity";
import { renderBrowserPage, type BrowserPage } from "./browserViews";
import { digest, fail, grantScopes, markerId, type Credentials, type MarkerStore, type Scope } from "./security";
import type { CallConfirmations } from "./confirmations";
import type { IntegrationConfig } from "./routes";
import type { SecretaryBackend } from "./secretary";
import type { HistoryRow } from "./secretaryHistoryViews";
import type { SavedTaskEvent } from "./savedEvents";

export interface AuthorizationRequest {
  response_type: "code"; client_id: string; redirect_uri: string; resource: string;
  scope: string; state: string; code_challenge?: string; code_challenge_method?: "S256";
}
export interface BrowserAuth {
  login(email: string, password: string): Promise<{ id: string; email?: string }>;
}
interface OwnerTicket { kind: "owner"; sub: string; label: string; exp: number; browser: string }
interface Flow {
  kind: "flow"; purpose: "oauth" | "call" | "manage" | "history" | "detail"; exp: number; browser: string; nonce: string;
  authorization?: AuthorizationRequest; confirmation?: string;
  recordType?: "task" | "call"; recordId?: string; includeTranscript?: boolean;
}
interface ApprovalLink { kind: "approval-link"; confirmation: string; exp: number }

/** Isolated browser surface. Never receives or calls a dialer. */
export function registerBrowserIntegration(app: Express, config: IntegrationConfig, store: MarkerStore,
  credentials: Credentials, confirmations: CallConfirmations, ownerAuth: RequestHandler,
  auth: BrowserAuth, backend: SecretaryBackend, oauth: {
    validate(query: unknown): AuthorizationRequest;
    scopes(value: string): Scope[];
    finish(owner: string, request: AuthorizationRequest, allow: boolean): Promise<string>;
  }) {
  const api = config.actions ? "/api/chatgpt-actions" : "/api/chatgpt";
  const security = new BrowserSecurity(config.signingKey, config.origin, config.actions ? config.clientId : "");
  const grantsFor = async (userId: string) => (await store.list(userId)).filter(g =>
    !config.actions || g.id.startsWith(`chatgpt:grant:${digest(config.clientId)}:`));
  const attempts = new Map<string, { count: number; until: number }>();
  const form = express.urlencoded({ extended: false, limit: "32kb" });
  app.use([`${api}/browser`, `${api}/secretary`, `${api}/approve`, `${api}/oauth/authorize`,
    `${api}/connections/manage`], (_req, res, next) => {
    res.set({ "Referrer-Policy": BROWSER_REFERRER_POLICY, "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY" });
    next();
  });
  const page = (res: Response, model: BrowserPage, status = 200) => {
    const nonce = randomBytes(18).toString("base64url");
    return res.status(status).set({
      "Cache-Control": "no-store",
      "Referrer-Policy": BROWSER_REFERRER_POLICY,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action ${browserFormAction(model.kind === "consent" ? config.redirectUri : undefined)}; base-uri 'none'; frame-ancestors 'none'`,
      "Permissions-Policy": "microphone=(), camera=(), geolocation=()",
    }).type("html").send(renderBrowserPage(model, nonce, api));
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
  const makeFlow = (req: Request, res: Response, fields: Pick<Flow, "purpose" | "authorization" | "confirmation" |
    "recordType" | "recordId" | "includeTranscript">) =>
    security.seal({ kind: "flow", ...fields, nonce: randomUUID(), exp: Date.now() + WEB_TTL,
      browser: digest(security.binding(req, res)) });
  const readFlow = (req: Request, token: unknown, purpose?: Flow["purpose"]) => {
    const flow = security.open<Flow>(token, "flow");
    if (flow.browser !== digest(security.binding(req)) ||
        !["oauth", "call", "manage", "history", "detail"].includes(flow.purpose) ||
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
    if (config.actions && owner.sub !== config.actions.ownerId) return;
    const marker = await store.get(markerId(raw));
    return marker?.userId === owner.sub ? owner : undefined;
  };
  const requireOwner = async (req: Request) => await readOwner(req) ?? fail(401, "Sign in required");
  const setOwner = async (req: Request, res: Response, user: { id: string; email?: string }) => {
    if (config.actions && user.id !== config.actions.ownerId) return fail(403, "Owner access required");
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
  const text = (value: unknown): string => value instanceof Date ? value.toISOString() :
    typeof value === "string" ? value : "";
  const historyRow = (row: Record<string, unknown>): HistoryRow => ({
    id: text(row.id), status: text(row.status),
    phoneNumber: text(row.phoneNumber) || `${text(row.fromNumber)} → ${text(row.toNumber)}`,
    summary: text(row.summary) || "Сохранённого итога нет.",
    createdAt: text(row.createdAt ?? row.startedAt), updatedAt: text(row.updatedAt ?? row.endedAt),
  });
  const review = async (req: Request, res: Response, token: string) => {
    const flow = readFlow(req, token);
    const owner = await readOwner(req);
    if (!owner) return page(res, { kind: "login", ...fields(req, token) });
    const common = { ...fields(req, token), account: owner.label };
    if (flow.purpose === "history") {
      const [tasks, calls] = await Promise.all([backend.tasks(owner.sub), backend.history(owner.sub)]);
      return page(res, { kind: "secretary-history", ...common,
        tasks: tasks.map(historyRow), calls: calls.map(historyRow) });
    }
    if (flow.purpose === "detail") {
      const id = z.string().min(1).max(256).parse(flow.recordId);
      const type = z.enum(["task", "call"]).parse(flow.recordType);
      const includeTranscript = flow.includeTranscript === true;
      // Owner is derived only from the protected browser session. Neither URL
      // identifiers nor an MCP access token may select another account.
      const record = await (type === "task" ? backend.task(owner.sub, id, includeTranscript) :
        backend.call(owner.sub, id, includeTranscript)) as Record<string, unknown>;
      return page(res, { kind: "secretary-detail", ...common, recordType: type, ...historyRow(record),
        instruction: text(record.instruction), summary: text(record.summary) || "Сохранённого итога нет.",
        outcome: text(record.outcome), nextStep: text(record.nextStep),
        facts: Array.isArray(record.verifiedFacts) ? record.verifiedFacts.filter(v => typeof v === "string") : [],
        events: Array.isArray(record.events) ? record.events as SavedTaskEvent[] : [],
        ...(includeTranscript ? { transcript: text(record.transcript),
          turns: Array.isArray(record.transcriptTurns) ? record.transcriptTurns.map(turn => ({
            id: text(turn.id), role: text(turn.role), text: text(turn.text),
          })) : [] } : {}),
      });
    }
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
    return page(res, { kind: "connections", ...common, connections: (await grantsFor(owner.sub)).map(row =>
      ({ id: row.id, scopes: grantScopes(row.id), expiresAt: row.expiresAt.toISOString() })) });
  };
  const reviewURL = (token: string) => `${api}/browser/review?flow=${encodeURIComponent(token)}`;

  // Non-HTML clients retain the existing owner-authenticated authorization API.
  app.get(`${api}/oauth/authorize`, (req, res, next) => {
    if (!req.headers.accept?.includes("text/html")) return next();
    wrap(async (req, res) => {
      const authorization = oauth.validate(req.query); // Validate before rendering or redirecting.
      oauth.scopes(authorization.scope);
      const token = makeFlow(req, res, { purpose: "oauth", authorization });
      // A new binding cookie is not reflected in req until the next request.
      res.redirect(303, reviewURL(token));
    })(req, res, next);
  });
  app.get(`${api}/approve`, wrap(async (req, res) => {
    const link = security.open<ApprovalLink>(req.query.ticket, "approval-link");
    await confirmations.inspect(link.confirmation); // Fail closed in the read-only stage.
    const token = makeFlow(req, res, { purpose: "call", confirmation: link.confirmation });
    res.redirect(303, reviewURL(token));
  }));
  app.get(`${api}/connections/manage`, wrap(async (req, res) => {
    const token = makeFlow(req, res, { purpose: "manage" });
    res.redirect(303, reviewURL(token));
  }));
  app.get(`${api}/secretary`, wrap(async (req, res) => {
    res.redirect(303, reviewURL(makeFlow(req, res, { purpose: "history" })));
  }));
  for (const type of ["task", "call"] as const) {
    app.get(`${api}/secretary/${type}s/:id`, wrap(async (req, res) => {
      const id = z.string().min(1).max(256).parse(req.params.id);
      const transcript = z.enum(["true", "false"]).optional().parse(req.query.transcript);
      res.redirect(303, reviewURL(makeFlow(req, res, { purpose: "detail",
        recordType: type, recordId: id, includeTranscript: transcript === "true" })));
    }));
  }
  app.get(`${api}/browser/review`, wrap(async (req, res) => {
    const token = z.string().max(24000).parse(req.query.flow);
    return review(req, res, token);
  }));
  app.post(`${api}/browser/login`, form, wrap(async (req, res) => {
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
  app.post(`${api}/browser/session`, wrap(async (req, _res, next) => {
    post(req);
    next();
  }), ownerAuth, wrap(async (req, res) => {
    const { token } = post(req);
    if (!req.user?.id) return fail(401, "Owner required");
    await setOwner(req, res, req.user);
    res.json({ next: reviewURL(token) });
  }));
  app.post(`${api}/browser/consent`, form, wrap(async (req, res) => {
    const { token, flow } = post(req, "oauth");
    const { decision } = z.object({ flow: z.string(), csrf: z.string(),
      decision: z.enum(["allow", "deny"]) }).strict().parse(req.body);
    const owner = await requireOwner(req);
    await consumeReview(owner, token);
    const target = await oauth.finish(owner.sub, oauth.validate(flow.authorization), decision === "allow");
    res.redirect(303, target);
  }));
  app.post(`${api}/browser/approve`, form, wrap(async (req, res) => {
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
  app.post(`${api}/browser/revoke`, form, wrap(async (req, res) => {
    const { token } = post(req, "manage");
    const { id } = z.object({ flow: z.string(), csrf: z.string(), id: z.string().max(256) }).strict().parse(req.body);
    const owner = await requireOwner(req);
    if (!(await grantsFor(owner.sub)).some(row => row.id === id)) return fail(404, "Connection not found");
    await store.expire(id, owner.sub);
    res.redirect(303, reviewURL(token));
  }));
  app.post(`${api}/browser/logout`, form, wrap(async (req, res) => {
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
      return `${config.origin}${api}/approve?ticket=${encodeURIComponent(
        security.seal({ kind: "approval-link", exp, confirmation }))}`;
    },
  };
}
