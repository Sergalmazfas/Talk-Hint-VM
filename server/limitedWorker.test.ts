import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { limitedWorker } from "./limitedWorker";

describe("bounded isolated worker, no unlimited fallback", () => {
  for (const [kind, expected] of [["lab", 2], ["import", 3]] as const) {
    it(`sets ${kind} hard and soft limits before worker code and refuses a 4GiB allocation`, () => {
      const code = [
        "import resource,mmap,json",
        `print(json.dumps(resource.getrlimit(resource.${kind === "lab" ? "RLIMIT_AS" : "RLIMIT_DATA"})),flush=True)`,
        "try:",
        " x=mmap.mmap(-1,4*1024**3,flags=mmap.MAP_PRIVATE|mmap.MAP_ANONYMOUS)",
        "except (OSError,MemoryError):",
        " print('ALLOCATION_REFUSED',flush=True)",
        "else:",
        " raise SystemExit(9)",
      ].join("\n");
      const launch = limitedWorker(kind, "python", ["-c", code]);
      const child = spawnSync(launch.executable, launch.args, {encoding: "utf8", timeout: 10000});
      expect(child.status, child.stderr).toBe(0);
      expect(JSON.parse(child.stdout.split("\n")[0])).toEqual([expected * 1024 ** 3, expected * 1024 ** 3]);
      expect(child.stdout).toContain("ALLOCATION_REFUSED");
    });
  }
  it("starts Node under the data ceiling without limiting its V8 virtual address reservation", () => {
    const launch = limitedWorker("import", process.execPath, ["--max-old-space-size=2048", "-e", "console.log('BOUNDED_NODE_STARTED')"]);
    const child = spawnSync(launch.executable, launch.args, {encoding: "utf8", timeout: 10000});
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout.trim()).toBe("BOUNDED_NODE_STARTED");
  });
  it("refuses an unknown policy without executing the worker", () => {
    const launch = limitedWorker("lab", process.execPath, ["-e", "console.log('UNBOUNDED')"]);
    launch.args[launch.args.indexOf("lab")] = "unlimited";
    const child = spawnSync(launch.executable, launch.args, {encoding: "utf8", timeout: 10000});
    expect(child.status).toBe(125);
    expect(child.stdout).not.toContain("UNBOUNDED");
  });
});
