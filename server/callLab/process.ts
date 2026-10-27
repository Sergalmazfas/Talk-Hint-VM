/** Isolated child process. No telephone, DB, Gmail or session credentials enter CrewAI. */
import { spawn, execFile } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import { readdir, lstat, rm } from "node:fs/promises";

export async function cleanupLabScratch() {
  const root = os.tmpdir(), cutoff = Date.now() - 7 * 86_400_000;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("talkhint-plab-run-")) continue;
    const dir = path.join(root, entry.name);
    const stat = await lstat(dir);
    if (!stat.isSymbolicLink() && stat.mtimeMs < cutoff) await rm(dir, { recursive: true, force: true });
  }
}

function workerEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH, HOME: process.env.HOME,
    PYTHONPATH: [process.env.PYTHONPATH, path.resolve(".pythonlibs/lib/python3.11/site-packages"), process.cwd()]
      .filter(Boolean).join(path.delimiter),
    PYTHONUNBUFFERED: "1", OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    LAB_MODEL: process.env.LAB_MODEL || "gpt-5.2",
    OTEL_SDK_DISABLED: "true", CREWAI_TRACING_ENABLED: "false", CREWAI_TELEMETRY_DISABLED: "true",
  };
}
export function checkHintLabRuntime(): Promise<{ framework: string; version: string }> {
  return new Promise((resolve, reject) => {
    execFile("python", ["-c", "import json; from crewai import Agent,Crew; from importlib.metadata import version; print(json.dumps({'framework':'crewai','version':version('crewai')}))"],
      { env: workerEnv(), timeout: 30_000 }, (error, stdout) => {
        if (error) return reject(new Error("LAB_PYTHON_UNAVAILABLE"));
        try {
          const p = JSON.parse(stdout);
          if (p.version !== "1.15.30") throw new Error();
          resolve(p);
        } catch { reject(new Error("LAB_PYTHON_VERSION_MISMATCH")); }
      });
  });
}
export function runHintLab(source: unknown, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<any> {
  const snapshot = source as any;
  if (!snapshot || snapshot.mode !== "hint" || snapshot.owner_verified !== true || snapshot.processing_authorized !== true) {
    return Promise.reject(new Error("LAB_SOURCE_SCOPE_REJECTED"));
  }
  const input = JSON.stringify(source);
  if (Buffer.byteLength(input) > 150_000) return Promise.reject(new Error("LAB_SOURCE_TOO_LARGE"));
  if (!process.env.OPENAI_API_KEY) return Promise.reject(new Error("LAB_MODEL_KEY_MISSING"));
  if (options.signal?.aborted) return Promise.reject(new Error("LAB_DISABLED"));
  const env = workerEnv();
  const scratch = mkdtempSync(path.join(os.tmpdir(), "talkhint-plab-run-"));
  env.XDG_DATA_HOME = scratch;
  env.CREWAI_STORAGE_DIR = scratch;
  env.PLAB_TEMP_DIR = scratch;
  const script = process.env.NODE_ENV === "production" ? "dist/workers/hint_lab/pipeline.py" : "workers/hint_lab/pipeline.py";
  return new Promise((resolve, reject) => {
    const child = spawn("python", [path.resolve(script)], { env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", settled = false;
    const end = (error?: Error, value?: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (error && child.exitCode === null) child.kill("SIGKILL");
      void rm(scratch, { recursive: true, force: true }).catch(() => {}).finally(() => {
        if (error) reject(error); else resolve(value);
      });
    };
    const abort = () => { child.kill("SIGKILL"); end(new Error("LAB_CANCELED")); };
    const timer = setTimeout(abort, options.timeoutMs ?? 10 * 60_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > 250_000) { child.kill("SIGKILL"); end(new Error("LAB_OUTPUT_TOO_LARGE")); }
    });
    // Never log raw provider output; it can contain personal prompts.
    child.stderr.resume();
    child.once("error", () => end(new Error("LAB_PYTHON_UNAVAILABLE")));
    child.once("close", code => {
      if (settled) return;
      if (code !== 0) return end(new Error("LAB_ANALYSIS_FAILED"));
      try {
        const report = JSON.parse(output);
        if (report.format !== "talkhint.plab.call-report" || report.mode !== "hint" ||
            report.framework?.version !== "1.15.30" || report.call_id !== snapshot.call_id ||
            report.synthetic !== !!snapshot.synthetic || report.environment !== snapshot.environment) throw new Error();
        end(undefined, report);
      } catch { end(new Error("LAB_INVALID_REPORT")); }
    });
    child.stdin.on("error", () => end(new Error("LAB_INPUT_FAILED")));
    child.stdin.end(input);
  });
}
