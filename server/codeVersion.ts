import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import release from "../docs/releases/current.json";

declare const __TALKHINT_BUILD__: ReturnType<typeof sourceVersion>;
/** Source fingerprint distinguishes uncommitted review code from a clean HEAD.
 * Never executes the application, reads secrets or includes attached artifacts. */
export function sourceVersion() {
  const hash = createHash("sha256");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|json|sql|html|css)$/.test(entry.name)) hash.update(path).update(readFileSync(path));
    }
  };
  for (const dir of ["server", "shared", "client/src", "script"]) walk(dir);
  for (const path of ["package.json", "package-lock.json", "docs/releases/current.json"]) {
    try { hash.update(path).update(readFileSync(path)); } catch { /* lockfile may not exist */ }
  }
  let commit: string | null = null, dirty = true;
  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (/^[a-f0-9]{40}$/.test(value)) commit = value;
    dirty = !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  } catch { /* unknown is explicit, never guessed */ }
  return { commit, dirty, sourceHash: hash.digest("hex"), builtAt: new Date().toISOString(),
    taskRef: release.taskRef, fixes: release.fixes };
}
let cached: ReturnType<typeof sourceVersion> | undefined;
export function codeVersion() {
  return typeof __TALKHINT_BUILD__ !== "undefined" ? __TALKHINT_BUILD__ : (cached ??= sourceVersion());
}
export function stampCallMetadata(metadata: unknown) {
  const { commit, sourceHash, dirty, builtAt } = codeVersion();
  return { ...(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}),
    // Ordinary clients need provenance, not internal release/task descriptions.
    codeVersion: { commit, sourceHash, dirty, builtAt } };
}
export function recordedCallVersion(call: any) {
  return call?.metadata?.codeVersion ?? null;
}
