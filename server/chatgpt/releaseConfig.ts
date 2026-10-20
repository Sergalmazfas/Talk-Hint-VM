import type { IntegrationConfig } from "./routes";

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
  return {
    // The approved next release exposes read-only MCP. An explicit kill switch
    // still works; development remains opt-in and the running VM is untouched.
    enabled: settings.CHATGPT_SECRETARY_ENABLED === "true" ||
      (production && settings.CHATGPT_SECRETARY_ENABLED !== "false"),
    origin: settings.CHATGPT_SECRETARY_ORIGIN || (production ? MCP_RELEASE_ORIGIN : ""),
    clientId: MCP_CLIENT_ID,
    redirectUri: isChatGPTMcpCallback(callback) ? callback : "",
    signingKey,
    // Intentionally NOT controlled by any existing outbound environment flag.
    // This rollout cannot enable calls, incoming handling or forwarding.
    outboundEnabled: false,
  };
}
