import express, { type Express, type Request, type Response, type RequestHandler } from "express";
import { z } from "zod";
import { activeGrant, Credentials, digest, fail, grantId, grantScopes, markerId, parseScopes,
  SCOPES, MCP_BASE_SCOPES, type Claims, type MarkerStore, type Scope } from "./security";
import type { SecretaryBackend } from "./secretary";
import { registerBrowserIntegration, type BrowserAuth, type AuthorizationRequest } from "./browser";
import { CallConfirmations } from "./confirmations";
import { talkHintPluginPackage } from "./plugin";
import { PUBLIC_TOOLS, publicToolMetadata, cardApprovalToolMetadata, monitorToolMetadata, type PublicTool } from "./toolMetadata";
import { callPresentation } from "./callPresentation";
import { CallMonitor, MONITOR_SCOPES } from "./monitor";
import { selectCallTurns } from "./turns";
import { CardApproval } from "./cardApproval";
import { CALL_APPROVAL_RESOURCE, callApprovalWidgetHtml } from "./callApprovalWidget";
import { callApprovalResource, hostUiSupport, LEGACY_CALL_APPROVAL_RESOURCES, uiResourceLabel } from "./uiResources";
import { packagedSecretarySkills, secretaryInstructions, TALKHINT_MCP_VERSION, TALKHINT_PLUGIN_VERSION } from "./pluginWorkflow";
import { actionsExchange } from "./actionsOAuth";
import { talkHintActionsSchema, registerActionOperations } from "./actionsSchema";

export interface IntegrationConfig {
  enabled: boolean; origin: string; clientId: string; redirectUri: string;
  signingKey: () => string;
  /** Stage one is read-only. Never infer dialing permission from token scopes. */
  outboundEnabled?: boolean;
  /** Optional transport-specific scope ceiling. It can only remove capabilities. */
  allowedScopes?: readonly Scope[];
  /** Separate confidential client and audience. Never enable by inference from MCP. */
  actions?: { ownerId: string; clientSecret: () => string };
}
const CALL = z.object({
  phoneNumber: z.string().regex(/^\+1[2-9]\d{9}$/),
  instruction: z.string().trim().min(1).max(2000),
  clientRequestId: z.string().uuid(),
  voiceProvider: z.enum(["openai", "elevenlabs", "cartesia"]).default("openai"),
  translationLanguage: z.enum(["ru", "es"]).default("ru"),
}).strict();
const CARD_DECISION = z.object({
  confirmation: z.string().max(16000), approvalToken: z.string().max(16000),
  decision: z.enum(["approve", "deny"]),
}).strict();
const ID = z.string().min(1).max(256);
const schemas = {
  get_profile: z.object({}).strict(),
  list_calls: z.object({}).strict(),
  get_call: z.object({ id: ID, includeTranscript: z.boolean().default(false) }).strict(),
  list_tasks: z.object({}).strict(),
  get_task: z.object({ id: ID, includeTranscript: z.boolean().default(false) }).strict(),
  read_call_turns: z.object({ id: ID, afterTurnId: ID.optional(), limit: z.number().int().min(1).max(50).default(30) }).strict(),
  get_incoming: z.object({}).strict(),
  prepare_call: CALL.extend({ recipient: z.string().trim().min(1).max(200).optional() }),
  start_call: z.object({ confirmation: z.string().max(16000) }).strict(),
};
type Tool = keyof typeof schemas;
const permissions: Record<Tool, Scope> = {
  get_profile: "calls:read", list_calls: "calls:read", get_call: "calls:read",
  list_tasks: "calls:read", get_task: "calls:read", get_incoming: "incoming:read",
  prepare_call: "secretary:start", start_call: "secretary:start",
  read_call_turns: "calls:transcript",
};
const uuidPattern = /^[a-f0-9-]{36}$/i;
const TOKEN_MS = 10 * 60_000;
const GRANT_MS = 30 * 24 * 60 * 60_000;
const CONFIRM_MS = 10 * 60_000;
const TOOL_INPUTS: Record<Tool, object> = {
  get_profile: {}, list_calls: {}, list_tasks: {}, get_incoming: {},
  get_call: { id: { type: "string" }, includeTranscript: { type: "boolean", default: false } },
  get_task: { id: { type: "string" }, includeTranscript: { type: "boolean", default: false } },
  read_call_turns: { id: { type: "string" }, afterTurnId: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 50, default: 30 } },
  prepare_call: {
    recipient: { type: "string", minLength: 1, maxLength: 200,
      description: "Recipient name supplied by the owner, never inferred from phone number." },
    phoneNumber: { type: "string", pattern: "^\\+1[2-9]\\d{9}$" },
    instruction: { type: "string", minLength: 1, maxLength: 2000 },
    clientRequestId: { type: "string", format: "uuid" },
    voiceProvider: { type: "string", enum: ["openai"], default: "openai",
      description: "GPT-Live 1 with built-in marin voice; reasoning gpt-6.1-sol. No fallback. Legacy providers are retained only for history/compatibility." },
    translationLanguage: { type: "string", enum: ["ru", "es"] },
  },
  start_call: { confirmation: { type: "string" } },
};

