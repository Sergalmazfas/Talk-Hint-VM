import { beforeEach, describe, expect, it, vi } from "vitest";
const fs = vi.hoisted(() => ({ readFile: vi.fn(), readdir: vi.fn() }));
const os = vi.hoisted(() => ({ freemem: vi.fn(), totalmem: vi.fn() }));
vi.mock("node:fs/promises", () => fs);
vi.mock("node:os", () => os);
import { assertNoOtherCutoverProcess, cleanDiagnostic, cutoverMemory, exceptionCode, safeStderr } from "./diagnostics";
const GiB = 1024 ** 3;
describe("cutover private diagnostics and capacity", () => {
  beforeEach(() => {
    vi.resetAllMocks(); os.freemem.mockReturnValue(6 * GiB); os.totalmem.mockReturnValue(8 * GiB);
    fs.readFile.mockImplementation(async (path: string) => path.endsWith("memory.max") ? String(8 * GiB) : String(2 * GiB));
  });
  it("takes min OS free and cgroup remainder, in bytes, including exact boundary", async () => {
    let d = await cutoverMemory(); expect(d.passed).toBe(true); expect(d.effectiveFree).toBe(6 * GiB);
    os.freemem.mockReturnValue(3.75 * GiB); expect((await cutoverMemory()).passed).toBe(true);
    os.freemem.mockReturnValue(3.75 * GiB - 1); expect((await cutoverMemory()).passed).toBe(false);
    os.freemem.mockReturnValue(6 * GiB);
    fs.readFile.mockImplementation(async (p: string) => String(p.endsWith("memory.max") ? 4 * GiB : GiB));
    d = await cutoverMemory(); expect(d.effectiveFree).toBe(3 * GiB); expect(d.passed).toBe(false);
  });
  it("handles unlimited or absent cgroup, but refuses unreadable/invalid readings", async () => {
    fs.readFile.mockImplementation(async (p: string) => p.endsWith("memory.max") ? "max" : "0");
    expect((await cutoverMemory()).passed).toBe(true);
    fs.readFile.mockRejectedValue({ code: "ENOENT" }); expect((await cutoverMemory()).passed).toBe(true);
    fs.readFile.mockRejectedValue({ code: "EACCES" }); await expect(cutoverMemory()).rejects.toThrow("READING_UNAVAILABLE");
    fs.readFile.mockResolvedValue("garbage"); await expect(cutoverMemory()).rejects.toThrow("READING_UNAVAILABLE");
  });
  it("does not persist arbitrary exception text, connection URLs, SQL or stderr secrets", () => {
    const secret = "postgres://person:secret@private/db SELECT sensitive";
    expect(exceptionCode(new Error(secret))).toBe("CUTOVER_UNCLASSIFIED_EXCEPTION");
    expect(exceptionCode({ code: "42P01", message: secret })).toBe("42P01");
    expect(exceptionCode({ code: "ERR_MODULE_NOT_FOUND", message: secret })).toBe("ERR_MODULE_NOT_FOUND");
    expect(exceptionCode(new Error("Baseline SHA mismatch"))).toBe("CUTOVER_BASELINE_SHA_MISMATCH");
    expect(safeStderr(secret)).not.toContain("secret");
    const d = cleanDiagnostic({ stage: "exit", exitCode: 1, signal: "SIGTERM", stderr: [secret],
      token: secret, environment: { production: true, databaseUrlPresent: true, DATABASE_URL: secret } });
    expect(JSON.stringify(d)).not.toContain("secret"); expect(d?.signal).toBe("SIGTERM");
    expect(cleanDiagnostic({ stage: secret })).toBeNull();
  });
  it("retains only categorized bounded stderr", () => {
    expect(safeStderr("FATAL ERROR: allocation failed heap out of memory")).toContain("allocation failed");
    expect(safeStderr("Error Cannot find module /private/secret")).toBe("[runtime: module unavailable]");
    expect(cleanDiagnostic({ stage: "exit", stderr: Array(50).fill("secret") })?.stderr).toHaveLength(8);
  });
  it("refuses another worker and fails closed when process inspection is denied", async () => {
    fs.readdir.mockResolvedValue([{ name: String(process.pid) }, { name: "12345678" }]);
    fs.readFile.mockResolvedValue("node\0/app/dist/company-cutover-worker.js\0");
    await expect(assertNoOtherCutoverProcess()).rejects.toThrow("OTHER_WORKER_ALIVE");
    fs.readFile.mockRejectedValue({ code: "EACCES" });
    await expect(assertNoOtherCutoverProcess()).rejects.toThrow("PROCESS_SCAN_UNAVAILABLE");
    fs.readFile.mockRejectedValue({ code: "ENOENT" });
    await expect(assertNoOtherCutoverProcess()).resolves.toBeUndefined();
  });
});
