/** Read-only call/report inspection; no calls, stop, model requests or settings. */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { RetellApi } from "../server/secretaryLab/retellApi";
if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") throw Error("Dev only");
const database = await import("../server/db");
const { storage } = await import("../server/storage");
await database.dbReady;
if (!database.isDevDatabase || !database.pool) throw Error("Dev only");
const token = randomBytes(32).toString("hex");
const owner = "47704265";
const dir = "generated-artifacts/secretary-speed-series/owner-c-review";
await mkdir(dir, { recursive: true });
const api = new RetellApi();
try {
  await storage.createSession(token, owner, new Date(Date.now() + 5 * 60_000));
  const get = async (path: string) => {
    const r = await fetch(`https://${process.env.REPLIT_DEV_DOMAIN}${path}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw Error(`Read HTTP ${r.status}`);
    return r.json();
  };
  const candidates = await get("/api/admin/secretary-lab/comparisons/candidates");
  console.log("Recent reports:", JSON.stringify(candidates));
  const selected = candidates.runs.filter((r: any) => r.mode === "retell-engine" && r.model === "gpt-6-sol")
    .sort((a: any, b: any) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (selected) {
    const report = await get("/api/admin/secretary-lab/retell-engine/sessions/" + selected.id);
    await writeFile(dir + "/report.json", JSON.stringify(report, null, 2));
    console.log("Report:", JSON.stringify(report));
  }
  const list = await api.request("/v3/list-calls", {
    filter_criteria: { agent: [{ agent_id: "agent_60783c2dbbc828060eb33f4b6c" }] },
    sort_order: "descending", limit: 4,
  });
  if (!Array.isArray(list.items)) throw Error("Retell list-calls response must contain items");
  const items = list.items;
  console.log("Provider recent:", JSON.stringify(items.map((c: any) => ({
    callId: c.call_id, start: c.start_timestamp, end: c.end_timestamp, status: c.call_status,
    durationMs: c.duration_ms, reason: c.disconnection_reason,
  }))));
  if (items[0]) {
    const call = await api.request("/v2/get-call/" + encodeURIComponent(items[0].call_id));
    // No recording URLs, dynamic variables, metadata or capabilities retained.
    const safe = Object.fromEntries(["call_id", "call_status", "agent_id", "start_timestamp", "end_timestamp",
      "duration_ms", "disconnection_reason", "transcript", "transcript_object", "transcript_with_tool_calls",
      "latency", "call_cost", "llm_token_usage", "call_analysis"].filter(k => call[k] !== undefined).map(k => [k, call[k]]));
    await writeFile(dir + "/provider.json", JSON.stringify(safe, null, 2));
    console.log("Provider:", JSON.stringify(safe));
  }
} finally {
  await storage.deleteSession(token);
  await database.pool.end();
}
