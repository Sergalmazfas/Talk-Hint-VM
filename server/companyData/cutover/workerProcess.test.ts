import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), access: vi.fn(), cutoverMemory: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs/promises", async original => ({ ...await original<any>(), access: mocks.access }));
vi.mock("./diagnostics", async original => ({ ...await original<any>(), cutoverMemory: mocks.cutoverMemory }));
import { startCutoverWorker } from "./workerProcess";
describe("bounded cutover launcher", () => {
  let child: any, observe: any;
  const memory = { osFree: 6e9, osTotal: 8e9, cgroupLimit: null, cgroupUsed: null,
    effectiveFree: 6e9, required: 3.75 * 1024 ** 3, passed: true };
  beforeEach(() => {
    vi.resetAllMocks(); mocks.access.mockResolvedValue(undefined); mocks.cutoverMemory.mockResolvedValue(memory);
    child = new EventEmitter(); child.pid = 100; child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.end = vi.fn(() => queueMicrotask(() => child.emit("close", 0, null)));
    mocks.spawn.mockReturnValue(child); observe = vi.fn(async () => {});
  });
  afterEach(() => vi.unstubAllEnvs());
  it("records memory bytes and refuses insufficient memory before spawn", async () => {
    mocks.cutoverMemory.mockResolvedValue({ ...memory, passed: false });
    await expect(startCutoverWorker("op", observe)).rejects.toThrow("MEMORY_RESERVE_UNAVAILABLE");
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(observe.mock.calls.find(([d]: any[]) => d.stage === "memory_gate")[0].memory).toEqual({ ...memory, passed: false });
  });
  it("refuses a missing production worker file", async () => {
    mocks.access.mockRejectedValue(new Error("absent"));
    await expect(startCutoverWorker("op", observe)).rejects.toThrow("WORKER_FILE_UNAVAILABLE");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it("keeps DATA launcher and heap 2304, pipes operation only, forwards mode and other environment without logging values", async () => {
    vi.stubEnv("CUTOVER_TEST_CANARY", "nonsecret-passthrough");
    await startCutoverWorker("op", observe);
    const [exe, args, options] = mocks.spawn.mock.calls[0];
    expect(exe).toBe("python"); expect(args).toContain("import"); expect(args).toContain("--max-old-space-size=2304");
    expect(options.env.NODE_ENV).toBe("test");
    expect(options.env.CUTOVER_TEST_CANARY).toBe("nonsecret-passthrough");
    expect(child.stdin.end).toHaveBeenCalledWith('{"operation":"op"}');
    expect(JSON.stringify(observe.mock.calls)).not.toContain("nonsecret-passthrough");
    expect(observe.mock.calls.at(-1)[0]).toMatchObject({ stage: "exit", exitCode: 0, signal: null });
  });
  it("explicitly forwards production when the parent selects the production entry", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await startCutoverWorker("op", observe);
    const [, args, options] = mocks.spawn.mock.calls[0];
    expect(options.env.NODE_ENV).toBe("production");
    expect(args).toContain("--max-old-space-size=2304");
    expect(args.some((s: string) => s.endsWith("/dist/company-cutover-worker.js"))).toBe(true);
    expect(args).not.toContain("tsx");
  });
  it("does not promote an unbundled Dev parent with an unset mode to production", async () => {
    vi.stubEnv("NODE_ENV", undefined);
    await startCutoverWorker("op", observe);
    const [, args, options] = mocks.spawn.mock.calls[0];
    expect(options.env.NODE_ENV).toBeUndefined(); expect(process.env.NODE_ENV).toBeUndefined();
    expect(args).toContain("tsx");
    expect(args.some((s: string) => s.endsWith("/server/companyData/cutover/worker.ts"))).toBe(true);
  });
  for (const [code, signal] of [[1, null], [null, "SIGTERM"], [null, "SIGKILL"]] as const)
    it(`records exit ${code}/${signal} and sanitizes stderr`, async () => {
      child.stdin.end.mockImplementation(() => queueMicrotask(() => {
        child.stderr.emit("data", Buffer.from("postgres://secret\nFATAL ERROR allocation failed\n"));
        child.emit("close", code, signal);
      }));
      await expect(startCutoverWorker("op", observe)).rejects.toThrow("WORKER_UNCONFIRMED");
      expect(observe.mock.calls.at(-1)[0]).toMatchObject({ exitCode: code, signal });
      expect(JSON.stringify(observe.mock.calls)).not.toContain("postgres://secret");
    });
  it("records spawn failure and original safe code", async () => {
    child.stdin.end.mockImplementation(() => queueMicrotask(() => {
      child.emit("error", Object.assign(new Error("secret"), { code: "ENOENT" })); child.emit("close", -2, null);
    }));
    await expect(startCutoverWorker("op", observe)).rejects.toThrow("WORKER_UNCONFIRMED");
    expect(observe.mock.calls.some(([d]: any[]) => d.stage === "spawn_error" && d.exceptionCode === "ENOENT")).toBe(true);
  });
  it("does not resolve/reject an input failure before child close", async () => {
    child.stdin.end.mockImplementation(() => queueMicrotask(() => child.stdin.emit("error", { code: "EPIPE" })));
    let settled = false;
    const p = startCutoverWorker("op", observe).finally(() => { settled = true; });
    await new Promise(r => setTimeout(r, 10)); expect(settled).toBe(false);
    child.emit("close", 1, null); await expect(p).rejects.toThrow("INPUT_UNAVAILABLE");
  });
  it("fails closed if durable diagnostics are unavailable", async () => {
    observe.mockImplementation(async (d: any) => { if (d.stage === "exit") throw new Error("db failure"); });
    await expect(startCutoverWorker("op", observe)).rejects.toThrow("DIAGNOSTICS_UNAVAILABLE");
  });
  it("collects split structured worker output and bounds unstructured tails", async () => {
    child.stdin.end.mockImplementation(() => queueMicrotask(() => {
      child.stderr.emit("data", Buffer.from('CUTOVER_DIAGNOSTIC {"stage":"worker_'));
      child.stderr.emit("data", Buffer.from('boot","environment":{"production":true,"databaseUrlPresent":true}}\n'));
      child.emit("close", 0, null);
    }));
    await startCutoverWorker("op", observe);
    expect(observe.mock.calls.some(([d]: any[]) => d.stage === "worker_boot" && d.environment.production)).toBe(true);
  });
});
