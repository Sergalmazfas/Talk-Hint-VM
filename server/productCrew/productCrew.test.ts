import { beforeAll, afterAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { ProductCrewOAuth, sha } from "./oauth";
import { registerProductCrew } from "./routes";
import { ProductCrewService } from "./service";
import type { Marker, MarkerStore } from "../chatgpt/security";
import type { ModelRepository } from "../projectModel/repository";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import { readHypothesis, applyHypothesisCommand } from "../projectModel/hypotheses";
import { ModelError } from "../projectModel/modelError";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { buildCompanyStructure } from "../../shared/companyStructure";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
const origin = "https://crew.example.test", key = () => "product-crew-test-signing-key-".repeat(3);
class Store implements MarkerStore {
  values = new Map<string, Marker>();
  async put(m: Marker) { if (!this.values.has(m.id)) this.values.set(m.id, m); }
  async get(id: string) { const m = this.values.get(id); return m && m.expiresAt.getTime() > Date.now() ? m : undefined; }
  async consume(id: string) { const m = this.values.get(id); if (!m || m.expiresAt.getTime() <= Date.now()) return undefined; this.values.set(id, { ...m, expiresAt: new Date(0) }); return m; }
  async list(owner: string) { return Array.from(this.values.values()).filter(m => m.userId === owner); }
  async expire(id: string, owner: string) { if (this.values.get(id)?.userId === owner) this.values.delete(id); }
}
class Repository implements ModelRepository {
  roots = new Map<string, ProjectModelState>();
  constructor() {
    for (const owner of ["owner", "other"]) {
      const root = initialModel(), model = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0, data: buildCompanyStructure(defaultOperatingModel()) }, owner);
      root.alternatives = [{ id: "new-country", title: "New", model }, { id: "untouched", title: "Other hypothesis", model: initialModel() }];
      this.roots.set(owner, root);
    }
  }
  async read(owner: string, h = "original") { return readHypothesis(this.roots.get(owner)!, h); }
  async update(owner: string, v: number, c: ModelCommand, h?: string) { return this.updateMany(owner, v, [c], h); }
  async updateMany(owner: string, v: number, cs: ModelCommand[], h = "original") {
    const original = this.roots.get(owner)!;
    if (original.revision !== v) throw new ModelError(409, "stale");
    const next = cs.reduce((s, c) => applyHypothesisCommand(s, h, c, owner), original);
    this.roots.set(owner, next); return readHypothesis(next, h);
  }
}
const verifier = "a".repeat(50);
async function login(auth: ProductCrewOAuth, owner = "owner", scope = "product:read product:write offline_access") {
  const client = auth.register({ redirect_uris: ["https://chatgpt.com/connector_platform/oauth/callback"] });
  const uri = client.redirect_uris[0];
  const consent = await auth.prepare({ client_id: client.client_id, response_type: "code", redirect_uri: uri,
    code_challenge_method: "S256", code_challenge: sha(verifier), state: "unchanged-owner-state", scope }, owner);
  const redirect = new URL(await auth.approve(consent.token, owner));
  expect(redirect.searchParams.get("state")).toBe("unchanged-owner-state");
  return { client, uri, code: redirect.searchParams.get("code")! };
}
describe("product-only OAuth", () => {
  it("enforces exact official callbacks, PKCE, owner consent, one-use code and scope", async () => {
    const auth = new ProductCrewOAuth(origin, key, new Store());
    expect(() => auth.register({ redirect_uris: ["https://chatgpt.com.attacker.test/callback"] })).toThrow();
    expect(() => auth.register({ redirect_uris: ["http://chatgpt.com/callback"] })).toThrow();
    const client = auth.register({ redirect_uris: ["https://chatgpt.com/callback"] });
    const c = await auth.prepare({ client_id: client.client_id, response_type: "code", redirect_uri: client.redirect_uris[0],
      code_challenge_method: "S256", code_challenge: sha(verifier), state: "state", scope: "product:read" }, "owner");
    await expect(auth.approve(c.token, "other")).rejects.toThrow("owner");
    await auth.approve(c.token, "owner");
    await expect(auth.approve(c.token, "owner")).rejects.toThrow("already used");
    const l = await login(auth, "owner", "product:read offline_access");
    const params = { grant_type: "authorization_code", client_id: l.client.client_id, redirect_uri: l.uri, code: l.code, code_verifier: verifier };
    await expect(auth.exchange({ ...params, resource: "https://other.test/mcp" })).rejects.toThrow("resource");
    await expect(auth.exchange({ ...params, code_verifier: "b".repeat(50) })).rejects.toThrow("PKCE");
    const tokens = await auth.exchange(params);
    await expect(auth.exchange(params)).rejects.toThrow("already used");
    expect(await auth.authenticate(tokens.access_token)).toBe("owner");
    await expect(auth.authenticate(tokens.access_token, true)).rejects.toThrow("scope");
    await expect(auth.authenticate("thcg.fake.signature")).rejects.toThrow("credential");
  });
  it("rotates refresh, rejects tamper/another audience, and revokes access immediately", async () => {
    const store = new Store(), auth = new ProductCrewOAuth(origin, key, store), l = await login(auth);
    const tokens = await auth.exchange({ grant_type: "authorization_code", client_id: l.client.client_id, redirect_uri: l.uri, code: l.code, code_verifier: verifier });
    const a = { grant_type: "refresh_token", client_id: l.client.client_id, refresh_token: tokens.refresh_token };
    const next = await auth.exchange(a);
    await expect(auth.exchange(a)).rejects.toThrow("already used");
    await expect(new ProductCrewOAuth("https://other.example.test", key, store).authenticate(next.access_token)).rejects.toThrow();
    await expect(auth.authenticate(`${next.access_token}x`)).rejects.toThrow();
    await auth.revoke(next.access_token);
    await expect(auth.authenticate(next.access_token)).rejects.toThrow("revoked");
  });
});
const fixtureProcess = buildCompanyStructure(defaultOperatingModel()).nodes.find(n => n.kind === "process")!.id;
const workInput = () => ({ revision: 0, requestId: randomUUID(), title: "Проверить входящую находку", description: "Тестовая запись, не реальное исследование",
  client: "Менеджер продукта", need: "Понять ограничение", roleId: "head-engineering", processId: fixtureProcess,
  relatedIds: [], nextStep: "Подготовить результат", expectedResult: "Документ с основаниями", acceptance: "Источники и пробелы обозначены" });
