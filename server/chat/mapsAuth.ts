import { JWT } from "google-auth-library";
import { ChatError } from "./contracts";

/** App-runtime only. Secret material is never logged, returned, or sent to a model. */
export function mapsConfigured() {
  return !!(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}
let cached: { raw: string; client: JWT; project: string } | undefined;
export async function mapsHeaders(signal: AbortSignal): Promise<Record<string, string>> {
  if (signal.aborted) throw new ChatError("PLACES_REQUEST_CANCELLED", 499);
  if (process.env.GOOGLE_MAPS_API_KEY) return { "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY };
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new ChatError("PLACES_NOT_CONFIGURED", 503);
  if (cached?.raw !== raw) {
    try {
      const c = JSON.parse(raw);
      if (c.type !== "service_account" || typeof c.client_email !== "string" ||
          typeof c.private_key !== "string" || typeof c.project_id !== "string")
        throw Error("invalid");
      const client = new JWT({ email: c.client_email, key: c.private_key,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
      client.transporter.defaults = { ...client.transporter.defaults, timeout: 12000, retry: false };
      cached = { raw, client, project: c.project_id };
    } catch { throw new ChatError("MAPS_CREDENTIAL_INVALID", 503); }
  }
  let token: string | null | undefined;
  try { token = (await cached!.client.getAccessToken()).token; }
  catch { throw new ChatError("MAPS_AUTH_FAILED", 503); }
  if (signal.aborted) throw new ChatError("PLACES_REQUEST_CANCELLED", 499);
  if (!token) throw new ChatError("MAPS_AUTH_FAILED", 503);
  return { Authorization: `Bearer ${token}`, "X-Goog-User-Project": cached!.project };
}
