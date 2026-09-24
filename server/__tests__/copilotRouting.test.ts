import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Copilot conference routing", () => {
  it("routes both normal iOS and ios_copilot pending calls to conference", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "server/routes.ts"), "utf8");
    expect(source).toContain('clientType === "ios" || clientType === "ios_copilot"');
    expect(source).toContain("if (isIosConferenceClientType(pendingCall.clientType))");
  });

  it("does not route browser or arbitrary caller types to conference", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "server/routes.ts"), "utf8");
    expect(source).toContain('return clientType === "ios" || clientType === "ios_copilot";');
    expect(source).not.toContain('clientType === "ios" || clientType === "ios_copilot" ||');
  });
});