import { afterEach, describe, expect, it, vi } from "vitest";
import { LabPythonUnavailableError, safePythonStderr } from "./pythonDiagnostics";
import { labStartupStatus, labStartupStep, resetLabStartup } from "./startup";
afterEach(() => { resetLabStartup(); vi.restoreAllMocks(); });
describe("Python runtime diagnostics, deny arbitrary stderr", () => {
  it("retains bounded exit/signal/launch facts without error message or command", () => {
    const e = new LabPythonUnavailableError({code: 1, signal: "SIGKILL", cmd: "secret", message: "secret"},
      "Traceback (most recent call last):\nModuleNotFoundError: No module named 'crewai'\n");
    expect(e.runtimeDiagnostic).toMatchObject({exit_code: 1, signal: "SIGKILL", launch_code: null});
    expect(e.runtimeDiagnostic.stderr_tail.at(-1)).toContain("'crewai'");
    expect(JSON.stringify(e)).not.toContain("secret");
    expect(new LabPythonUnavailableError({code: "ENOENT"}, "").runtimeDiagnostic.launch_code).toBe("ENOENT");
    expect(new LabPythonUnavailableError({code: null}, "").runtimeDiagnostic.exit_code).toBeNull();
  });
  it("does not leak credentials, paths, email, call text or bearer strings", () => {
    const raw = [
      "OPENAI_API_KEY=sk-TEST-SECRET", "Bearer abc.private-token",
      'File "/home/private-user/secret.py", line 12, in main',
      "RuntimeError: postgres://user:password@private-host/db?token=abc",
      "owner@example.org +15551234567 customer call text",
      "ModuleNotFoundError: No module named 'private_token_value'",
    ].join("\n");
    const result = JSON.stringify(safePythonStderr(raw));
    for (const forbidden of ["sk-TEST", "private-token", "private-user", "password", "example.org", "+1555", "private_token_value"])
      expect(result).not.toContain(forbidden);
    expect(safePythonStderr(raw)).toHaveLength(6);
    expect(safePythonStderr("MemoryError: private details")).toEqual(["MemoryError"]);
  });
  it("preserves safe diagnostics in worker startup status and discards untrusted SDK objects", async () => {
    const error = new LabPythonUnavailableError({code: 1, signal: "SIGTERM"}, "MemoryError");
    await expect(labStartupStep("worker", async () => { throw error; })).rejects.toBe(error);
    expect(labStartupStatus()).toMatchObject({code: "LAB_PYTHON_UNAVAILABLE",
      runtimeDiagnostic: {exit_code: 1, signal: "SIGTERM", stderr_tail: ["MemoryError"]}});
    await expect(labStartupStep("worker", async () => { throw {runtimeDiagnostic: {stderr_tail: ["secret"]}}; })).rejects.toBeDefined();
    expect(labStartupStatus().runtimeDiagnostic).toBeUndefined();
  });
});
