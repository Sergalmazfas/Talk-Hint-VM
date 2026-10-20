import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareSubmission } from "./submission";
import { PUBLIC_TOOLS, publicToolMetadata } from "./toolMetadata";
import { talkHintReviewCases } from "./reviewCases";

const settings = {
  origin: "https://review.talkhint.example", developerName: "TalkHint",
  websiteURL: "https://talkhint.example/about", privacyPolicyURL: "https://talkhint.example/privacy",
  termsOfServiceURL: "https://talkhint.example/terms", supportURL: "https://talkhint.example/support",
  demoRecordingURL: "https://talkhint.example/walkthrough", countries: ["US"], mode: "outbound",
};
describe("TalkHint public-directory preparation, never submission", () => {
  it("builds separate branded metadata with documented review fields and least initial scopes", () => {
    const pack = prepareSubmission(settings, true);
    const extension = pack.manifest.extensions["com.openai"];
    expect(extension.interface.displayName).toBe("TalkHint Secretary");
    expect(extension.interface.shortDescription.length).toBeLessThanOrEqual(30);
    expect(extension.interface.privacyPolicyURL).toBe(settings.privacyPolicyURL);
    expect(extension.interface.logo).toBe("./assets/logo.png");
    expect(extension.review.test_cases.positive).toHaveLength(5);
    expect(extension.review.test_cases.negative).toHaveLength(3);
    expect(pack.readiness).toMatchObject({ submitted: false, published: false, readyToSubmit: false });
    const auth = pack.mcp.mcpServers.talkhint.extensions["com.openai"].auth;
    expect(auth.baseScopes).toEqual(["calls:read", "offline_access"]);
    expect(auth.defaultScopes).toEqual([]);
    expect(auth.client.tokenEndpointAuthMethod).toBe("none");
    expect(JSON.stringify(pack)).not.toContain("Route Leader");
    expect(pack.readiness.schemaNote).toContain("forbids server extensions");
  });
  it.each([
    { ...settings, clientSecret: "do-not-package" },
    { ...settings, origin: "http://unsafe.example" },
    { ...settings, privacyPolicyURL: "https://token:secret@unsafe.example" },
    { ...settings, demoRecordingURL: "https://unsafe.example/demo?access_token=do-not-package" },
    { ...settings, countries: [] }, { ...settings, mode: "allow-all" },
  ])("refuses malformed or secret-bearing package settings", value =>
    expect(() => prepareSubmission(value, true)).toThrow());
  it("refuses placeholders in a candidate and never claims remote checks passed even with real-looking URLs", () => {
    expect(() => prepareSubmission(settings)).toThrow(/placeholder/);
    const candidate = prepareSubmission(Object.fromEntries(Object.entries(settings).map(([key, value]) => [
      key, typeof value === "string" ? value.replaceAll(".example", ".com") : value,
    ])));
    expect(candidate.readiness.readyToSubmit).toBe(false);
    expect(candidate.readiness.blockers.length).toBeGreaterThan(5);
  });
  it("uses explicit safe annotations and no generic executor, SMS, incoming or forwarding tool", () => {
    for (const name of PUBLIC_TOOLS) {
      const tool = publicToolMetadata(name, name.endsWith("_call") && ["start_call", "prepare_call"].includes(name) ?
        "secretary:start" : "calls:read", {}, []);
      expect(tool.title).toBeTruthy();
      for (const key of ["readOnlyHint", "destructiveHint", "openWorldHint"] as const)
        expect(typeof tool.annotations[key]).toBe("boolean");
      expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
      expect(tool.annotations.destructiveHint).toBe(name === "start_call");
    }
    const preview = publicToolMetadata("prepare_call", "secretary:start", {}, []);
    expect(preview.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect(PUBLIC_TOOLS).not.toContain("get_incoming");
    expect(PUBLIC_TOOLS).not.toContain("execute");
    for (const mode of [false, true]) {
      const cases = talkHintReviewCases(mode);
      for (const test of cases.positive) {
        expect(test.tools_triggered).toBeTruthy();
        expect(test.expected_behavior).toBeTruthy();
        for (const name of test.tools_triggered.split(", "))
          expect(PUBLIC_TOOLS).toContain(name);
      }
    }
  });
  it("packages manifests, workflow skills and existing product icons, never server source or credentials", () => {
    execFileSync(process.execPath, [fileURLToPath(import.meta.resolve("tsx/cli")),
      "scripts/prepare-chatgpt-plugin.ts", "--draft"], { stdio: "pipe" });
    const base = "generated-artifacts/talkhint-plugin/draft";
    const zip = `${base}/talkhint-NOT-FOR-UPLOAD.zip`;
    const entries = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");
    expect(entries.sort()).toEqual(["assets/icon.png", "assets/logo.png", "mcp.json", "plugin.json",
      "skills/secretary/SKILL.md", "skills/setup/SKILL.md"]);
    const manifest = JSON.parse(execFileSync("unzip", ["-p", zip, "plugin.json"], { encoding: "utf8" }));
    expect(manifest.name).toBe("talkhint");
    const mcp = JSON.parse(execFileSync("unzip", ["-p", zip, "mcp.json"], { encoding: "utf8" }));
    expect(mcp.mcpServers.talkhint.url).toBe("https://talkhint-review.invalid/api/chatgpt/mcp");
    expect(Object.keys(mcp.mcpServers)).toEqual(["talkhint"]);
    expect(mcp.mcpServers.talkhint).not.toHaveProperty("headers");
    expect(mcp.mcpServers.talkhint).not.toHaveProperty("command");
    const icon = execFileSync("unzip", ["-p", zip, "assets/icon.png"]);
    expect(icon.equals(readFileSync("ios/TalkHint/Assets.xcassets/AppIcon.appiconset/AppIcon.png"))).toBe(true);
    expect(JSON.parse(readFileSync(`${base}/readiness.json`, "utf8")).readyToSubmit).toBe(false);
  });
});
