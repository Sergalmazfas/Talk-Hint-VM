/** Runtime-only stderr, never AI output. Default deny rather than trying to
 * redact every possible secret/PII shape from arbitrary Python exception text.
 */
const signals = new Set(["SIGKILL", "SIGTERM", "SIGABRT", "SIGSEGV", "SIGINT"]);
const launchCodes = new Set(["ENOENT", "EACCES", "ENOMEM", "EAGAIN", "ETIMEDOUT", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"]);
const modules = new Set(["crewai", "openai", "litellm", "pydantic", "chromadb", "resource", "sqlite3", "httpx"]);
export function safePythonStderr(stderr: unknown): string[] {
  if (typeof stderr !== "string") return [];
  return stderr.slice(-8192).split(/\r?\n/).map(s => s.replace(/\x1b\[[0-9;]*m/g, "").trim())
    .filter(Boolean).slice(-6).map(line => {
      if (line === "Traceback (most recent call last):") return line;
      const module = /^ModuleNotFoundError: No module named ['"]([a-zA-Z0-9_.]+)['"]$/.exec(line);
      if (module) return `ModuleNotFoundError: No module named '${modules.has(module[1]) ? module[1] : "[module redacted]"}'`;
      const frame = /^File ".*", line ([0-9]{1,7}), in (?:<module>|[a-zA-Z0-9_]+)$/.exec(line);
      if (frame) return `File [path redacted], line ${frame[1]}`;
      if (/^(MemoryError|RecursionError|TimeoutError)(?::.*)?$/.test(line)) return line.split(":")[0];
      if (/^OSError: \[Errno 12\] Cannot allocate memory$/.test(line)) return line;
      if (/^SyntaxError: invalid syntax$/.test(line)) return line;
      if (/^(ImportError|RuntimeError|TypeError|ValueError|OSError|PermissionError):/.test(line))
        return `${line.split(":")[0]}: [details redacted]`;
      return "[unclassified stderr redacted]";
    });
}
export class LabPythonUnavailableError extends Error {
  readonly runtimeDiagnostic;
  constructor(error: unknown, stderr: unknown) {
    super("LAB_PYTHON_UNAVAILABLE");
    const e = error as {code?: unknown; signal?: unknown; killed?: unknown} | null;
    this.runtimeDiagnostic = {
      exit_code: typeof e?.code === "number" && Number.isInteger(e.code) && e.code >= 0 && e.code <= 255 ? e.code : null,
      signal: typeof e?.signal === "string" && signals.has(e.signal) ? e.signal : null,
      launch_code: typeof e?.code === "string" && launchCodes.has(e.code) ? e.code : null,
      killed: e?.killed === true,
      stderr_tail: safePythonStderr(stderr),
      stderr_policy: "last_6_lines_allowlist_unknown_redacted" as const,
    };
  }
}
