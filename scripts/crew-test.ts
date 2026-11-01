/**
 * Owner-approved post-Publish checks. No login/session impersonation.
 * Key comes only from CREW_TEST_KEY. Never print headers, errors or payloads
 * containing credentials. This file does nothing unless explicitly executed.
 *
 * npx tsx scripts/crew-test.ts state|structure|latency
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const endpoint = "https://talkhint.app/api/crew-test/mcp";
async function main() {
  const key = process.env.CREW_TEST_KEY;
  if (!key || key.length < 43) throw Error("CREW_TEST_KEY_NOT_CONFIGURED");
  const action = process.argv[2];
  if (!["state", "structure", "latency"].includes(action)) throw Error("USE_STATE_STRUCTURE_OR_LATENCY");
  async function rpc(method: string, params?: unknown): Promise<any> {
    const r = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", "X-API-Key": key! },
      body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }) });
    const b = await r.json() as any;
    if (!r.ok || b.error) throw Error("MCP_UNCONFIRMED_STOP_NO_RETRY");
    return method === "tools/call" ? JSON.parse(b.result.content[0].text) : b.result;
  }
  async function read() { return rpc("tools/call", { name: "crew_test_state", arguments: {} }); }
  async function command(command: object) {
    const before = await read();
    const c = command as any;
    const ack = await rpc("tools/call", { name: `crew_test_${c.action}`,
      arguments: { revision: before.revision, requestId: randomUUID(), command } });
    const after = await read();
    if (!ack.saved || ack.revision !== before.revision + 1 || after.revision < ack.revision)
      throw Error("WRITE_READBACK_MISMATCH_STOP");
    return after;
  }
  await rpc("tools/list");
  if (action !== "latency") {
    const data = action === "state" ? await read() : await rpc("tools/call", { name: "crew_structure_check", arguments: {} });
    // Scope response omits credential hashes, unrelated owner docs and excerpts.
    console.log(JSON.stringify(data, null, 2)); return;
  }
  let s = await read();
  if (s.control.enabled) throw Error("INITIAL_STATE_NOT_OFF");
  // Approved safe legacy cleanup only; no release of unknown reservations.
  for (const old of s.legacyStalledCandidates ?? []) {
    if (old.runs.some((r: any) => !["queued", "discarded"].includes(r.status) || r.reserved || r.cost))
      throw Error("LEGACY_EXECUTION_REQUIRES_OWNER_REVIEW");
    s = await command({ action: "close_stalled", taskId: old.taskId });
    if ((s.legacyStalledCandidates ?? []).some((x: any) => x.taskId === old.taskId))
      throw Error("LEGACY_CLOSE_NOT_CONFIRMED");
  }
  s = await command({ action: "prepare", candidate: "latency" });
  const task = s.tasks.find((t: any) => !t.closed && t.hintPilot?.status === "prepared");
  if (!task || s.control.enabled) throw Error("PREPARE_NOT_CONFIRMED");
  s = await command({ action: "enable", taskId: task.id });
  if (!s.control.enabled || s.grant.limit !== 5_000_000) throw Error("ENABLE_NOT_CONFIRMED");
  s = await command({ action: "start", taskId: task.id });
  if (!s.runs.some((r: any) => r.taskId === task.id && ["queued", "running", "done"].includes(r.status)))
    throw Error("START_NOT_CONFIRMED");
  const deadline = Date.now() + 5 * 60000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    s = await read();
    const current = s.tasks.find((t: any) => t.id === task.id);
    if (current?.hintPilot?.status === "owner") break;
    if (s.runs.some((r: any) => r.taskId === task.id && r.status === "unknown") || !s.control.enabled) break;
  }
  if (s.control.enabled) s = await command({ action: "off" });
  if (s.control.enabled) throw Error("OFF_NOT_CONFIRMED");
  const folder = "generated-artifacts/crew-test-production";
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/result.json`, JSON.stringify(s, null, 2));
  console.log(JSON.stringify({ taskId: task.id, enabled: s.control.enabled,
    status: s.tasks.find((t: any) => t.id === task.id)?.hintPilot?.status,
    spentMicroUsd: s.grant.spent, reservedMicroUsd: s.grant.reserved,
    report: `${folder}/result.json` }));
}
main().catch(() => {
  // Do not retry uncertain paid commands. Independent server watchdog also
  // stops the series after five minutes even when this client disappears.
  console.error("CREW_TEST_STOP: проверьте состояние; записи не повторять. Watchdog сервера действует независимо.");
  process.exitCode = 1;
});