/**
 * Isolated browser/API owner approvals, never approvals by an MCP credential.
 * Existing native UI and telephone composition remain unchanged.
 */
export function registerChatGPTIntegration(
  app: Express, config: IntegrationConfig, store: MarkerStore, backend: SecretaryBackend,
  // Injected test servers must not load the native DB/auth/provider graph.
  // Native composition retains exactly the same auth, loaded only when needed.
  ownerAuth: RequestHandler = (req, res, next) => {
    void import("../auth").then(({ authMiddleware }) => authMiddleware(req, res, next)).catch(next);
  },
  browserAuth: BrowserAuth = {
    login: async (email, password) => (await import("../auth")).loginUser(email, password),
  },
): void {
  const base = config.origin;
  const api = config.actions ? "/api/chatgpt-actions" : "/api/chatgpt";
  const resource = `${base}${api}${config.actions ? "" : "/mcp"}`;
  const scopesSupported = (config.outboundEnabled === true ? [...SCOPES] :
    SCOPES.filter(scope => scope !== "secretary:start" && scope !== "incoming:read"))
    .filter(scope => (!config.actions || scope !== "incoming:read") &&
      (!config.allowedScopes || config.allowedScopes.includes(scope)));
  // MCP clients fall back to ALL protected-resource scopes when a challenge
  // omits scope. Advertise only baseline rights, not every incremental capability.
  // The authorization/consent validator still accepts explicit supported upgrades.
  const discoveryScopes = [...MCP_BASE_SCOPES];
  const availableTools = (Object.keys(schemas) as Tool[]).filter(name =>
    scopesSupported.includes(permissions[name]));
  // Preserve the existing owner REST API, but do not expose incoming controls
  // or undocumented operations through the public plugin.
  const mcpTools = availableTools.filter((name): name is PublicTool =>
    (PUBLIC_TOOLS as readonly string[]).includes(name));
  const credentials = new Credentials(config.signingKey, resource);
  const confirmations = new CallConfirmations(credentials, store,
    () => config.outboundEnabled === true, config.clientId);
  const cardApproval = new CardApproval(credentials, store, confirmations);
  const cardEnabled = !config.actions && availableTools.includes("prepare_call");
  const monitorEnabled = cardEnabled && MONITOR_SCOPES.every(s => scopesSupported.includes(s));
  const monitor = new CallMonitor(credentials, store, backend, base, () => config.enabled);
  if (!config.actions) monitor.register(app);
  const challenge = `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Connect your TalkHint account"` +
    (config.actions ? "" : `, scope="${MCP_BASE_SCOPES.join(" ")}"`);
  const scopeChallenge = (scope: Scope | readonly Scope[]) =>
    `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="Additional TalkHint permission required", scope="${config.actions ?
      (Array.isArray(scope) ? scope.join(" ") : scope) :
      Array.from(new Set([...MCP_BASE_SCOPES, ...(Array.isArray(scope) ? scope : [scope])])).join(" ")}"`;
  const resourceMetadataPaths = ["/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/api/chatgpt/mcp"];
  const paths = config.actions ? [api] :
    [api, ...resourceMetadataPaths, "/.well-known/oauth-authorization-server"];
  const setupPaths = new Set(["/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server",
    ...resourceMetadataPaths, "/api/chatgpt/plugin.json", "/api/chatgpt/mcp.json", "/api/chatgpt/readiness"]);
  const skills = packagedSecretarySkills(config.outboundEnabled === true);
  for (const file of Object.keys(skills)) setupPaths.add(`/api/chatgpt/${file}`);
  const buckets = new Map<string, { count: number; reset: number }>();
  app.use(paths, (req, res, next) => {
    res.set("Cache-Control", "no-store");
    let valid = false, callbackReady = false;
    try {
      valid = config.enabled && new URL(base).origin === base && base.startsWith("https://") &&
        !!config.clientId;
      if (config.actions) valid = valid && !!config.actions.ownerId &&
        config.actions.clientSecret().length >= 32 && !new URL(base).port;
    } catch { valid = false; /* Fail closed on incomplete deployment configuration. */ }
    if (!valid) return res.status(503).json({ error: "ChatGPT integration is disabled or not configured" });
    try {
      const callback = new URL(config.redirectUri);
      callbackReady = callback.protocol === "https:" && !callback.username && !callback.password && !callback.hash;
      if (config.actions) callbackReady = callbackReady &&
        ["https://chatgpt.com", "https://chat.openai.com"].includes(callback.origin) &&
        /^\/aip\/g-[A-Za-z0-9_-]+\/oauth\/callback$/.test(callback.pathname) && !callback.search;
    } catch { /* The exact callback may only become visible after the tool scan. */ }
    const requestPath = req.originalUrl.split("?")[0];
    const setupOnly = (req.method === "GET" &&
      (setupPaths.has(requestPath) || (!config.actions && requestPath === "/api/chatgpt/mcp") ||
        (config.actions && requestPath === `${api}/openapi.json`))) ||
      (req.method === "POST" && requestPath === "/api/chatgpt/mcp" &&
        ["initialize", "tools/list", "ping", "notifications/initialized"].includes(req.body?.method));
    // Advertise OAuth without executing ANY data operation while linking is
    // unconfigured (including requests bearing an old otherwise-valid token).
    const toolRequest = !config.actions && req.method === "POST" && requestPath === "/api/chatgpt/mcp" &&
      req.body?.method === "tools/call";
    if (!callbackReady && toolRequest) return res.status(401).set("WWW-Authenticate", challenge).json({
      jsonrpc: "2.0", id: req.body?.id ?? null,
      result: { isError: true, content: [{ type: "text",
        text: "OAuth setup pending: configure the exact callback shown by ChatGPT." }],
        _meta: { "mcp/www_authenticate": [challenge] } },
    });
    if (!callbackReady && !setupOnly)
      return res.status(503).json({ error: "Configure the exact ChatGPT OAuth callback before authorization" });
    // OAuth starts in another origin (including opaque iOS browser origins).
    // Only these HTML GETs may navigate here cross-origin; they still validate
    // the OAuth request / browser-bound flow. Never relax POST, data API or MCP
    // Origin checks, and do not grant cross-origin script access via CORS.
    const oauthNavigation = req.method === "GET" &&
      req.headers.accept?.includes("text/html") &&
      (requestPath === `${api}/oauth/authorize` || requestPath === `${api}/browser/review`);
    if (req.headers.origin && req.headers.origin !== base && !oauthNavigation)
      return res.status(403).json({ error: "Cross-origin request denied" });
    // Bounded, local abuse guard; not a substitute for edge/global rate limits.
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (bucket && bucket.reset > now && ++bucket.count > 120) {
      return res.set("Retry-After", "60").status(429).json({ error: "Rate limited" });
    }
    if (!bucket || bucket.reset <= now) {
      if (buckets.size >= 2048) buckets.clear();
      buckets.set(key, { count: 1, reset: now + 60_000 });
    }
    next();
  });
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler =>
    (req, res) => { Promise.resolve().then(() => fn(req, res)).catch(error => {
      const status = error instanceof z.ZodError ? 400 : Number(error?.status) || 503;
      if (status === 401) res.set("WWW-Authenticate", challenge);
      else if (error?.requiredScopes || error?.requiredScope)
        res.set("WWW-Authenticate", scopeChallenge(error.requiredScopes ?? error.requiredScope));
      if (res.headersSent) return;
      res.status(status >= 400 && status <= 503 ? status : 503).json({
        error: error instanceof z.ZodError ? "Invalid arguments" :
          status >= 400 && status < 500 ? error.message : "Integration temporarily unavailable",
      });
    }); };
  // OAuth errors are protocol values, never application messages or exceptions.
  const oauthWrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
    (req, res) => { Promise.resolve().then(() => fn(req, res)).catch(error => {
      if (res.headersSent) return;
      const unavailable = Number(error?.status) >= 500 || (!error?.status && !(error instanceof z.ZodError));
      const invalidClient = config.actions && error?.oauthCode === "invalid_client";
      if (invalidClient) res.set("WWW-Authenticate", 'Basic realm="TalkHint Actions"');
      res.status(unavailable ? 503 : invalidClient ? 401 : 400).json({
        error: unavailable ? "temporarily_unavailable" : error.oauthCode ??
          (error instanceof z.ZodError ? "invalid_request" : "invalid_grant"),
        ...(req.path.endsWith("/authorize") ? { iss: base } : {}),
      });
    }); };
  const oauthFail = (code: string): never => {
    throw Object.assign(new Error(code), { status: 400, oauthCode: code });
  };
  const permittedScopes = (value: unknown) => {
    let scopes: Scope[];
    try { scopes = parseScopes(value); } catch { return oauthFail("invalid_scope"); }
    if (scopes.some(scope => !scopesSupported.includes(scope))) return oauthFail("invalid_scope");
    return scopes;
  };
  const claimsFor = async (req: Request) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return fail(401, "Authorization required");
    const claims = credentials.read(header.slice(7), "access");
    if (claims.client !== config.clientId) return fail(401, "Invalid client");
    if (config.actions && claims.sub !== config.actions.ownerId) return fail(403, "Owner access required");
    await activeGrant(store, claims);
    return claims;
  };
  const need = (claims: Claims, scope: Scope) => {
    if (!claims.scopes.includes(scope)) throw Object.assign(new Error(`Required scope: ${scope}`),
      { status: 403, requiredScope: scope, requiredScopes: [...claims.scopes, scope] });
  };
  const owner = (req: Request) => {
    const id = req.user?.id ?? fail(401, "Owner authentication required");
    if (config.actions && id !== config.actions.ownerId) return fail(403, "Owner access required");
    return id;
  };
  const grantsFor = async (userId: string) => (await store.list(userId)).filter(g =>
    !config.actions || g.id.startsWith(`chatgpt:grant:${digest(config.clientId)}:`));
  const jsonOwner: RequestHandler = (req, res, next) => {
    if (!req.is("application/json")) return res.status(415).json({ error: "JSON required" });
    next();
  };

  if (!config.actions) {
  app.get(resourceMetadataPaths, (_req, res) => res.json({
    resource, authorization_servers: [base], scopes_supported: discoveryScopes,
  }));
  app.get("/.well-known/oauth-authorization-server", (_req, res) => res.json({
    issuer: base, authorization_endpoint: `${base}/api/chatgpt/oauth/authorize`,
    token_endpoint: `${base}/api/chatgpt/oauth/token`,
    revocation_endpoint: `${base}/api/chatgpt/oauth/revoke`,
    authorization_response_iss_parameter_supported: true,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"],
    scopes_supported: discoveryScopes,
  }));
  // Packaging aids only. Installation still requires the owner's ChatGPT
  // account, eligible workspace and OAuth consent; no listing is created here.
  app.get("/api/chatgpt/plugin.json", (_req, res) =>
    res.json(talkHintPluginPackage(base, config.outboundEnabled === true).manifest));
  for (const [file, content] of Object.entries(skills))
    app.get(`/api/chatgpt/${file}`, (_req, res) => res.type("text/plain").send(content));
  app.get("/api/chatgpt/mcp.json", (_req, res) =>
    res.json(talkHintPluginPackage(base, config.outboundEnabled === true).mcp));
  app.get("/api/chatgpt/readiness", (_req, res) => res.json({
    integration: "talkhint-secretary-mcp",
    mode: config.outboundEnabled === true ? "outbound" : "read-only",
    transport: "streamable-http", resource,
    registration: "provided", clientId: config.clientId, tokenEndpointAuthMethod: "none",
    callbackConfigured: Boolean(config.redirectUri),
    tools: mcpTools,
    pluginVersion: TALKHINT_PLUGIN_VERSION, mcpVersion: TALKHINT_MCP_VERSION,
    confirmationMethod: cardEnabled ? "inline_card" : "unavailable",
    ui: cardEnabled ? { resourceUri: CALL_APPROVAL_RESOURCE, mimeType: "text/html;profile=mcp-app",
      compatibleResourceUris: [...LEGACY_CALL_APPROVAL_RESOURCES],
      requiresMcpAppsHost: true, iphoneVerified: false } : undefined,
    uiTools: cardEnabled ? ["confirm_call_from_card", ...(monitorEnabled ? ["open_call_monitor"] : [])] : [],
    scopes: discoveryScopes,
    // No callback value, account details, signing keys or credentials.
  }));
  }

  app.post(`${api}/connections`, jsonOwner, ownerAuth, wrap(async (req, res) => {
    const input = z.object({ approved: z.literal(true), scope: z.string() }).strict().parse(req.body);
    const scopes = permittedScopes(input.scope);
    if ((await grantsFor(owner(req))).length >= 10) return fail(409, "Revoke an existing connection first");
    const id = grantId(config.clientId, scopes);
    const expiresAt = new Date(Date.now() + GRANT_MS);
    await store.put({ id, userId: owner(req), expiresAt });
    res.status(201).json({ id, scopes, expiresAt });
  }));
  app.get(`${api}/connections`, ownerAuth, wrap(async (req, res) => {
    res.json({ connections: (await grantsFor(owner(req))).map(row =>
      ({ id: row.id, scopes: grantScopes(row.id), expiresAt: row.expiresAt })) });
  }));
  app.post(`${api}/connections/revoke`, jsonOwner, ownerAuth, wrap(async (req, res) => {
    const { id } = z.object({ id: z.string().max(256) }).strict().parse(req.body);
    if (config.actions && !(await grantsFor(owner(req))).some(g => g.id === id)) return fail(404, "Connection not found");
    await store.expire(id, owner(req));
    res.json({ revoked: true, existingCallContinues: true });
  }));

  const authorizationQuery = (query: unknown): AuthorizationRequest => {
    if (config.actions) return z.object({
      response_type: z.literal("code"), client_id: z.literal(config.clientId),
      redirect_uri: z.literal(config.redirectUri), resource: z.literal(resource).default(resource),
      scope: z.string(), state: z.string().min(16).max(1024),
      code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
      code_challenge_method: z.literal("S256").optional(),
    }).refine(q => !!q.code_challenge === !!q.code_challenge_method).parse(query);
    return z.object({
      response_type: z.literal("code"), client_id: z.literal(config.clientId),
      redirect_uri: z.literal(config.redirectUri), resource: z.literal(resource),
      scope: z.string(), state: z.string().min(16).max(1024),
      code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal("S256"),
    }).parse(query);
  };
  const authorizationError = (q: AuthorizationRequest, error: string) => {
    const target = new URL(config.redirectUri);
    target.searchParams.set("error", error);
    target.searchParams.set("state", q.state);
    target.searchParams.set("iss", base);
    return target.toString();
  };
  const authorizationCode = async (userId: string, q: AuthorizationRequest, scopes: Scope[],
    grant: { id: string; expiresAt: Date }) => {
    const code = credentials.issue({ type: "code", sub: userId, grant: grant.id,
      scopes, client: config.clientId, redirect: q.redirect_uri, challenge: q.code_challenge,
      exp: Math.min(Date.now() + 60_000, grant.expiresAt.getTime()) });
    await store.put({ id: markerId(code), userId, expiresAt: new Date(Date.now() + 60_000) });
    const redirect = new URL(config.redirectUri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", q.state);
    redirect.searchParams.set("iss", base);
    return redirect.toString();
  };
  const browser = registerBrowserIntegration(app, config, store, credentials, confirmations, ownerAuth,
    browserAuth, backend, {
      validate: authorizationQuery, scopes: permittedScopes,
      async finish(userId, q, allow) {
        if (config.actions && userId !== config.actions.ownerId) return fail(403, "Owner access required");
        const scopes = permittedScopes(q.scope);
        if (!allow) return authorizationError(q, "access_denied");
        if ((await grantsFor(userId)).length >= 10) return fail(409, "Revoke an existing connection first");
        const grant = { id: grantId(config.clientId, scopes), userId, expiresAt: new Date(Date.now() + GRANT_MS) };
        await store.put(grant);
        return authorizationCode(userId, q, scopes, grant);
      },
    });

  app.get(`${api}/oauth/authorize`, ownerAuth, oauthWrap(async (req, res) => {
    const q = authorizationQuery(req.query);
    owner(req);
    let scopes: Scope[];
    try { scopes = permittedScopes(q.scope); }
    catch {
      return res.redirect(authorizationError(q, "invalid_scope"));
    }
    const grant = (await store.list(owner(req))).find(g =>
      g.id.startsWith(`chatgpt:grant:${digest(config.clientId)}:`) &&
      scopes.every(s => grantScopes(g.id).includes(s)));
    if (!grant) {
      return res.redirect(authorizationError(q, "access_denied"));
    }
    res.redirect(await authorizationCode(owner(req), q, scopes, grant));
  }));
  app.post(`${api}/oauth/token`, express.urlencoded({ extended: false, limit: "24kb" }), oauthWrap(async (req, res) => {
    if (config.actions) req.body = actionsExchange(req, config.clientId, config.actions.clientSecret(), resource);
    if (typeof req.body?.grant_type === "string" &&
        !["authorization_code", "refresh_token"].includes(req.body.grant_type)) oauthFail("unsupported_grant_type");
    if (req.body?.client_id !== config.clientId) oauthFail("invalid_client");
    if (req.body?.resource !== resource) oauthFail("invalid_target");
    const input = z.object({
      client_id: z.literal(config.clientId), resource: z.literal(resource),
      grant_type: z.enum(["authorization_code", "refresh_token"]),
      code: z.string().max(16000).optional(), refresh_token: z.string().max(16000).optional(),
      redirect_uri: z.string().optional(), code_verifier: z.string().optional(),
    }).strict().parse(req.body);
    const type = input.grant_type === "authorization_code" ? "code" : "refresh";
    const raw = type === "code" ? input.code : input.refresh_token;
    const old = credentials.read(raw, type);
    if (old.client !== input.client_id) return fail(401, "Invalid client");
    permittedScopes(old.scopes.join(" "));
    const grant = await activeGrant(store, old);
    if (config.actions && old.sub !== config.actions.ownerId) return fail(403, "Owner access required");
    if (type === "code" && (input.redirect_uri !== config.redirectUri ||
        old.redirect !== input.redirect_uri || ((!config.actions || old.challenge) &&
        (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier ?? "") ||
        digest(input.code_verifier!) !== old.challenge)))) return fail(400, "Invalid PKCE or redirect");
    if (type === "refresh" && !old.scopes.includes("offline_access")) return fail(401, "Refresh not allowed");
    if (!await store.consume(markerId(raw!))) {
      // A valid signed refresh token reused after rotation means the family
      // may be compromised. Fail closed, including the newest access token.
      if (type === "refresh") await store.expire(old.grant, old.sub);
      return fail(400, "Credential already used or expired");
    }
    const common = { sub: old.sub, grant: old.grant, scopes: old.scopes, client: old.client };
    const expiresAt = Math.min(Date.now() + TOKEN_MS, grant.expiresAt.getTime());
    const access = credentials.issue({ ...common, type: "access", exp: expiresAt });
    let refresh: string | undefined;
    if (old.scopes.includes("offline_access")) {
      refresh = credentials.issue({ ...common, type: "refresh", exp: grant.expiresAt.getTime() });
      await store.put({ id: markerId(refresh), userId: old.sub, expiresAt: grant.expiresAt });
    }
    res.json({ access_token: access, token_type: "Bearer", expires_in: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
      scope: old.scopes.join(" "), ...(refresh ? { refresh_token: refresh } : {}) });
  }));
  app.post(`${api}/oauth/revoke`, express.urlencoded({ extended: false, limit: "24kb" }), oauthWrap(async (req, res) => {
    if (config.actions) {
      const body = actionsExchange(req, config.clientId, config.actions.clientSecret(), resource);
      delete body.resource;
      req.body = body;
    }
    const { token } = z.object({ token: z.string().max(16000), token_type_hint: z.string().optional(),
      client_id: z.literal(config.clientId) }).strict().parse(req.body);
    let claims: Claims | undefined;
    for (const type of ["access", "refresh"] as const) {
      try { claims = credentials.read(token, type); break; } catch { /* RFC 7009 opaque invalid token response. */ }
    }
    if (claims?.client === config.clientId) await store.expire(claims.grant, claims.sub);
    res.status(200).json({});
  }));

  if (!config.actions) app.post(`${api}/confirmations/approve`, jsonOwner, ownerAuth, wrap(async (req, res) => {
    if (config.outboundEnabled !== true) return fail(403, "Outbound integration is disabled");
    const { confirmation } = z.object({ approved: z.literal(true), confirmation: z.string().max(16000) }).strict().parse(req.body);
    const claims = await confirmations.approve(confirmation, owner(req));
    res.json({ approved: true, call: claims.call, expiresAt: new Date(claims.exp) });
  }));

  async function execute(req: Request, name: Tool, raw: unknown) {
    const claims = await claimsFor(req);
    if (!(name in schemas)) return fail(404, "Unknown tool");
    if (!availableTools.includes(name)) return fail(403, "Tool is disabled for this integration stage");
    need(claims, permissions[name]);
    const args = schemas[name].parse(raw) as any;
    if (args.includeTranscript) need(claims, "calls:transcript");
    switch (name) {
      case "get_profile": return { id: claims.sub };
      case "list_calls": return { calls: await backend.history(claims.sub) };
      case "get_call": return backend.call(claims.sub, args.id, args.includeTranscript);
      case "list_tasks": return { tasks: await backend.tasks(claims.sub) };
      case "get_task": return backend.task(claims.sub, args.id, args.includeTranscript);
      case "get_incoming": return backend.incoming(claims.sub);
      case "read_call_turns":
        return selectCallTurns(await backend.task(claims.sub, args.id, true), args.afterTurnId, args.limit);
      case "prepare_call": {
        const { recipient, ...nativeArgs } = args;
        const call = CALL.parse(nativeArgs);
        if (!uuidPattern.test(call.clientRequestId)) return fail(400, "Invalid request ID");
        const confirmation = credentials.issue({ type: "confirmation", sub: claims.sub, grant: claims.grant,
          scopes: claims.scopes, client: claims.client, exp: Math.min(Date.now() + CONFIRM_MS, claims.exp), call,
          ...(recipient ? { recipient } : {}) });
        return { call, confirmation, expiresAt: new Date(credentials.read(confirmation, "confirmation").exp).toISOString(),
          status: "owner_approval_required",
          ...(!config.actions ? { approvalEndpoint: "/api/chatgpt/confirmations/approve" } : {}),
          approval_url: browser.approvalURL(confirmation),
          note: "Owner session and explicit review required. This tool has not placed a call." };
      }
      case "start_call": {
        const confirmed = credentials.read(args.confirmation, "confirmation");
        if (confirmed.sub !== claims.sub || confirmed.grant !== claims.grant ||
            !confirmed.call) return fail(403, "Confirmation does not belong to this connection");
        const { approved } = await confirmations.inspect(args.confirmation, claims.sub);
        if (!approved) return fail(403, "Explicit owner approval required");
        const result = await backend.start(claims.sub, CALL.parse(confirmed.call));
        return { ...result, task_id: result.task.id, asynchronous: true,
          note: "Read this task again for its outcome. Never redial because a response is delayed." };
      }
    }
  }
  if (config.actions) {
    app.get(`${api}/openapi.json`, (_req, res) => res.json(talkHintActionsSchema(base, config.outboundEnabled === true)));
    registerActionOperations(app, api, config.outboundEnabled === true, wrap, execute);
    return; // Never expose generic /tools/:name, MCP, or API self-approval in Actions.
  }
  // Restricted HTTP operations for testing/other approved adapters. This is
  // NOT a claim of GPT Actions OAuth compatibility (resource is mandatory).
  // No generic proxy endpoint and no ownerId input.
  app.post("/api/chatgpt/tools/:name", wrap(async (req, res) => {
    const name = req.params.name as Tool;
    if (!Object.hasOwn(schemas, name)) return fail(404, "Unknown tool");
    res.status(name === "start_call" ? 202 : 200).json(await execute(req, name, req.body));
  }));
  app.post("/api/chatgpt/mcp", wrap(async (req, res) => {
    const parsed = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number()]).optional(),
      method: z.string(), params: z.record(z.unknown()).optional() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ jsonrpc: "2.0", id: null,
      error: { code: -32600, message: "Invalid Request" } });
    const rpc = parsed.data;
    if (rpc.method === "notifications/initialized" && rpc.id === undefined) return res.status(202).end();
    if (rpc.id === undefined) return fail(400, "JSON-RPC request ID required");
    let result: unknown;
    if (rpc.method === "initialize") {
      // Do not log raw clientInfo, request IDs, headers, capabilities or arguments.
      console.info(`[TalkHint MCP UI] initialize ui=${hostUiSupport(rpc.params)} version=${TALKHINT_MCP_VERSION}`);
      result = {
      protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"].includes(String(rpc.params?.protocolVersion)) ?
        rpc.params!.protocolVersion : "2025-11-25",
      capabilities: { tools: {}, ...(cardEnabled ? { resources: {} } : {}) },
      serverInfo: { name: "talkhint-secretary", title: "TalkHint", version: TALKHINT_MCP_VERSION },
      instructions: secretaryInstructions(config.outboundEnabled === true),
      };
    }
    else if (rpc.method === "ping") result = {};
    else if (rpc.method === "resources/list") result = { resources: cardEnabled ? [{
      uri: CALL_APPROVAL_RESOURCE, name: "TalkHint call confirmation", mimeType: "text/html;profile=mcp-app",
    }] : [] };
    else if (rpc.method === "resources/templates/list") result = { resourceTemplates: [] };
    else if (rpc.method === "resources/read") {
      const uri = cardEnabled ? callApprovalResource(rpc.params?.uri) : undefined;
      console.info(`[TalkHint MCP UI] resource_read template=${uiResourceLabel(rpc.params?.uri)} result=${uri ? "ok" : "not-found"}`);
      if (!uri) return fail(404, "Resource not found");
      // Return the requested alias, not v4: hosts correlate contents to that URI.
      // The HTML is current; it still needs a valid owner-bound approval capability.
      result = { contents: [{ uri, mimeType: "text/html;profile=mcp-app",
        text: callApprovalWidgetHtml(), _meta: { ui: { prefersBorder: true,
          csp: { connectDomains: [base], resourceDomains: [] } },
          "openai/widgetCSP": { connect_domains: [base], resource_domains: [], redirect_domains: [base] },
          "openai/widgetDescription": "Review the exact call and explicitly confirm once, without leaving this chat.",
        } }] };
    }
    else if (rpc.method === "tools/list") result = { tools: [...mcpTools.map(name =>
      publicToolMetadata(name, permissions[name], TOOL_INPUTS[name],
        name === "prepare_call" ? ["phoneNumber", "instruction", "clientRequestId"] :
        name === "start_call" ? ["confirmation"] : ["get_call", "get_task", "read_call_turns"].includes(name) ? ["id"] : [], cardEnabled)),
      ...(cardEnabled ? [cardApprovalToolMetadata()] : []),
      ...(monitorEnabled ? [monitorToolMetadata()] : [])] };
    else if (rpc.method === "tools/call") {
      const name = rpc.params?.name as Tool;
      const cardRequest = (name as string) === "confirm_call_from_card" && cardEnabled;
      const monitorRequest = (name as string) === "open_call_monitor" && monitorEnabled;
      if (!Object.hasOwn(schemas, name) && !cardRequest && !monitorRequest) return res.json({ jsonrpc: "2.0", id: rpc.id,
        error: { code: -32602, message: "Unknown tool" } });
      if (!(mcpTools as readonly string[]).includes(name) && !cardRequest && !monitorRequest) return res.json({ jsonrpc: "2.0", id: rpc.id,
        result: { isError: true, content: [{ type: "text", text: "Tool is unavailable in this plugin." }] } });
      let callStartAttempted = false;
      try {
        let value: any;
        let meta: object | undefined;
        if (monitorRequest) {
          const claims = await claimsFor(req);
          if (MONITOR_SCOPES.some(s => !claims.scopes.includes(s))) throw Object.assign(
            new Error("Allow listening and transcript access once to monitor this call"), {
              status: 403, requiredScopes: Array.from(new Set([...claims.scopes, ...MONITOR_SCOPES])),
            });
          if (MONITOR_SCOPES.some(s => !scopesSupported.includes(s))) return fail(403, "Monitor unavailable");
          const args = z.object({ id: ID }).strict().parse(rpc.params?.arguments ?? {});
          const ticket = await monitor.issue(claims, args.id);
          meta = { "talkhint/monitor": ticket };
          value = { task_id: args.id, expiresAt: ticket.expiresAt,
            note: "UI-only live audio and text. No call is started or retried. ChatGPT does not hear the player." };
        } else if (cardRequest) {
          const claims = await claimsFor(req);
          need(claims, "secretary:start");
          const args = CARD_DECISION.parse(rpc.params?.arguments ?? {});
          const decision = await cardApproval.decide(claims, args.confirmation, args.approvalToken, args.decision);
          if (!decision.approved) value = { status: "denied", note: "No call was started." };
          else {
            callStartAttempted = true;
            const started = await backend.start(claims.sub, CALL.parse(decision.call));
            value = { ...started, task_id: started.task.id, asynchronous: true,
              fallbackUrl: `${base}/api/chatgpt/secretary/tasks/${encodeURIComponent(started.task.id)}`,
              note: "Read get_task with this task_id. Never create a new call because the result is delayed." };
          }
        } else {
          value = await execute(req, name, rpc.params?.arguments ?? {});
          if (name === "get_task" && cardEnabled) {
            // Only after execute has authenticated the current owner and read this task.
            meta = { "talkhint/task": {
              fallbackUrl: `${base}/api/chatgpt/secretary/tasks/${encodeURIComponent(value.id)}`,
            } };
          }
          if (name === "prepare_call") {
            // No approval URL or approval capability in model-visible content.
            const { approval_url, approvalEndpoint, note, ...preview } = value;
            const recipient = credentials.read(value.confirmation, "confirmation").recipient;
            const displayCall = { ...preview.call, ...(recipient ? { recipient } : {}) };
            const execution = callPresentation(displayCall.voiceProvider);
            meta = { "talkhint/cardApproval": { ...await cardApproval.issue(value.confirmation), call: displayCall } };
            value = { ...preview, call: displayCall, confirmationMethod: "inline_card",
              execution,
              note: "Confirm this exact call using the button in this chat. If the card is unavailable, stop. No call has started." };
          }
        }
        const text = name === "prepare_call" ?
          `Call preview: ${value.call.recipient ?? "Recipient not supplied"}; ${value.call.phoneNumber}; ${value.call.instruction}. ` +
          `Selected: ${value.execution.model}; voice: ${value.execution.voice}; provider: ${value.execution.provider}. ` +
          "No call has started. Use the inline card's single confirmation button. If this host shows only text/JSON, it has NOT displayed a confirmation card: stop and explain the host limitation. Refresh connection metadata and test in ChatGPT web with MCP Apps support. Do not replace the card with a website or chat yes, claim approval or invoke start_call." :
          JSON.stringify(value);
        result = { content: [{ type: "text", text }], structuredContent: value,
          isError: false, ...(meta ? { _meta: meta } : {}) };
      } catch (error: any) {
        if (error?.status === 401) res.set("WWW-Authenticate", challenge);
        const authenticate = error?.status === 401 ? challenge :
          error?.requiredScopes ? scopeChallenge(error.requiredScopes) :
          error?.requiredScope ? scopeChallenge(error.requiredScope) : undefined;
        if (authenticate) res.set("WWW-Authenticate", authenticate);
        result = { isError: true, content: [{ type: "text", text: error instanceof z.ZodError ? "Invalid arguments" :
          error?.status && error.status < 500 ? error.message :
            "Operation unavailable; check the existing task before trying again." }],
          ...(cardRequest && !callStartAttempted && [401, 403].includes(error?.status) ? {
            structuredContent: {
              code: "CALL_APPROVAL_REJECTED",
              requestNotStarted: true,
              note: "This confirmation request did not invoke the call backend. Check for an existing task first. Renew authorization if needed, then prepare the same assignment with the SAME clientRequestId and explicitly confirm the new card. Do not redial an existing task.",
            },
          } : {}),
          ...(authenticate ? { _meta: { "mcp/www_authenticate": [authenticate] } } : {}) };
      }
    } else return res.json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Method not found" } });
    res.json({ jsonrpc: "2.0", id: rpc.id, result });
  }));
  app.get("/api/chatgpt/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());
}
