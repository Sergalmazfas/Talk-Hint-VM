import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

describe("native Copilot hold gate", () => {
  it("routes ten consecutive holds privately and fences their release", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-hold-"));
    try {
      const binary = join(dir, "gate-test");
      execFileSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror",
        resolve("ios/tests/copilot_hold_gate_test.c"), "-o", binary]);
      expect(execFileSync(binary, { encoding: "utf8" }))
        .toContain("10 private/public cycles passed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retains fail-closed paths for early release and all three acknowledgement timeouts", () => {
    // Source-level contract until XCTest can exercise the actual audio callback
    // on an iPhone. These assertions do not prove guest audibility.
    const coordinator = readFileSync(resolve("ios/TalkHint/Calls/CopilotCallCoordinator.swift"), "utf8");
    const screen = readFileSync(resolve("ios/TalkHint/UI/CopilotViewController.swift"), "utf8");
    const close = coordinator.slice(coordinator.indexOf("private func requestPrivateGate"),
      coordinator.indexOf("private func releasePrivateGate"));
    const drain = coordinator.slice(coordinator.indexOf("private func releasePrivateGate"),
      coordinator.indexOf("private func restoreUplink"));
    const restore = coordinator.slice(coordinator.indexOf("private func restoreUplink"),
      coordinator.indexOf("private func failClosed"));
    expect(close).toMatch(/guard acknowledged else \{\s*self\.failClosed\(\)/);
    expect(close).toMatch(/if self\.releaseRequested \{[\s\S]*?self\.restoreUplink\(after: token\)[\s\S]*?completion\(false\)/);
    expect(drain).toMatch(/guard drained else \{[\s\S]*?self\.failClosed\(\)/);
    expect(restore).toMatch(/guard opened else \{\s*self\.failClosed\(\)/);
    expect(restore).toMatch(/self\.gateClosed = false\s+self\.screen\?\.gateRestored\(\)/);
    expect(screen).toMatch(/if !failed \{ status\.text = NSLocalizedString\("copilot\.restoring"/);
  });
});