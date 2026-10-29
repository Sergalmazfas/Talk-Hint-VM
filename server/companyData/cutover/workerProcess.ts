import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { access } from "node:fs/promises";
import { limitedWorker } from "../../limitedWorker";
import { cleanDiagnostic, cutoverMemory, exceptionCode, safeStderr, type CutoverDiagnostic } from "./diagnostics";

export async function startCutoverWorker(operation: string, observe: (d: CutoverDiagnostic) => Promise<void> = async () => {}) {
  await observe({ stage: "memory_read_started" });
  const memory = await cutoverMemory();
  await observe({ stage: "memory_gate", memory });
  if (!memory.passed) throw new Error("CUTOVER_MEMORY_RESERVE_UNAVAILABLE");
  const production = process.env.NODE_ENV === "production";
  const file = resolve(production ? "dist/company-cutover-worker.js" : "server/companyData/cutover/worker.ts");
  try { await access(file); } catch { throw new Error("CUTOVER_WORKER_FILE_UNAVAILABLE"); }
  await observe({ stage: "worker_file_verified" });
  const args = ["--max-old-space-size=2304", ...(production ? [file] : ["--import", "tsx", file])];
  await new Promise<void>((done, reject) => {
    const launch = limitedWorker("import", process.execPath, args);
    let child: ReturnType<typeof spawn>;
    try { child = spawn(launch.executable, launch.args, { stdio: ["pipe", "ignore", "pipe"] }); }
    catch (e) { reject(e); return; }
    let queue = Promise.resolve(), buffer = "", tail: string[] = [], inputError: unknown, diagnosticError: unknown;
    const record = (d: CutoverDiagnostic) => {
      queue = queue.then(() => observe(d)).catch(e => { diagnosticError = e; });
    };
    record({ stage: "spawn_requested" });
    child.once("spawn", () => record({ stage: "spawn", pid: child.pid }));
    const line = (text: string) => {
      if (text.startsWith("CUTOVER_DIAGNOSTIC ")) {
        try {
          const d = cleanDiagnostic(JSON.parse(text.slice("CUTOVER_DIAGNOSTIC ".length)));
          if (d) { record(d); return; }
        } catch { /* categorized below; never persist raw stderr */ }
      }
      tail = [...tail, safeStderr(text)].slice(-8);
    };
    child.stderr!.on("data", chunk => {
      buffer += String(chunk);
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const text of lines) line(text.slice(0, 8192));
      if (buffer.length > 8192) { line(buffer.slice(0, 8192)); buffer = ""; }
    });
    child.stdin!.on("error", e => {
      inputError = e;
      record({ stage: "input_error", exceptionCode: exceptionCode(e) });
      // Do not mark failed while a child can still be executing. Wait for close.
    });
    child.once("error", e => { record({ stage: "spawn_error", exceptionCode: exceptionCode(e) }); });
    child.once("close", (code, signal) => {
      if (buffer) line(buffer);
      record({ stage: "exit", exitCode: code, signal, stderr: tail });
      queue.then(() => diagnosticError ? reject(new Error("CUTOVER_DIAGNOSTICS_UNAVAILABLE")) : code === 0 && !inputError ? done() :
        reject(new Error(inputError ? "CUTOVER_WORKER_INPUT_UNAVAILABLE" : "CUTOVER_WORKER_UNCONFIRMED")), reject);
    });
    child.stdin!.end(JSON.stringify({ operation }));
  });
}
