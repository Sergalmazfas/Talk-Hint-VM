/** Isolated child process. No telephone, DB, Gmail or session credentials enter CrewAI. */
import { spawn } from "node:child_process";
import path from "node:path";

export function runHintLab(source: unknown, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<any> {
  const input = JSON.stringify(source);
  if (Buffer.byteLength(input) > 150_000) return Promise.reject(new Error("LAB_SOURCE_TOO_LARGE"));
  if (!process.env.OPENAI_API_KEY) return Promise.reject(new Error("LAB_MODEL_KEY_MISSING"));
  if (options.signal?.aborted) return Promise.reject(new Error("LAB_DISABLED"));
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME, PYTHONPATH: process.cwd(),
    PYTHONUNBUFFERED: "1", OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    LAB_MODEL: process.env.LAB_MODEL || "gpt-5.2",
    OTEL_SDK_DISABLED: "true", CREWAI_TRACING_ENABLED: "false", CREWAI_TELEMETRY_DISABLED: "true",
  };
  // python in the Replit-managed Python module loads .pythonlibs; use uv locked environment in releases.
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "--frozen", "--no-sync", "python",
      path.resolve("workers/hint_lab/pipeline.py")], { env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", settled = false;
    const end = (error?: Error, value?: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
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
            report.framework?.version !== "1.15.30") throw new Error();
        end(undefined, report);
      } catch { end(new Error("LAB_INVALID_REPORT")); }
    });
    child.stdin.on("error", () => end(new Error("LAB_INPUT_FAILED")));
    child.stdin.end(input);
  });
}
