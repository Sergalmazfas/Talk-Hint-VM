import { createHmac, timingSafeEqual } from "node:crypto";

// Only the signed Twilio voice webhook can mint this per-attempt credential.
// The media WebSocket upgrade itself is not Twilio-signature authenticated.
export function signSecretaryStream(taskId: string, callSid: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Secretary media authorization is not configured");
  return createHmac("sha256", secret)
    .update(`secretary-stream:v1:${taskId}:${callSid}`)
    .digest("hex");
}

export function verifySecretaryStream(taskId: string, callSid: string, signature: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  try {
    const expected = Buffer.from(signSecretaryStream(taskId, callSid), "hex");
    return timingSafeEqual(expected, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}