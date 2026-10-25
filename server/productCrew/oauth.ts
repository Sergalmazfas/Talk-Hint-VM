import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { MarkerStore } from "../chatgpt/security";
export const productScopes = ["product:read", "product:write", "offline_access"] as const;
type Scope = typeof productScopes[number];
type Kind = "client" | "consent" | "code" | "access" | "refresh";
interface Claims {
  kind: Kind; sub: string; exp: number; nonce: string; aud: string; iss: string;
  client?: string; grant?: string; scopes?: Scope[];
  redirects?: string[]; name?: string;
  request?: AuthRequest;
}
interface AuthRequest { client: string; redirect: string; challenge: string; state: string; scopes: Scope[] }
export const sha = (s: string) => createHash("sha256").update(s).digest("base64url");
const error = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
const verifier = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);
const marker = (token: string) => `productcrew:token:${sha(token)}`;
const redirect = (value: unknown) => {
  if (typeof value !== "string" || value.length > 2000) return error(400, "Invalid redirect URI");
  let u: URL; try { u = new URL(value); } catch { return error(400, "Invalid redirect URI"); }
  if (u.protocol !== "https:" || !["chatgpt.com", "chat.openai.com"].includes(u.hostname) || u.username || u.password || u.hash || u.port) return error(400, "Redirect must be an official ChatGPT callback");
  return value;
};
export class ProductCrewOAuth {
  readonly resource: string;
  readonly issuer: string;
  constructor(readonly origin: string, private key: () => string, private store: MarkerStore) {
    if (new URL(origin).origin !== origin || !origin.startsWith("https://")) throw Error("Exact HTTPS origin required");
    this.issuer = `${origin}/api/product-crew`; this.resource = `${this.issuer}/mcp`;
  }
  private mac(body: string) {
    const k = this.key(); if (k.length < 32) return error(503, "Product integration signing unavailable");
    return createHmac("sha256", k).update(`talkhint-product-crew-v1:${body}`).digest("base64url");
  }
  private issue(value: Omit<Claims, "nonce" | "aud" | "iss">) {
    const body = Buffer.from(JSON.stringify({ ...value, nonce: randomUUID(), aud: this.resource, iss: this.issuer })).toString("base64url");
    return `thpc.${body}.${this.mac(body)}`;
  }
  private read(value: unknown, kind: Kind): Claims {
    if (typeof value !== "string" || value.length > 16000) return error(401, "Invalid product credential");
    const [prefix, body, sig, extra] = value.split(".");
    if (prefix !== "thpc" || !body || !sig || extra) return error(401, "Invalid product credential");
    const actual = Buffer.from(sig), expected = Buffer.from(this.mac(body));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return error(401, "Invalid product credential");
    let c: Claims;
    try { c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return error(401, "Invalid product credential"); }
    if (c.kind !== kind || c.aud !== this.resource || c.iss !== this.issuer || !c.sub ||
        !Number.isFinite(c.exp) || c.exp <= Date.now() || !c.nonce ||
        (c.scopes && (!Array.isArray(c.scopes) || c.scopes.some(s => !productScopes.includes(s))))) return error(401, "Expired or invalid product credential");
    return c;
  }
  register(raw: unknown) {
    const a = z.object({ redirect_uris: z.array(z.string()).min(1).max(3), client_name: z.string().max(100).optional(),
      token_endpoint_auth_method: z.literal("none").optional(), grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).max(2).optional(),
      response_types: z.array(z.literal("code")).max(1).optional() }).passthrough().parse(raw);
    const redirects = a.redirect_uris.map(redirect);
    return { client_id: this.issue({ kind: "client", sub: "public-registration", exp: Date.now() + 365 * 86400000, redirects, name: a.client_name ?? "ChatGPT" }),
      client_name: a.client_name ?? "ChatGPT", redirect_uris: redirects, token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] };
  }
  async prepare(raw: Record<string, unknown>, owner: string) {
    const client = String(raw.client_id ?? ""), c = this.read(client, "client");
    if (raw.response_type !== "code" || raw.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(String(raw.code_challenge ?? ""))) return error(400, "PKCE S256 required");
    const uri = redirect(raw.redirect_uri);
    if (!c.redirects?.includes(uri)) return error(400, "Redirect not registered");
    if (raw.resource && raw.resource !== this.resource) return error(400, "Invalid product resource");
    const scopes = Array.from(new Set(String(raw.scope ?? productScopes.join(" ")).split(" ").filter(Boolean)));
    if (!scopes.length || scopes.some(s => !productScopes.includes(s as Scope)) || !scopes.includes("product:read")) return error(400, "Invalid product scopes");
    const state = String(raw.state ?? ""); if (!state || state.length > 2000) return error(400, "OAuth state required");
    const request: AuthRequest = { client, redirect: uri, state, scopes: scopes as Scope[], challenge: String(raw.code_challenge) };
    const token = this.issue({ kind: "consent", sub: owner, exp: Date.now() + 300000, request });
    await this.store.put({ id: marker(token), userId: owner, expiresAt: new Date(Date.now() + 300000) });
    return { token, clientName: c.name, scopes };
  }
  async approve(token: string, owner: string) {
    const c = this.read(token, "consent");
    if (c.sub !== owner || !c.request) return error(403, "Consent owner mismatch");
    const consumed = await this.store.consume(marker(token));
    if (!consumed || consumed.userId !== owner) return error(401, "Consent expired or already used");
    const r = c.request, mask = productScopes.map(s => r.scopes.includes(s) ? "1" : "0").join("");
    const grant = `productcrew:grant:${sha(r.client)}:${mask}:${randomUUID()}`;
    await this.store.put({ id: grant, userId: owner, expiresAt: new Date(Date.now() + 30 * 86400000) });
    const code = this.issue({ kind: "code", sub: owner, exp: Date.now() + 120000, client: r.client, scopes: r.scopes, grant, request: r });
    await this.store.put({ id: marker(code), userId: owner, expiresAt: new Date(Date.now() + 120000) });
    const url = new URL(r.redirect); url.searchParams.set("code", code); url.searchParams.set("state", r.state);
    return url.toString();
  }
  private async active(c: Claims) {
    const prefix = `productcrew:grant:${sha(c.client ?? "")}:`;
    if (!c.grant?.startsWith(prefix) || !c.scopes) return error(401, "Invalid grant");
    const grant = await this.store.get(c.grant);
    const mask = c.grant.slice(prefix.length).split(":")[0];
    if (!grant || grant.userId !== c.sub || grant.expiresAt.getTime() <= Date.now() ||
        c.scopes.some(s => mask[productScopes.indexOf(s)] !== "1")) return error(401, "Product connection expired or revoked");
  }
  async exchange(raw: Record<string, unknown>) {
    if (raw.resource && raw.resource !== this.resource) return error(400, "Invalid product resource");
    const client = String(raw.client_id ?? ""); this.read(client, "client");
    const refresh = raw.grant_type === "refresh_token";
    if (!refresh && raw.grant_type !== "authorization_code") return error(400, "Unsupported grant type");
    const token = String(refresh ? raw.refresh_token ?? "" : raw.code ?? "");
    const c = this.read(token, refresh ? "refresh" : "code");
    if (c.client !== client) return error(401, "Client mismatch");
    await this.active(c);
    if (!refresh && (raw.redirect_uri !== c.request?.redirect || !verifier.safeParse(raw.code_verifier).success ||
        sha(String(raw.code_verifier)) !== c.request?.challenge)) return error(400, "Invalid PKCE or redirect");
    if (raw.scope && raw.scope !== c.scopes!.join(" ")) return error(400, "Scope changes require new consent");
    const used = await this.store.consume(marker(token));
    if (!used || used.userId !== c.sub) return error(401, "Code or refresh token already used");
    const claims = { sub: c.sub, client, grant: c.grant, scopes: c.scopes };
    const access = this.issue({ ...claims, kind: "access", exp: Date.now() + 900000 });
    let nextRefresh: string | undefined;
    if (c.scopes!.includes("offline_access")) {
      nextRefresh = this.issue({ ...claims, kind: "refresh", exp: Date.now() + 30 * 86400000 });
      await this.store.put({ id: marker(nextRefresh), userId: c.sub, expiresAt: new Date(Date.now() + 30 * 86400000) });
    }
    return { access_token: access, token_type: "Bearer", expires_in: 900, refresh_token: nextRefresh, scope: c.scopes!.join(" ") };
  }
  async authenticate(token: string, write = false) {
    const c = this.read(token, "access"); await this.active(c);
    if (!c.scopes!.includes(write ? "product:write" : "product:read")) return error(403, "Product scope not granted");
    return c.sub;
  }
  async revoke(token: string) {
    let c: Claims;
    try { c = this.read(token, "refresh"); } catch { c = this.read(token, "access"); }
    await this.active(c); await this.store.consume(c.grant!);
  }
}
