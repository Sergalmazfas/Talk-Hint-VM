import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 15 * 60_000;

function signature(payload: string): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Secretary task confirmation is not configured");
  return createHmac("sha256", secret).update(`secretary-confirm:v1:${payload}`).digest();
}

// Issued only after a Secretary PREPARE goal was explicitly confirmed. The
// token binds the owner and exact reviewed assignment to the task POST, not to
// the owner's Hint goal. It expires shortly after the review step.
export function signSecretaryConfirmation(userId: string, instruction: string): string {
  const payload = Buffer.from(JSON.stringify({
    userId, instruction: instruction.trim(), issuedAt: Date.now(),
  })).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function verifySecretaryConfirmation(token: unknown, userId: string, instruction: string): boolean {
  if (typeof token !== "string" || token.length > 4096) return false;
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra) return false;
  try {
    const got = Buffer.from(encodedSignature, "base64url");
    const expected = signature(payload);
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return false;
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return body.userId === userId && body.instruction === instruction.trim() &&
      typeof body.issuedAt === "number" && body.issuedAt <= Date.now() &&
      Date.now() - body.issuedAt <= TTL_MS;
  } catch {
    return false;
  }
}