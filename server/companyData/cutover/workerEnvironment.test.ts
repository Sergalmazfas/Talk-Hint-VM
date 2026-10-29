import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, copyFile, symlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const project = process.cwd();
let fixture: string;
const receipts: any[] = [];
// Exercise bundling -> spawn -> actual Python limiter -> actual compiled/TS worker.
// The parent memory provider alone is a test fixture: Dev's free RAM is not
// assumed to satisfy production's 3.75 GiB reserve. No production hook/flag.
const memoryFixture = `
export async function cutoverMemory() {
  return {osFree:6442450944,osTotal:8589934592,cgroupLimit:null,cgroupUsed:null,
    effectiveFree:6442450944,required:4026531840,passed:true};
}`;
async function parent(name: string, mode: string | undefined, beforeFix = false) {
  await build({
    stdin: { contents: `
      import {startCutoverWorker} from ${JSON.stringify(resolve("server/companyData/cutover/workerProcess.ts"))};
      const diagnostics=[]; let error=null;
      try {await startCutoverWorker("offline-invalid-operation", async d=>{diagnostics.push(d)})}
      catch(e) {error=/^CUTOVER_[A-Z0-9_]+$/.test(e.message)?e.message:"UNCLASSIFIED";}
      console.log(JSON.stringify({error,diagnostics,parentMode:process.env.NODE_ENV??null}));
    `, resolveDir: project, sourcefile: "cutover-env-parent-fixture.ts" },
    outfile: join(fixture, `${name}.mjs`), bundle: true, minify: true,
    platform: "node", format: "esm", packages: "external",
    define: mode === undefined ? {} : { "process.env.NODE_ENV": JSON.stringify(mode) },
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    plugins: [{
      name: "test-only-memory-provider-and-before-fix-counterexample",
      setup(b) {
        b.onLoad({ filter: /[/\\]cutover[/\\]diagnostics\.ts$/ }, async args => ({
          contents: (await readFile(args.path, "utf8"))
            .replace("export async function cutoverMemory()", "async function originalMemoryProvider()") + memoryFixture,
          loader: "ts", resolveDir: resolve("server/companyData/cutover"),
        }));
        if (beforeFix) b.onLoad({ filter: /[/\\]cutover[/\\]workerProcess\.ts$/ }, async args => {
          const text = await readFile(args.path, "utf8");
          const line = "env: { ...process.env, NODE_ENV: process.env.NODE_ENV },";
          if (!text.includes(line)) throw new Error("Before-fix fixture no longer matches launcher");
          return { contents: text.replace(line, ""), loader: "ts", resolveDir: resolve("server/companyData/cutover") };
        });
      },
    }],
  });
}
async function run(parentName: string, ambientMode?: string) {
  // Explicit nonsecret test environment, NOT a copy of workspace credentials.
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH,
    DATABASE_URL: "postgresql://localhost:1/offline_not_used" };
  if (ambientMode !== undefined) env.NODE_ENV = ambientMode;
  const result = await exec(process.execPath, [join(fixture, `${parentName}.mjs`)], {
    cwd: fixture, env, timeout: 4000, maxBuffer: 64 * 1024,
  });
  const receipt = JSON.parse(result.stdout.trim());
  expect(result.stderr).toBe("");
  receipts.push({ parentName, ambientMode: ambientMode ?? null, ...receipt });
  await writeFile(join(fixture, "RECEIPTS.json"), JSON.stringify({
    productionTouched: false, sqlExecuted: false, realPythonLimiter: true,
    realWorker: true, parentMemoryProvider: "test fixture; NOT a live memory measurement",
    workerHeapMiB: 2304, workerDATABytes: 3221225472, cases: receipts,
  }, null, 2));
  return receipt;
}
function boot(r: any) { return r.diagnostics.find((d: any) => d.stage === "worker_boot"); }
function exception(r: any) { return r.diagnostics.find((d: any) => d.stage === "worker_exception")?.exceptionCode; }
describe("real bundled parent environment regression (offline, before SQL)", () => {
  beforeAll(async () => {
    await mkdir(resolve("generated-artifacts/cutover-env-regression"), { recursive: true });
    fixture = await mkdtemp(resolve("generated-artifacts/cutover-env-regression/run-"));
    for (const p of ["dist/workers/hint_lab", "workers/hint_lab", "server/companyData/cutover"])
      await mkdir(join(fixture, p), { recursive: true });
    for (const p of ["dist/workers/hint_lab", "workers/hint_lab"])
      await copyFile(resolve("workers/hint_lab/limited_exec.py"), join(fixture, p, "limited_exec.py"));
    await symlink(resolve("server/companyData/cutover/worker.ts"), join(fixture, "server/companyData/cutover/worker.ts"));
    // Exact production cutover-worker build options. No define/plugin in child.
    await build({ entryPoints: [resolve("server/companyData/cutover/worker.ts")],
      outfile: join(fixture, "dist/company-cutover-worker.js"),
      platform: "node", bundle: true, format: "esm", packages: "external" });
    await parent("before-fix-production", "production", true);
    await parent("production", "production");
    await parent("unbundled-mode", undefined);
    await parent("development", "development");
  });
  it("reproduces the old failure: parent production but inherited NODE_ENV absent", async () => {
    const r = await run("before-fix-production");
    expect(r.parentMode).toBe("production"); expect(boot(r)?.environment.production).toBe(false);
    expect(exception(r)).toBe("CUTOVER_NOT_APPROVED");
  });
  it("passes production mode through the real limiter when inherited NODE_ENV is absent", async () => {
    const r = await run("production");
    expect(boot(r)?.environment).toEqual({ production: true, databaseUrlPresent: true });
    // Invalid offline operation is refused BEFORE Pool/SQL. Passing this guard
    // demonstrates environment approval without granting or executing anything.
    expect(exception(r)).toBe("CUTOVER_BAD_OPERATION");
    expect(r.error).toBe("CUTOVER_WORKER_UNCONFIRMED");
  });
  it("forwards the bundled parent's effective mode, not a conflicting ambient value", async () => {
    const r = await run("production", "development");
    expect(r.parentMode).toBe("production"); expect(boot(r)?.environment.production).toBe(true);
    expect(exception(r)).toBe("CUTOVER_BAD_OPERATION");
  });
  it("does not turn a Dev parent with an absent NODE_ENV into production", async () => {
    const r = await run("unbundled-mode");
    expect(r.parentMode).toBeNull(); expect(boot(r)?.environment.production).toBe(false);
    expect(exception(r)).toBe("CUTOVER_NOT_APPROVED");
  });
  it("a development build stays development even with ambient production", async () => {
    const r = await run("development", "production");
    expect(r.parentMode).toBe("development"); expect(boot(r)?.environment.production).toBe(false);
    expect(exception(r)).toBe("CUTOVER_NOT_APPROVED");
  });
});
