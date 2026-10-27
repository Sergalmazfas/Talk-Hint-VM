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

const failureCodes = new Set(["LAB_ANALYSIS_FAILED", "LAB_ANALYSIS_TIMEOUT", "LAB_INVALID_REPORT",
  "LAB_PYTHON_UNAVAILABLE", "LAB_CANCELED", "LAB_OUTPUT_TOO_LARGE", "LAB_INPUT_FAILED",
  "MODEL_TIMEOUT", "MODEL_RATE_LIMIT", "MODEL_AUTH", "MODEL_CONNECTION", "MODEL_HTTP_ERROR",
  "OUTPUT_SCHEMA_INVALID", "UNKNOWN_EVIDENCE_EVENT", "MODEL_OR_INPUT_FAILURE"]);
export function labAnalysisFailure(error: unknown) {
  const e = error as any;
  const value = e?.diagnostic;
  const code = failureCodes.has(value?.code) ? value.code :
    failureCodes.has(e?.message) ? e.message : "LAB_ANALYSIS_FAILED";
  return {
    code,
    stage: ["analysis", "qa", "letter", "source"].includes(value?.stage) ? value.stage : "worker",
    ...(Number.isInteger(value?.http_status) && value.http_status >= 400 && value.http_status <= 599
      ? { http_status: value.http_status } : {}),
    ...(typeof value?.model === "string" && /^[a-z0-9./_-]{1,80}$/i.test(value.model) ? { model: value.model } : {}),
    ...(["Analysis", "QA", "Letter"].includes(value?.schema) ? { schema: value.schema } : {}),
    ...(Array.isArray(value?.schema_issues) ? { schema_issues: value.schema_issues.slice(0, 5).map((issue: any) => ({
      type: typeof issue?.type === "string" && /^[a-z_]{1,40}$/.test(issue.type) ? issue.type : "invalid",
      fields: Array.isArray(issue?.fields) ? issue.fields.filter((part: unknown) =>
        typeof part === "number" && Number.isSafeInteger(part) && part >= 0 && part <= 9999 ||
        ["summary_ru", "findings", "category", "event_id", "evidence", "explanation", "limitations",
          "proposals", "verdict", "issues", "quality_ru", "limitations_ru", "proposals_ru"].includes(String(part))) : [],
    })) } : {}),
  };
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
    let output = "", stderr = "", settled = false;
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
    const timer = setTimeout(() => end(new Error("LAB_ANALYSIS_TIMEOUT")), options.timeoutMs ?? 10 * 60_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > 250_000) { child.kill("SIGKILL"); end(new Error("LAB_OUTPUT_TOO_LARGE")); }
    });
    // Never log raw provider output; it can contain personal prompts.
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
    child.once("error", () => end(new Error("LAB_PYTHON_UNAVAILABLE")));
    child.once("close", code => {
      if (settled) return;
      if (code !== 0) {
        const error = new Error("LAB_ANALYSIS_FAILED") as Error & { diagnostic?: unknown };
        // Only the fixed structured envelope is retained, never raw provider text.
        for (const line of stderr.trim().split("\n").reverse()) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.status === "failed") {
              error.diagnostic = labAnalysisFailure({ diagnostic: parsed });
              break;
            }
          } catch { /* not a diagnostic envelope */ }
        }
        return end(error);
      }
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
