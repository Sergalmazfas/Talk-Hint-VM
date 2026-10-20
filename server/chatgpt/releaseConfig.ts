import type { IntegrationConfig } from "./routes";
import type { Scope } from "./security";

// Verified with getDeploymentInfo on 2026-10-20. Never derive production URLs
// from REPLIT_DEV_DOMAIN. This profile takes effect only in the NEXT build/run.
export const MCP_RELEASE_ORIGIN = "https://talkhint.app";
export const MCP_CLIENT_ID = "talkhint-chatgpt";

export function isChatGPTMcpCallback(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === "https://chatgpt.com" && !url.username && !url.password &&
      !url.search && !url.hash &&
      (url.pathname === "/connector_platform_oauth_redirect" ||
        /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(url.pathname));
  } catch { return false; }
}

/** No environment writes, auth, DB or provider calls. Failures affect only MCP. */
export function mcpReleaseConfiguration(
  settings: Record<string, string | undefined>, production: boolean, signingKey: () => string,
): IntegrationConfig {
  const callback = settings.CHATGPT_SECRETARY_REDIRECT_URI || "";
  const enabled = settings.CHATGPT_SECRETARY_ENABLED === "true" ||
    (production && settings.CHATGPT_SECRETARY_ENABLED !== "false");
  const redirectUri = isChatGPTMcpCallback(callback) ? callback : "";
  // New, explicit opt-in: old broad outbound flags must never unlock dialing.
  // Even this mode still requires OAuth write permission AND per-call approval.
  const outboundEnabled = enabled && !!redirectUri &&
    settings.CHATGPT_SECRETARY_CALL_MODE === "owner-confirmed";
  const allowedScopes: Scope[] = ["calls:read", "calls:transcript", "offline_access"];
  if (outboundEnabled) allowedScopes.push("secretary:start");
  return {
    // Read-only unless the new confirmed-outbound mode is explicitly selected.
    // Development remains opt-in; configuring this object never changes a VM.
    enabled,
    origin: settings.CHATGPT_SECRETARY_ORIGIN || (production ? MCP_RELEASE_ORIGIN : ""),
    clientId: MCP_CLIENT_ID,
    redirectUri,
    signingKey,
    outboundEnabled,
    // Enabling outbound must not expose incoming permissions or controls.
    allowedScopes,
  };
}
