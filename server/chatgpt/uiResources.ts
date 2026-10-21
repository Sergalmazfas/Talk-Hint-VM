import { CALL_APPROVAL_RESOURCE } from "./callApprovalWidget";

/**
 * Connections retain descriptor snapshots. Changing the advertised template
 * must not strand an installed connection on a now-missing URI.
 * These are exact aliases, never paths or user-controlled resource fetches.
 */
export const LEGACY_CALL_APPROVAL_RESOURCES = [
  "ui://talkhint/call-approval/v1.html",
  "ui://talkhint/call-approval/v2.html",
  "ui://talkhint/call-approval/v3.html",
] as const;

export function callApprovalResource(uri: unknown) {
  return typeof uri === "string" && (uri === CALL_APPROVAL_RESOURCE ||
    (LEGACY_CALL_APPROVAL_RESOURCES as readonly string[]).includes(uri)) ? uri : undefined;
}

/** Only bounded, non-sensitive labels may reach server logs. */
export function uiResourceLabel(uri: unknown) {
  const allowed = callApprovalResource(uri);
  return allowed ? allowed.split("/").at(-1)!.replace(".html", "") : "unknown";
}

export function hostUiSupport(params: Record<string, unknown> | undefined): "advertised" | "not-advertised" {
  const capabilities = params?.capabilities as Record<string, any> | undefined;
  const types = capabilities?.extensions?.["io.modelcontextprotocol/ui"]?.mimeTypes;
  return Array.isArray(types) && types.includes("text/html;profile=mcp-app") ? "advertised" : "not-advertised";
}
