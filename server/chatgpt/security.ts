import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const SCOPES = ["calls:read", "calls:transcript", "incoming:read", "secretary:start", "offline_access"] as const;
export type Scope = typeof SCOPES[number];
/** Minimal MCP connection rights; transcript access is an explicit step-up. */
export const MCP_BASE_SCOPES: readonly Scope[] = ["calls:read", "offline_access"];
export interface Marker { id: string; userId: string; expiresAt: Date }
export interface MarkerStore {
  put(marker: Marker): Promise<void>;
  get(id: string): Promise<Marker | undefined>;
  /** Atomic compare-and-expire; only one code/refresh exchange may win. */
  consume(id: string): Promise<Marker | undefined>;
  list(userId: string): Promise<Marker[]>;
  expire(id: string, userId: string): Promise<void>;
}
export interface Claims {
  type: "code" | "access" | "refresh" | "confirmation";
  sub: string; grant: string; scopes: Scope[]; client: string; aud: string; iss: string;
  exp: number; nonce: string;
  redirect?: string; challenge?: string;
  call?: { phoneNumber: string; instruction: string; clientRequestId: string; voiceProvider: "elevenlabs" | "cartesia"; translationLanguage: "ru" | "es" };
}
export function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
export const digest = (text: string) => createHash("sha256").update(text).digest("base64url");
export const markerId = (token: string) => `chatgpt:token:${digest(token)}`;
export function parseScopes(value: unknown): Scope[] {
  if (typeof value !== "string" || value.length > 200) return fail(400, "Invalid scope");
  const scopes = Array.from(new Set(value.split(" ").filter(Boolean)));
  if (!scopes.length || scopes.some(s => !SCOPES.includes(s as Scope))) return fail(400, "Invalid scope");
  return scopes as Scope[];
}

/** Domain-separated credentials, never accepted by TalkHint's general auth. */
export class Credentials {
  constructor(private readonly key: () => string, readonly resource: string) {}
  issue(claims: Omit<Claims, "nonce" | "aud" | "iss">): string {
    const body = Buffer.from(JSON.stringify({ ...claims, nonce: randomUUID(), aud: this.resource,
      iss: new URL(this.resource).origin })).toString("base64url");
    return `thcg.${body}.${this.mac(body)}`;
  }
  read(token: unknown, type: Claims["type"]): Claims {
    if (typeof token !== "string" || token.length > 16000) return fail(401, "Invalid credential");
    const [prefix, body, signature, extra] = token.split(".");
    if (prefix !== "thcg" || !body || !signature || extra) return fail(401, "Invalid credential");
    const expected = Buffer.from(this.mac(body));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return fail(401, "Invalid credential");
    let claims: Claims;
    try { claims = JSON.parse(Buffer.from(body, "base64url").toString()); }
    catch { return fail(401, "Invalid credential"); }
    if (claims.type !== type || claims.aud !== this.resource || claims.iss !== new URL(this.resource).origin || !Number.isFinite(claims.exp) ||
        claims.exp <= Date.now() || !claims.sub || !claims.grant || !Array.isArray(claims.scopes) ||
        claims.scopes.some(s => !SCOPES.includes(s))) return fail(401, "Expired or invalid credential");
    return claims;
  }
  private mac(body: string): string {
    const key = this.key();
    if (!key || key.length < 32) return fail(503, "Integration signing is not configured");
    return createHmac("sha256", key).update(`talkhint-chatgpt-v1:${body}`).digest("base64url");
  }
}

export function grantId(client: string, scopes: Scope[], id = randomUUID()): string {
  const mask = SCOPES.map(s => scopes.includes(s) ? "1" : "0").join("");
  return `chatgpt:grant:${digest(client)}:${mask}:${id}`;
}
export function grantScopes(id: string): Scope[] {
  const mask = id.split(":")[3];
  return SCOPES.filter((_, i) => mask?.[i] === "1");
}
export async function activeGrant(store: MarkerStore, claims: Claims): Promise<Marker> {
  const grant = await store.get(claims.grant);
  if (!grant || grant.userId !== claims.sub || grant.expiresAt.getTime() <= Date.now() ||
      !grant.id.startsWith(`chatgpt:grant:${digest(claims.client)}:`) ||
      claims.scopes.some(s => !grantScopes(grant.id).includes(s))) return fail(401, "Connection expired or revoked");
  return grant;
}
