import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

// Canonical production endpoint, never caller-controlled. Redirects must not
// forward the credential. No CLI/env URL override, shell expansion or logging.
const endpoint = "https://talkhint.app/api/product-crew/mcp";

export async function callProductionMcp(method, params, { env = process.env, fetcher = fetch } = {}) {
  const key = env.PRODUCT_CREW_KEY;
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{43,512}$/.test(key))
    throw Error("PRODUCT_CREW_KEY is missing or invalid in project Secrets.");
  const id = randomUUID();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(endpoint, {
      method: "POST", redirect: "error", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-API-Key": key },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
    });
    if (!response.ok) throw Error("HTTP failure");
    const body = await response.json();
    if (JSON.stringify(body).includes(key) || body.jsonrpc !== "2.0" || body.id !== id ||
        body.error || !body.result || body.result.isError) throw Error("RPC failure");
    return body.result;
  } catch {
    // Never echo transport errors, responses, headers or secret-bearing URLs.
    throw Error("Production MCP request failed; result unconfirmed. No automatic retry.");
  } finally { clearTimeout(timer); }
}

export async function verifyProductionMcp(options) {
  const list = await callProductionMcp("tools/list", undefined, options);
  const names = list.tools?.map(t => t.name);
  if (!Array.isArray(names) || !["get_team", "get_roadmap"].every(n => names.includes(n)) ||
      names.includes("review_result")) throw Error("Unexpected production tool contract.");
  const team = (await callProductionMcp("tools/call", { name: "get_team", arguments: {} }, options)).structuredContent?.result;
  const roadmap = (await callProductionMcp("tools/call", { name: "get_roadmap", arguments: {} }, options)).structuredContent?.result;
  if (!Number.isSafeInteger(team?.revision) || team.revision !== roadmap?.revision || !Array.isArray(team.roles))
    throw Error("Production revision not verified; re-read before any model write.");
  return { endpoint, environment: "production", model: "new-country", tools: names,
    revision: team.revision, roles: team.roles.length, readOnly: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    console.error("Usage: node script/product-crew-production-mcp.mjs (read-only check; no arguments)");
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await verifyProductionMcp(), null, 2)); }
    catch { console.error("Production MCP not verified. Check secret provisioning, published build and disable status. No retry or model write."); process.exitCode = 1; }
  }
}