describe("shared owner/hypothesis coordination", () => {
  it("saves idempotently, rejects reused IDs/stale writes, reads after new service and preserves other data", async () => {
    const repo = new Repository(), snapshot = structuredClone(repo.roots.get("owner")!), other = structuredClone(repo.roots.get("other")!);
    const service = new ProductCrewService(repo), a = workInput();
    const result = await service.call("owner", "create_work", a);
    expect(result.saved).toBe(true); expect(result.launched).toBe(false);
    expect((await service.call("owner", "create_work", a)).replayed).toBe(true);
    await expect(service.call("owner", "create_work", { ...a, title: "Different" })).rejects.toThrow("requestId");
    await expect(service.call("owner", "create_work", { ...a, requestId: randomUUID() })).rejects.toThrow("изменилась");
    const restored = new ProductCrewService(repo);
    expect((await restored.call("owner", "get_work", { recordId: result.record.id })).record.title).toBe(a.title);
    await expect(restored.call("other", "get_work", { recordId: result.record.id })).rejects.toThrow("не найдена");
    expect(repo.roots.get("owner")!.alternatives![1]).toEqual(snapshot.alternatives![1]);
    expect(repo.roots.get("other")).toEqual(other);
    expect(repo.roots.get("owner")!.elements).toEqual(snapshot.elements);
    expect((await restored.call("owner", "start_work", { recordId: result.record.id })).started).toBe(false);
  });
  it("saves one result and review with durable duplicate protection; cannot accept absent result", async () => {
    const repo = new Repository(), s = new ProductCrewService(repo), created = await s.call("owner", "create_work", workInput());
    await expect(s.call("owner", "review_result", { revision: created.revision, requestId: randomUUID(), recordId: created.record.id,
      verdict: "accepted", reason: "Хорошо", nextStep: "Закрыть" })).rejects.toThrow("Нет сохранённого");
    const p = { revision: created.revision, requestId: randomUUID(), recordId: created.record.id, title: "Результат теста",
      text: "Данные этого теста синтетические. Crew не запускалась.", nextStep: "Владельцу на приёмку" };
    const submitted = await s.call("owner", "submit_result", p);
    expect(submitted.record.coordination.state).toBe("awaiting_review");
    expect((await s.call("owner", "submit_result", p)).replayed).toBe(true);
    const saved = await repo.read("owner", "new-country");
    expect(saved.documents.filter(d => d.id === `DOC-PC-${p.requestId}`)).toHaveLength(1);
    const accepted = await s.call("owner", "review_result", { revision: submitted.revision, requestId: randomUUID(), recordId: created.record.id,
      verdict: "accepted", reason: "Проверено только сохранение", nextStep: "Следующая работа" });
    expect(accepted.record.coordination.state).toBe("accepted");
    const doc = await s.call("owner", "get_document", { documentId: `DOC-PC-${p.requestId}` });
    expect(doc.text).toBe(p.text);
    await expect(s.call("other", "get_document", { documentId: doc.id })).rejects.toThrow("не найден");
  });
  it("rolls back a document and its status together when the second command fails", async () => {
    const repo = new Repository(), s = new ProductCrewService(repo), created = await s.call("owner", "create_work", workInput());
    const before = structuredClone(repo.roots.get("owner")!);
    await expect(repo.updateMany("owner", created.revision, [
      { type: "createDocument", id: "DOC-ATOMIC-TEST", title: "Synthetic", text: "Not committed", url: "", elementIds: [created.record.id] },
      { type: "saveElement", id: "NONEXISTENT", element: { ...before.alternatives![0].model.elements[0] } },
    ], "new-country")).rejects.toThrow();
    expect(repo.roots.get("owner")).toEqual(before);
  });
  it("records sourced intake without upgrading a claimed fact or executing anything", async () => {
    const repo = new Repository(), s = new ProductCrewService(repo);
    const { expectedResult, acceptance, ...common } = workInput();
    const a = { ...common, source: "Owner message", sourceDate: "2026-10-25", evidence: "Unverified report", classification: "fact" };
    const r = await s.call("owner", "record_information", a);
    expect(r.record.coordination.classification).toBe("fact");
    expect(r.record.coordination.state).toBe("received");
    const saved = await repo.read("owner", "new-country");
    expect(saved.elements.find(e => e.id === r.record.id)!.contentStatus).toBe("hypothesis");
    expect((await s.call("owner", "record_information", a)).replayed).toBe(true);
    const triaged = await s.call("owner", "update_work", { revision: r.revision, requestId: randomUUID(), recordId: r.record.id,
      roleId: "head-product", state: "triaged", reason: "Нужно продуктовое рассмотрение", nextStep: "Создать связанную работу" });
    expect(triaged.record.coordination.state).toBe("triaged");
    expect(triaged.record.coordination.roleId).toBe("head-product");
    await expect(s.call("owner", "record_information", { ...a, requestId: randomUUID(), revision: triaged.revision, roleId: "someone-else" })).rejects.toThrow("Роль");
  });
  it("keeps one versioned role passport and reads it from get_team, without changing reporting or enabling resources", async () => {
    const repo = new Repository(), s = new ProductCrewService(repo), before = (await repo.read("owner", "new-country")).operatingModel;
    const args = { revision: 0, requestId: randomUUID(), roleId: "head-engineering", processId: fixtureProcess,
      client: "Продукт", need: "Техническая оценка", actions: "Проверить архитектуру по коду", inputs: "Разрешённый checkout",
      output: "Ограничения и доказательства", acceptance: "Прослеживаемость", resources: "Нужен read-only adapter",
      permissions: "Без production", handoff: "Продукту", unknown: "Доступы не выданы", nextStep: "Принять границы" };
    const saved = await s.call("owner", "update_role_passport", args);
    const again = await s.call("owner", "update_role_passport", { ...args, requestId: randomUUID(), revision: saved.revision, actions: "Выполнить дополнительную проверку" });
    const team = await s.call("owner", "get_team", { roleId: args.roleId });
    expect(team.roles[0].passport.version).toBe(2);
    expect(team.roles[0].passport.details.procedure).toContain("дополнительную");
    expect((await repo.read("owner", "new-country")).operatingModel).toEqual(before);
    expect((await s.call("owner", "update_role_passport", { ...args, revision: saved.revision })).replayed).toBe(true);
    expect(again.launched).toBe(false);
  });
});
describe("owner-approved public Dev MCP", () => {
  it("reads and writes only the bound workspace without credentials, keeps replay protection and protected admin downloads", async () => {
    const repo = new Repository(), other = structuredClone(repo.roots.get("other"));
    const app = express();
    registerProductCrew(app, { origin, key, store: new Store(), repo,
      admin: (_req, res) => { res.sendStatus(403); },
      authorizedOwner: async id => id === "owner", publicDevOwner: async () => "owner" });
    const server = await new Promise<Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const url = `http://127.0.0.1:${(server.address() as any).port}`;
    const call = async (method: string, params?: unknown) => {
      const r = await fetch(`${url}/api/product-crew/mcp`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      expect(r.status).toBe(200);
      return (await r.json() as any).result;
    };
    try {
      expect((await call("initialize")).instructions).toContain("публичный");
      const tools = (await call("tools/list")).tools;
      expect(tools).toHaveLength(12);
      expect(tools.every((t: any) => t.securitySchemes[0].type === "noauth")).toBe(true);
      expect((await fetch(`${url}/.well-known/oauth-protected-resource/api/product-crew/mcp`)).status).toBe(404);
      expect((await call("tools/call", { name: "get_team", arguments: {} })).isError).toBe(false);
      const args = workInput();
      const created = (await call("tools/call", { name: "create_work", arguments: args })).structuredContent.result;
      expect(created.saved).toBe(true);
      expect((await call("tools/call", { name: "create_work", arguments: args })).structuredContent.result.replayed).toBe(true);
      const result = (await call("tools/call", { name: "submit_result", arguments: {
        revision: created.revision, requestId: randomUUID(), recordId: created.record.id,
        title: "Fixture result", text: "Synthetic document", nextStep: "Review" } })).structuredContent.result;
      const docId = result.record.coordination.resultDocumentId;
      const doc = (await call("tools/call", { name: "get_document", arguments: { documentId: docId } })).structuredContent.result;
      expect(doc.downloadPath).toContain("/api/product-crew/documents/");
      expect(await (await fetch(`${url}${doc.downloadPath}`)).text()).toBe("Synthetic document");
      expect((await fetch(`${url}/api/admin/product-crew/documents/${docId}/download`)).status).toBe(403);
      expect((await call("tools/call", { name: "get_team", arguments: { owner: "other" } })).isError).toBe(true);
      expect(repo.roots.get("other")).toEqual(other);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it("never enables the public option in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    let resolved = false;
    const app = express();
    registerProductCrew(app, { origin, key, store: new Store(), repo: new Repository(),
      admin: (_req, res) => { res.sendStatus(403); }, authorizedOwner: async () => true,
      publicDevOwner: async () => { resolved = true; return "owner"; } });
    process.env.NODE_ENV = previous;
    const server = await new Promise<Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    try {
      const r = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/product-crew/mcp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
      expect(r.status).toBe(401);
      expect(resolved).toBe(false);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
describe("HTTP plugin contract", () => {
  let server: Server, baseURL: string, access: string, writeAccess: string;
  const store = new Store(), repo = new Repository();
  beforeAll(async () => {
    const app = express();
    // Fixture-only session and admin gate. Not imported by the application.
    const admin: express.RequestHandler = (req, res, next) => { if (req.get("x-test-owner") !== "owner") { res.sendStatus(403); return; } req.user = { id: "owner", email: "fixture@example.test", language: "ru", plan: null }; next(); };
    registerProductCrew(app, { origin, key, store, repo, admin, authorizedOwner: async id => id === "owner" });
    await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
    baseURL = `http://127.0.0.1:${(server.address() as any).port}`;
    const auth = new ProductCrewOAuth(origin, key, store);
    for (const scope of ["product:read offline_access", "product:read product:write offline_access"]) {
      const l = await login(auth, "owner", scope), t = await auth.exchange({ grant_type: "authorization_code", client_id: l.client.client_id,
        redirect_uri: l.uri, code: l.code, code_verifier: verifier });
      if (scope.includes("product:write")) writeAccess = t.access_token; else access = t.access_token;
    }
  });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  it("serves independent discovery and validates advertised tool schemas; anonymous and read-only writes denied", async () => {
    const discovery = await (await fetch(`${baseURL}/.well-known/oauth-protected-resource/api/product-crew/mcp`)).json() as any;
    expect(discovery.resource).toBe(`${origin}/api/product-crew/mcp`);
    const request = async (token: string, method: string, params?: any, reqOrigin?: string) => fetch(`${baseURL}/api/product-crew/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(reqOrigin ? { Origin: reqOrigin } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const denied = await request("", "tools/list");
    expect(denied.status).toBe(401); expect(denied.headers.get("www-authenticate")).toContain("product-crew");
    const initialized = await (await request(access, "initialize")).json() as any;
    expect(initialized.result.instructions).toContain("Должности определяются из действий");
    const tools = await (await request(access, "tools/list")).json() as any;
    expect(tools.result.tools).toHaveLength(12);
    for (const tool of tools.result.tools) expect(tool.inputSchema.type).toBe("object");
    expect((await request(access, "tools/call", { name: "create_work", arguments: workInput() })).status).toBe(403);
    expect((await request(writeAccess, "tools/call", {}, "https://attacker.test")).status).toBe(403);
    const result = await (await request(writeAccess, "tools/call", { name: "create_work", arguments: workInput() })).json() as any;
    expect(result.result.structuredContent.result.saved).toBe(true);
    const deniedDownload = await fetch(`${baseURL}/api/admin/product-crew/documents/guessed/download`);
    expect(deniedDownload.status).toBe(403);
  });
});
