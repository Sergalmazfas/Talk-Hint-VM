import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { digest, fail } from "./security";

/** Confidential-client Actions exchange, deliberately NOT a relaxed MCP flow. */
export function actionsExchange(req: Request, clientId: string, secret: string, resource: string) {
  const body = { ...req.body };
  const reject = (): never => {
    throw Object.assign(new Error("invalid_client"), { status: 401, oauthCode: "invalid_client" });
  };
  if (!secret || secret.length < 32) return fail(503, "Actions client unavailable");
  const header = req.headers.authorization;
  if (header) {
    if (!header.startsWith("Basic ") || body.client_secret !== undefined) return reject();
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const at = decoded.indexOf(":");
    if (at < 1) return reject();
    const id = decoded.slice(0, at);
    if (body.client_id !== undefined && body.client_id !== id) return reject();
    body.client_id = id;
    body.client_secret = decoded.slice(at + 1);
  }
  if (body.client_id !== clientId || typeof body.client_secret !== "string" ||
      !timingSafeEqual(Buffer.from(digest(body.client_secret)), Buffer.from(digest(secret)))) return reject();
  delete body.client_secret;
  if (body.resource !== undefined && body.resource !== resource)
    throw Object.assign(new Error("invalid_target"), { status: 400, oauthCode: "invalid_target" });
  body.resource = resource;
  return body;
}
