import type { Metafile } from "esbuild";

/** Assert inclusion, not just existence of source files in the workspace. */
export function verifyMcpBuild(meta: Metafile, bundle: string) {
  const required = ["server/routes.ts", "server/chatgpt/routes.ts", "server/chatgpt/releaseConfig.ts",
    "server/chatgpt/security.ts", "server/chatgpt/browser.ts", "server/chatgpt/store.ts",
    "server/chatgpt/secretary.ts"];
  const included = Object.values(meta.outputs).flatMap(output =>
    Object.entries(output.inputs).filter(([, detail]) => detail.bytesInOutput > 0).map(([name]) => name));
  for (const file of required) {
    if (!included.includes(file)) throw new Error(`MCP build gate: missing runtime module ${file}`);
  }
  for (const route of ["/api/chatgpt/mcp", "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server", "talkhint-chatgpt"]) {
    if (!bundle.includes(route)) throw new Error(`MCP build gate: missing public contract ${route}`);
  }
  return { check: "mcp-runtime-inclusion", passed: true, modules: required };
}
