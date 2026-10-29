import { resolve } from "node:path";

/** Kernel-enforced allocation ceilings, not just a JS heap configuration.
 * Linux/Python must be available; no unlimited fallback.
 */
export function limitedWorker(kind: "lab" | "import", executable: string, args: string[]) {
  const prefix = process.env.NODE_ENV === "production" ? "dist/" : "";
  return {
    executable: "python",
    args: ["-I", resolve(`${prefix}workers/hint_lab/limited_exec.py`),
      "--kind", kind, "--", executable, ...args],
  };
}
