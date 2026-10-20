import { describe, expect, it } from "vitest";
import { packagedSecretarySkills, secretaryInstructions, TALKHINT_PLUGIN_VERSION } from "./pluginWorkflow";
import { preparePrivatePlugin } from "./privatePackage";
import { talkHintPluginPackage } from "./plugin";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

describe("installed TalkHint workflow matches outbound capability", () => {
  it("ships setup and call workflow without confusing history or old failures with a new call", () => {
    const skills = packagedSecretarySkills(true);
    expect(Object.keys(skills)).toEqual(["skills/setup/SKILL.md", "skills/secretary/SKILL.md"]);
    const workflow = skills["skills/secretary/SKILL.md"];
    for (const text of ["prepare_call", "approval_url", "start_call", "get_task", "same confirmation",
      "task_id", "old failed report", "not a", "three times", "do not", "separate OAuth consent"])
      expect(workflow.toLowerCase()).toContain(text.toLowerCase());
    expect(skills["skills/setup/SKILL.md"]).toContain("Do not invent a registered connection ID");
    const pack = talkHintPluginPackage("https://talkhint.app", true);
    expect(pack.manifest.version).toBe(TALKHINT_PLUGIN_VERSION);
    expect(pack.manifest.extensions["com.openai"].onboardingSkill).toBe("./skills/setup/SKILL.md");
    expect(pack.manifest.extensions["com.openai"].interface.defaultPrompt[0]).toContain("Подготовь звонок");
    expect(secretaryInstructions(true)).not.toContain("Read only the authenticated");
    expect(secretaryInstructions(false)).toContain("read-only");
    expect(packagedSecretarySkills(false)["skills/secretary/SKILL.md"]).not.toContain("## One explicit call");
  });
  it("does not manufacture a registered mapping or label a source bundle as connected", () => {
    const pack = preparePrivatePlugin({ origin: "https://talkhint.app", mode: "outbound" });
    expect(pack.readiness.structurallyComplete).toBe(false);
    expect(pack.registeredApps).toBeUndefined();
    expect(pack.manifest.extensions["com.openai"]).not.toHaveProperty("apps");
    expect(pack.mcp.mcpServers.talkhint.url).toBe("https://talkhint.app/api/chatgpt/mcp");
  });
  it("preserves an owner-supplied registered mapping but does not claim client verification", () => {
    // Synthetic fixture only; never emitted into a real candidate.
    const registeredApps = { apps: { talkhint: { id: "plugin_asdk_app_synthetic_fixture" } } };
    const pack = preparePrivatePlugin({ origin: "https://talkhint.app", mode: "outbound", registeredApps });
    expect(pack.registeredApps).toEqual(registeredApps);
    expect(pack.manifest.extensions["com.openai"].apps).toBe("./.app.json");
    expect(pack.readiness.structurallyComplete).toBe(true);
    expect(pack.readiness.registeredBindingVerifiedInChatGPT).toBe(false);
    for (const mapping of [
      { apps: {} }, { apps: { talkhint: { id: "plugins_installed_package_not_connection" } } },
      { apps: { talkhint: { id: "plugin_asdk_app_synthetic", headers: {} } } },
      { apps: { a: "plugin_asdk_app_a", b: "plugin_asdk_app_b" } },
    ]) expect(() => preparePrivatePlugin({ origin: "https://talkhint.app", mode: "outbound",
      registeredApps: mapping })).toThrow();
    expect(() => preparePrivatePlugin({ origin: "https://talkhint-review.invalid", mode: "outbound" })).toThrow();
  });
  it("creates an offline private source archive with real endpoint and skills, never a guessed binding", () => {
    execFileSync("node_modules/.bin/tsx", ["scripts/prepare-chatgpt-plugin.ts", "--private-config",
      "docs/chatgpt-private-plugin.example.json"], { stdio: "pipe" });
    const dir = "generated-artifacts/talkhint-plugin/private";
    const zip = `${dir}/talkhint-source-NEEDS-MCP-BINDING.zip`;
    const entries = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");
    expect(entries).toContain("skills/secretary/SKILL.md");
    expect(entries).toContain("skills/setup/SKILL.md");
    expect(entries).not.toContain(".app.json");
    const mcp = JSON.parse(execFileSync("unzip", ["-p", zip, "mcp.json"], { encoding: "utf8" }));
    expect(mcp.mcpServers.talkhint.url).toBe("https://talkhint.app/api/chatgpt/mcp");
    const receipt = JSON.parse(readFileSync(`${dir}/readiness.json`, "utf8"));
    expect(receipt).toMatchObject({ structurallyComplete: false, published: false, realCallsMade: false });
  });
});
