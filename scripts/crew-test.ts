/**
 * Owner-approved post-Publish checks. No login/session impersonation.
 * Key comes only from CREW_TEST_KEY. Never print headers, errors or payloads
 * containing credentials. This file does nothing unless explicitly executed.
 *
 * npx tsx scripts/crew-test.ts state|writeoff|structure|latency
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { crewTestRpc } from "./lib/crew-test-rpc";
import { LEGACY_AMOUNT, LEGACY_TASK_ID } from "../server/aiCrew/legacyUnknown";
async function main() {
  const key = process.env.CREW_TEST_KEY;
  if (!key || key.length < 43) throw Error("CREW_TEST_KEY_NOT_CONFIGURED");
  const action = process.argv[2];
  if (!["state", "structure", "writeoff", "latency"].includes(action)) throw Error("USE_STATE_STRUCTURE_WRITEOFF_OR_LATENCY");
  async function rpc(method: string, params?: unknown): Promise<any> {
    return crewTestRpc(method, params, key!);
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
  if (action === "writeoff") {
    const before = await read();
    const old = before.legacyStalledCandidates?.find((t: any) => t.taskId === LEGACY_TASK_ID);
    if (before.control.enabled || old?.runs.length !== 1 || old.runs[0].status !== "unknown" ||
        old.runs[0].reserved !== LEGACY_AMOUNT) throw Error("WRITEOFF_PRECONDITION_STOP");
    const after = await command({ action: "writeoff_legacy_unknown" });
    const receipt = after.writtenOffLegacy?.find((r: any) => r.taskId === LEGACY_TASK_ID);
    if (after.control.enabled || receipt?.status !== "discarded" || receipt.reserved !== 0 ||
        receipt.cost !== LEGACY_AMOUNT || after.grant.spent !== before.grant.spent + LEGACY_AMOUNT ||
        (after.legacyStalledCandidates ?? []).some((t: any) => t.taskId === LEGACY_TASK_ID))
      throw Error("WRITEOFF_READBACK_STOP_NO_RETRY");
    console.log(JSON.stringify(after, null, 2)); return;
  }
  if (action !== "latency") {
    const data = action === "state" ? await read() : await rpc("tools/call", { name: "crew_structure_check", arguments: {} });
    // Scope response omits credential hashes, unrelated owner docs and excerpts.
    console.log(JSON.stringify(data, null, 2)); return;
  }
  let s = await read();
  if (s.control.enabled) throw Error("INITIAL_STATE_NOT_OFF");
  // No generic cleanup. The exact approved writeoff is a separate action before
  // structure check; any remaining legacy candidate requires a new decision.
  if ((s.legacyStalledCandidates ?? []).length) throw Error("LEGACY_REQUIRES_OWNER_REVIEW");
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
