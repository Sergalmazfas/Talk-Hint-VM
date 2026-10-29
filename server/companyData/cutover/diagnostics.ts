import { freemem, totalmem } from "node:os";
import { readFile, readdir } from "node:fs/promises";

export type CutoverDiagnostic = {
  stage: string; at?: string; operation?: string; exceptionCode?: string; exitCode?: number | null;
  signal?: string | null; pid?: number; stderr?: string[];
  memory?: { osFree: number; osTotal: number; cgroupLimit: number | null;
    cgroupUsed: number | null; effectiveFree: number; required: number; passed: boolean };
  environment?: { production: boolean; databaseUrlPresent: boolean };
};
const codes: Record<string, string> = {
  "Baseline SHA mismatch": "CUTOVER_BASELINE_SHA_MISMATCH",
  "Root revision mismatch": "CUTOVER_ROOT_REVISION_MISMATCH",
  "Control pin mismatch": "CUTOVER_CONTROL_PIN_MISMATCH",
  "Source generation mismatch": "CUTOVER_GENERATION_MISMATCH",
};
/** Never persist arbitrary exception messages: SQL, URLs and credentials may be embedded. */
export function exceptionCode(error: unknown): string {
  const e = error as { code?: unknown; message?: unknown; status?: number };
  if (typeof e?.code === "string" && /^(CUTOVER_[A-Z0-9_]{1,70}|ERR_[A-Z0-9_]{1,70}|[0-9][A-Z0-9]{4}|ENOENT|EPIPE|EACCES)$/.test(e.code))
    return e.code;
  if (typeof e?.message === "string") {
    if (/^CUTOVER_[A-Z0-9_]{1,70}$/.test(e.message)) return e.message;
    if (codes[e.message]) return codes[e.message];
  }
  return e?.status ? `CUTOVER_HTTP_${e.status}` : "CUTOVER_UNCLASSIFIED_EXCEPTION";
}
export function cleanDiagnostic(value: any): CutoverDiagnostic | null {
  if (!value || typeof value.stage !== "string" || !/^[a-z_]{1,50}$/.test(value.stage)) return null;
  const d: CutoverDiagnostic = { stage: value.stage, at: new Date().toISOString() };
  if (typeof value.operation === "string" && /^[a-f0-9-]{36}$/.test(value.operation)) d.operation = value.operation;
  if (typeof value.exceptionCode === "string") d.exceptionCode = exceptionCode({ code: value.exceptionCode });
  if (value.exitCode === null || Number.isSafeInteger(value.exitCode)) d.exitCode = value.exitCode;
  if (value.signal === null || /^SIG[A-Z0-9]{1,12}$/.test(value.signal)) d.signal = value.signal;
  if (Number.isSafeInteger(value.pid) && value.pid > 0) d.pid = value.pid;
  if (value.environment) d.environment = {
    production: value.environment.production === true, databaseUrlPresent: value.environment.databaseUrlPresent === true };
  if (value.memory) {
    const m = value.memory;
    if (["osFree", "osTotal", "effectiveFree", "required"].every(k => Number.isFinite(m[k]) && m[k] >= 0) &&
        ["cgroupLimit", "cgroupUsed"].every(k => m[k] === null || Number.isFinite(m[k]) && m[k] >= 0))
      d.memory = { osFree: m.osFree, osTotal: m.osTotal, effectiveFree: m.effectiveFree,
        required: m.required, cgroupLimit: m.cgroupLimit, cgroupUsed: m.cgroupUsed, passed: m.passed === true };
  }
  if (Array.isArray(value.stderr)) d.stderr = value.stderr.slice(-8).map(safeStderr);
  return d;
}
export function safeStderr(line: unknown): string {
  const s = String(line).slice(0, 4096);
  // Whitelist categories rather than attempting to redact unknown provider/SQL text.
  if (/heap out of memory|allocation failed/i.test(s)) return "[runtime: allocation failed]";
  if (/Cannot find module|ERR_MODULE_NOT_FOUND/i.test(s)) return "[runtime: module unavailable]";
  if (/failed to map|mmap|Failed to reserve|Fatal process out of memory/i.test(s)) return "[runtime: memory mapping failed]";
  if (/CUTOVER_[A-Z0-9_]+/.test(s)) return s.match(/CUTOVER_[A-Z0-9_]+/)![0];
  return "[stderr withheld: unstructured output]";
}
export function emitDiagnostic(value: CutoverDiagnostic) {
  const d = cleanDiagnostic(value);
  if (d) console.error("CUTOVER_DIAGNOSTIC " + JSON.stringify(d));
}
export async function cutoverMemory(): Promise<NonNullable<CutoverDiagnostic["memory"]>> {
  const osTotal = totalmem(), osFree = freemem();
  let cgroupLimit: number | null = null, cgroupUsed: number | null = null;
  try {
    const [limit, used] = await Promise.all([
      readFile("/sys/fs/cgroup/memory.max", "utf8"), readFile("/sys/fs/cgroup/memory.current", "utf8")]);
    if (limit.trim() !== "max") cgroupLimit = Number(limit);
    cgroupUsed = Number(used);
    if ((cgroupLimit !== null && !Number.isFinite(cgroupLimit)) || !Number.isFinite(cgroupUsed))
      throw new Error("CUTOVER_INVALID_CGROUP");
  } catch (e: any) {
    if (!["ENOENT", "ENOTDIR"].includes(e?.code)) throw new Error("CUTOVER_MEMORY_READING_UNAVAILABLE");
    cgroupLimit = null; cgroupUsed = null;
  }
  const limit = Math.min(osTotal, cgroupLimit ?? osTotal);
  const effectiveFree = Math.max(0, Math.min(osFree, cgroupLimit === null ? osFree : limit - (cgroupUsed ?? 0)));
  const required = 3.75 * 1024 ** 3;
  return { osTotal, osFree, cgroupLimit, cgroupUsed, effectiveFree, required,
    passed: limit >= 4 * 1024 ** 3 && effectiveFree >= required };
}
/** Conservative VM-local check, in addition to the database lease and write fence.
 * A missing/unreadable proc directory is NOT proof of absence. No argv is logged.
 */
export async function assertNoOtherCutoverProcess() {
  const entries = await readdir("/proc", { withFileTypes: true });
  for (const entry of entries) {
    if (!/^\d+$/.test(entry.name) || Number(entry.name) === process.pid) continue;
    let cmd: string;
    try { cmd = await readFile(`/proc/${entry.name}/cmdline`, "utf8"); }
    catch (e: any) {
      if (e?.code === "ENOENT" || e?.code === "ESRCH") continue;
      throw new Error("CUTOVER_PROCESS_SCAN_UNAVAILABLE");
    }
    if (cmd.includes("company-cutover-worker.js") || cmd.includes("/companyData/cutover/worker.ts"))
      throw new Error("CUTOVER_OTHER_WORKER_ALIVE");
  }
}
export const workerLock = (owner: string, env: string) => `company-cutover-worker:${env}:${owner}`;
