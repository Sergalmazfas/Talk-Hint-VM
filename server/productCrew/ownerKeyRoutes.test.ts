import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { ProductCrewOwnerKey, type OwnerKeyStore } from "./ownerKey";
import { registerOwnerKeyRoutes } from "./ownerKeyRoutes";
import { registerProductCrew } from "./routes";
import { ProductCrewOAuth } from "./oauth";
import { ProductCrewSecretKey, type SecretKeyStore } from "./secretKey";
import { createRequestLoggingMiddleware } from "../requestLogging";
import type { Marker, MarkerStore } from "../chatgpt/security";
import type { ModelRepository } from "../projectModel/repository";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { buildCompanyStructure } from "../../shared/companyStructure";

const origin = "https://crew.example.test", base = "/api/admin/product-crew/owner-key";
class Keys implements OwnerKeyStore {
  hash = ""; owner = ""; expires = 0; created = 0; lastUsed: number | null = null;
  async status(owner: string) {
    return this.owner !== owner || this.expires <= Date.now() ? null : {
      createdAt: new Date(this.created).toISOString(), expiresAt: new Date(this.expires).toISOString(),
      lastUsedAt: this.lastUsed === null ? null : new Date(this.lastUsed).toISOString() };
  }
  async rotate(owner: string, hash: string, expires: Date) {
    this.owner = owner; this.hash = hash; this.expires = expires.getTime(); this.created = Date.now(); this.lastUsed = null;
    return (await this.status(owner))!;
  }
  async revoke(owner: string) { if (owner === this.owner) this.expires = 0; }
  async use(owner: string, hash: string) {
    if (owner !== this.owner || hash !== this.hash || this.expires <= Date.now()) return false;
    this.lastUsed = Date.now(); return true;
  }
}
class Markers implements MarkerStore {
  rows = new Map<string, Marker>();
  async put(row: Marker) { if (!this.rows.has(row.id)) this.rows.set(row.id, row); }
  async get(id: string) { const row = this.rows.get(id); return row && row.expiresAt.getTime() > Date.now() ? row : undefined; }
  async consume(id: string) { const row = await this.get(id); if (this.rows.get(id)?.expiresAt.getTime() === 0) return undefined; if (row) this.rows.set(id, { ...row, expiresAt: new Date(0) }); return row; }
  async list(owner: string) { return [...this.rows.values()].filter(r => r.userId === owner); }
  async expire(id: string) { this.rows.delete(id); }
}
describe("owner-key HTTP security and shared MCP boundary", () => {
  let server: Server, url: string;
  const keysStore = new Keys(), keys = new ProductCrewOwnerKey(keysStore, "owner"), markers = new Markers();
  const signingKey = () => "isolated-test-signing-secret-".repeat(3);
  let ownerAllowed = true, writesOpen = false, storageDown = false;
  let secretValue = "isolated_Secrets_credential_".repeat(3), secretStorageDown = false;
  const secretDisabled = new Set<string>(), secretUsed = new Map<string, string>();
  const secretStore: SecretKeyStore = {
    async status(owner, hash) {
      if (secretStorageDown) throw Error("unsafe secret storage detail");
      return { disabled: secretDisabled.has(owner + hash), lastUsedAt: secretUsed.get(owner + hash) ?? null };
    },
    async use(owner, hash) {
      if (secretStorageDown) throw Error("unsafe secret storage detail");
      if (secretDisabled.has(owner + hash)) return false;
      secretUsed.set(owner + hash, new Date().toISOString()); return true;
    },
    async disable(owner, hash) { secretDisabled.add(owner + hash); },
  };
  const secretKey = new ProductCrewSecretKey(secretStore, "owner", () => secretValue);
  const logs: string[] = [];
  const root = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  const read = vi.fn(async () => root);
  const updateMany = vi.fn(async () => {
    if (!writesOpen) throw Object.assign(Error("Запись в production закрыта."), { status: 423 });
    return root;
  });
  const repo = { read, update: updateMany, updateMany } as unknown as ModelRepository;
  beforeAll(async () => {
    const app = express();
    app.use(createRequestLoggingMiddleware(line => logs.push(line)));
    app.use(session({ secret: "test-cookie-session-secret-only-fixture", resave: false, saveUninitialized: true }));
    // Authentication stub on this local, isolated test server only; never in app code.
    app.use((req, _res, next) => {
      (req as any).user = req.get("x-test-user") ? { id: req.get("x-test-user") } : undefined;
      req.isAuthenticated = (() => !!req.user) as typeof req.isAuthenticated;
      next();
    });
    const admin: express.RequestHandler = (req, res, next) => {
      if (!req.user) return void res.sendStatus(401);
      next();
    };
    const authorizedOwner = async (id: string) => ownerAllowed && id === "owner";
    registerOwnerKeyRoutes(app, { origin, owner: "owner", admin, keys: new ProductCrewOwnerKey({
      ...keysStore,
      status: owner => keysStore.status(owner),
      rotate: async (...args) => { if (storageDown) throw Error("unsafe provider detail"); return keysStore.rotate(...args); },
      revoke: owner => keysStore.revoke(owner), use: (...args) => keysStore.use(...args),
    }, "owner"), secretKey, authorizedOwner, csrfStore: markers });
    registerProductCrew(app, { origin, key: signingKey, store: markers, repo, admin,
      authorizedOwner, production: true, ownerKey: { owner: "owner", keys }, secretKey });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
  const mcp = (key?: string, method = "initialize", params?: any, extra: Record<string, string> = {}) =>
    fetch(url + "/api/product-crew/mcp", { method: "POST", headers: {
      "Content-Type": "application/json", ...(key === undefined ? {} : { "X-API-Key": key }), ...extra,
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  async function status(cookie?: string) {
    const res = await fetch(url + base, { headers: { "x-test-user": "owner", ...(cookie ? { Cookie: cookie } : {}) } });
    return { res, body: await res.json() as any, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? cookie! };
  }
  async function mutation(cookie: string, csrf: string, suffix = "", extra: Record<string, string> = {}, body: unknown = { confirm: true }) {
    return fetch(url + base + suffix, { method: "POST", headers: { "Content-Type": "application/json",
      "x-test-user": "owner", Cookie: cookie, Origin: origin, "x-product-key-csrf": csrf, ...extra }, body: JSON.stringify(body) });
  }
  it("requires a browser session of the fixed owner, not any admin, OAuth or API key", async () => {
    expect((await fetch(url + base)).status).toBe(401);
    expect((await fetch(url + base, { headers: { "x-test-user": "other" } })).status).toBe(403);
    for (const h of [{ authorization: "Bearer fake" }, { "x-api-key": "fake" }])
      expect((await fetch(url + base, { headers: { "x-test-user": "owner", ...h } })).status).toBe(403);
    ownerAllowed = false;
    expect((await fetch(url + base, { headers: { "x-test-user": "owner" } })).status).toBe(403);
    ownerAllowed = true;
  });
  it("denies absent, forged, expired and revoked keys at the real MCP handler", async () => {
    expect((await mcp()).status).toBe(401);
    expect((await mcp("foreign")).status).toBe(401);
    expect((await mcp(`thpk_${"x".repeat(43)}`)).status).toBe(401);
    let issued = await keys.create();
    keysStore.expires = Date.now();
    expect((await mcp(issued.key)).status).toBe(401);
    issued = await keys.create(); await keys.revoke();
    expect((await mcp(issued.key)).status).toBe(401);
  });
  it("enforces Origin, CSRF, confirmation and a fresh, one-use action grant", async () => {
    const s = await status();
    expect(s.res.headers.get("cache-control")).toContain("no-store");
    expect(s.body.lifetimeDays).toBe(90);
    expect((await mutation(s.cookie, "")).status).toBe(403);
    expect((await mutation(s.cookie, s.body.csrfToken, "", { Origin: "https://evil.example" })).status).toBe(403);
    expect((await mutation(s.cookie, s.body.csrfToken, "", { Origin: "" })).status).toBe(403);
    expect((await mutation(s.cookie, s.body.csrfToken, "", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await mutation(s.cookie, s.body.csrfToken, "", {}, {})).status).toBe(400);
    expect((await mutation(s.cookie, s.body.csrfToken, "", {}, { confirm: true, owner: "other" })).status).toBe(400);
    const response = await mutation(s.cookie, s.body.csrfToken);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const issued = await response.json() as any;
    expect(issued.key).toMatch(/^thpk_/);
    expect((await mcp(issued.key)).status).toBe(200);
    expect((await mutation(s.cookie, s.body.csrfToken)).status).toBe(403);
    const refreshed = await status(s.cookie);
    expect(JSON.stringify(refreshed.body)).not.toContain(issued.key);
    expect(JSON.stringify(refreshed.body)).not.toContain(keysStore.hash);
    expect(refreshed.body.status.lastUsedAt).not.toBe(null);
  });
  it("rotates via the protected page, revokes via one button and does not accept a foreign CSRF session", async () => {
    const before = await keys.create(), s = await status(), another = await status();
    expect((await mutation(another.cookie, s.body.csrfToken)).status).toBe(403);
    const r = await mutation(s.cookie, s.body.csrfToken);
    const after = await r.json() as any;
    expect(r.status).toBe(201);
    expect((await mcp(before.key)).status).toBe(401);
    expect((await mcp(after.key)).status).toBe(200);
    const fresh = await status(s.cookie);
    expect((await mutation(s.cookie, fresh.body.csrfToken, "/revoke")).status).toBe(200);
    expect((await mcp(after.key)).status).toBe(401);
    expect((await status(s.cookie)).body.status).toBe(null);
  });
  it("consumes an action grant atomically; concurrent submissions cannot issue two keys", async () => {
    const s = await status();
    const responses = await Promise.all([
      mutation(s.cookie, s.body.csrfToken), mutation(s.cookie, s.body.csrfToken),
    ]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 403]);
    const issued = await responses.find(r => r.status === 201)!.json() as any;
    expect((await mcp(issued.key)).status).toBe(200);
    const expired = await status(s.cookie);
    for (const [id, row] of markers.rows) {
      if (id.startsWith("productcrew:key-csrf:")) markers.rows.set(id, { ...row, expiresAt: new Date(0) });
    }
    expect((await mutation(expired.cookie, expired.body.csrfToken)).status).toBe(403);
  });
  it("does not grant additional tools, owner acceptance, cross-origin browser access or bearer ambiguity", async () => {
    const { key } = await keys.create();
    const list = await (await mcp(key, "tools/list")).json() as any;
    expect(list.result.tools.some((t: any) => t.name === "review_result")).toBe(false);
    expect(list.result.tools.every((t: any) => t.securitySchemes[0].type === "apiKey")).toBe(true);
    const called = async (name: string, args: any = {}) => (await (await mcp(key, "tools/call", { name, arguments: args })).json() as any).result;
    expect((await called("review_result")).isError).toBe(true);
    for (const name of ["make_call", "publish", "delete_document", "get_secret", "charge_money"])
      expect((await called(name)).isError).toBe(true);
    expect((await mcp(key, "ping", undefined, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await mcp(key, "ping", undefined, { Authorization: "Bearer fake" })).status).toBe(401);
    ownerAllowed = false;
    expect((await mcp(key)).status).toBe(401);
    ownerAllowed = true;
  });
  it("uses only owner/new-country and propagates the existing closed-write gate", async () => {
    const { key } = await keys.create();
    for (const credential of [key, secretValue]) {
    const readResult = await (await mcp(credential, "tools/call", { name: "get_roadmap", arguments: {} })).json() as any;
    expect(readResult.result.isError).toBe(false);
    expect(read).toHaveBeenLastCalledWith("owner", "new-country");
    const data = root.operatingModel!.revisions.at(-1)!.data;
    const role = data.nodes.find(n => n.kind === "role")!, process = data.nodes.find(n => n.kind === "process")!;
    const r = await (await mcp(credential, "tools/call", { name: "record_information", arguments: {
      revision: root.revision, requestId: randomUUID(), title: "Fixture", description: "Fixture", client: "Owner",
      need: "Fixture", roleId: role.id, processId: process.id, relatedIds: [], nextStep: "Fixture",
      source: "Fixture", sourceDate: "2026-10-31", evidence: "Fixture", classification: "user_report",
    } })).json() as any;
    expect(r.result.isError).toBe(true);
    expect(JSON.parse(r.result.content[0].text).status).toBe(423);
    expect(updateMany).toHaveBeenCalledWith("owner", root.revision, expect.any(Array), "new-country");
    }
  });
  it("Secrets credential uses the same production tools, owner gate and excludes acceptance/external actions", async () => {
    expect((await mcp(secretValue)).status).toBe(200);
    const list = await (await mcp(secretValue, "tools/list")).json() as any;
    expect(list.result.tools.some((t: any) => t.name === "get_team")).toBe(true);
    expect(list.result.tools.some((t: any) => t.name === "review_result")).toBe(false);
    expect(list.result.tools.every((t: any) => t.securitySchemes[0].type === "apiKey")).toBe(true);
    for (const name of ["review_result", "make_call", "publish", "delete_document", "get_secret", "charge_money"]) {
      const result = await (await mcp(secretValue, "tools/call", { name, arguments: {} })).json() as any;
      expect(result.result.isError).toBe(true);
    }
    expect((await mcp(secretValue, "ping", undefined, { Authorization: "Bearer fake" })).status).toBe(401);
    ownerAllowed = false;
    expect((await mcp(secretValue)).status).toBe(401);
    ownerAllowed = true;
    expect(logs.join("\n")).not.toContain(secretValue);
  });
  it("Secrets metadata never exposes value/hash; protected disable is one-use, immediate and independent of manual key", async () => {
    const s = await status(), manual = await keys.create();
    expect(s.body.secretStatus).toMatchObject({ configured: true, disabled: false, lastUsedAt: expect.any(String) });
    expect(JSON.stringify(s.body)).not.toContain(secretValue);
    expect(JSON.stringify(s.body)).not.toContain(createHash("sha256").update(secretValue).digest("hex"));
    expect((await mutation(s.cookie, "", "/disable-secret")).status).toBe(403);
    expect((await mutation(s.cookie, s.body.csrfToken, "/disable-secret", { Origin: "https://evil.example" })).status).toBe(403);
    const r = await mutation(s.cookie, s.body.csrfToken, "/disable-secret");
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ disabled: true });
    expect((await mcp(secretValue)).status).toBe(401);
    expect((await mutation(s.cookie, s.body.csrfToken, "/disable-secret")).status).toBe(403);
    expect((await mcp(manual.key)).status).toBe(200);
    expect((await status(s.cookie)).body.secretStatus.disabled).toBe(true);
    const old = secretValue;
    secretValue += "_replacement";
    expect((await mcp(old)).status).toBe(401);
    expect((await mcp(secretValue)).status).toBe(200);
    expect((await status(s.cookie)).body.secretStatus.disabled).toBe(false);
    secretStorageDown = true;
    const failed = await mcp(secretValue);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("unsafe secret storage detail");
    secretStorageDown = false;
    expect(logs.join("\n")).not.toContain(secretValue);
  });
  it("keeps the OAuth flow and credentials working beside header keys", async () => {
    const oauth = new ProductCrewOAuth(origin, signingKey, markers), verifier = "v".repeat(43);
    const client = oauth.register({ redirect_uris: ["https://replit.com/connectors/oauth/callback"] });
    const consent = await oauth.prepare({ client_id: client.client_id, redirect_uri: client.redirect_uris[0],
      response_type: "code", code_challenge_method: "S256", state: "fixture",
      code_challenge: createHash("sha256").update(verifier).digest("base64url") }, "owner");
    const redirect = new URL(await oauth.approve(consent.token, "owner"));
    const tokens = await oauth.exchange({ grant_type: "authorization_code", client_id: client.client_id,
      code: redirect.searchParams.get("code"), redirect_uri: client.redirect_uris[0], code_verifier: verifier });
    await keys.create(); await keys.revoke();
    expect((await mcp(undefined, "initialize", undefined, { Authorization: `Bearer ${tokens.access_token}` })).status).toBe(200);
  });
  it("never logs key, authorization, CSRF, cookies or response bodies; storage errors are generic", async () => {
    const s = await status();
    const r = await mutation(s.cookie, s.body.csrfToken), issued = await r.json() as any;
    await mcp(issued.key);
    expect(logs.join("\n")).not.toContain(issued.key);
    expect(logs.join("\n")).not.toContain(s.body.csrfToken);
    expect(logs.join("\n")).not.toContain(s.cookie);
    expect(logs.join("\n")).not.toContain("thpk_");
    expect(logs.join("\n")).toContain("POST /api/product-crew/mcp 200");
    const next = await status(s.cookie);
    storageDown = true;
    const failed = await mutation(s.cookie, next.body.csrfToken);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("unsafe provider detail");
    storageDown = false;
    expect((await mutation(s.cookie, next.body.csrfToken)).status).toBe(403);
  });
});
