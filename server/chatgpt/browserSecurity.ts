import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { Request, Response } from "express";
import { digest, fail } from "./security";

const BINDING = "__Host-thcg-binding";
const OWNER = "__Host-thcg-owner";
export const WEB_TTL = 15 * 60_000;

/**
 * Encrypted, purpose-bound browser tickets. An approval link is NOT an access
 * token: it requires independent owner login + CSRF + a live OAuth grant.
 * Encryption keeps numbers/instructions out of URL plaintext and Referer.
 */
export class BrowserSecurity {
  constructor(private readonly signingKey: () => string, private readonly origin: string,
    private readonly namespace = "") {}
  private cookieName(name: string) { return this.namespace ? `${name}-actions` : name; }
  private key() {
    const key = this.signingKey();
    if (!key || key.length < 32) return fail(503, "Browser signing is unavailable");
    return createHmac("sha256", key).update(`talkhint-chatgpt-web-v1:${this.origin}${this.namespace ? `:${this.namespace}` : ""}`).digest();
  }
  seal(value: { kind: string; exp: number; [key: string]: unknown }): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(Buffer.from(this.origin));
    const encrypted = Buffer.concat([
      cipher.update(deflateRawSync(Buffer.from(JSON.stringify(value)))), cipher.final(),
    ]);
    return `thcg.web.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
  }
  open<T extends { kind: string; exp: number }>(token: unknown, kind: T["kind"]): T {
    if (typeof token !== "string" || token.length > 24000) return fail(400, "Invalid or expired browser ticket");
    const [prefix, web, iv, body, tag, extra] = token.split(".");
    if (prefix !== "thcg" || web !== "web" || !iv || !body || !tag || extra) return fail(400, "Invalid browser ticket");
    const key = this.key(); // Configuration failures remain 503, not invalid-ticket errors.
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAAD(Buffer.from(this.origin));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      const compressed = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]);
      const value = JSON.parse(inflateRawSync(compressed, { maxOutputLength: 24000 }).toString());
      if (value.kind !== kind || !Number.isFinite(value.exp) || value.exp <= Date.now()) throw new Error("Expired");
      return value;
    } catch { return fail(400, "Invalid or expired browser ticket"); }
  }
  cookie(req: Request, name: string): string | undefined {
    name = this.cookieName(name);
    const values = (req.headers.cookie ?? "").split(";").map(v => v.trim())
      .filter(v => v.startsWith(`${name}=`)).map(v => v.slice(name.length + 1));
    if (values.length > 1) return fail(400, "Ambiguous browser session");
    return values[0];
  }
  binding(req: Request, res?: Response): string {
    const existing = this.cookie(req, BINDING);
    if (existing && /^[A-Za-z0-9_-]{43}$/.test(existing)) return existing;
    if (!res) return fail(403, "Browser binding required");
    const value = randomBytes(32).toString("base64url");
    this.setCookie(res, BINDING, value);
    return value;
  }
  ownerCookie(req: Request) { return this.cookie(req, OWNER); }
  setOwner(res: Response, token: string) { this.setCookie(res, OWNER, token); }
  clearOwner(res: Response) {
    res.clearCookie(this.cookieName(OWNER), { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  }
  private setCookie(res: Response, name: string, value: string) {
    res.cookie(this.cookieName(name), value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: WEB_TTL });
  }
  csrf(binding: string, flow: string, ownerCookie?: string) {
    return createHmac("sha256", this.key()).update(
      `csrf:${digest(binding)}:${digest(flow)}:${digest(ownerCookie ?? "")}`).digest("base64url");
  }
  checkPost(req: Request, flow: string, actual: unknown) {
    if (req.headers.origin !== this.origin || req.headers["sec-fetch-site"] === "cross-site")
      return fail(403, "Same-origin browser action required");
    const expected = Buffer.from(this.csrf(this.binding(req), flow, this.ownerCookie(req)));
    const given = Buffer.from(typeof actual === "string" ? actual : "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return fail(403, "Invalid CSRF token");
  }
}
