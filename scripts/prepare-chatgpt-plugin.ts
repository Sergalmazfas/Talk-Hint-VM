/**
 * Offline packaging only. No application boot, DB, credentials, HTTP, OpenAI
 * submission, provider calls or environment-variable reads.
 */
import { readFile, writeFile, mkdir, copyFile, rm } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { prepareSubmission } from "../server/chatgpt/submission";
import { preparePrivatePlugin } from "../server/chatgpt/privatePackage";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const draft = args.length === 1 && args[0] === "--draft";
const privateMode = args.length === 2 && args[0] === "--private-config";
if (!draft && !privateMode && !(args.length === 2 && args[0] === "--config")) {
  console.error("Usage: npm run chatgpt:package -- --draft | --config settings.json | --private-config settings.json");
  process.exit(2);
}
const draftInput = {
  origin: "https://talkhint-review.invalid", developerName: "OWNER VERIFICATION REQUIRED",
  websiteURL: "https://talkhint-review.invalid/about", privacyPolicyURL: "https://talkhint-review.invalid/privacy",
  termsOfServiceURL: "https://talkhint-review.invalid/terms", supportURL: "https://talkhint-review.invalid/support",
  demoRecordingURL: "https://talkhint-review.invalid/walkthrough", countries: ["US"], mode: "outbound",
};
let prepared: ReturnType<typeof prepareSubmission> | ReturnType<typeof preparePrivatePlugin>;
try {
  const input = draft ? draftInput : JSON.parse(await readFile(resolve(args[1]), "utf8"));
  prepared = privateMode ? preparePrivatePlugin(input) : prepareSubmission(input, draft);
}
catch {
  // Do not echo possibly accidentally supplied sensitive configuration.
  console.error("Invalid non-secret package settings. Check HTTPS origin, mode and actual registered MCP mapping.");
  process.exit(2);
}
const out = join(root, "generated-artifacts/talkhint-plugin", privateMode ? "private" : draft ? "draft" : "candidate");
const bundle = join(out, "package");
await mkdir(out, { recursive: true });
await rm(bundle, { recursive: true, force: true });
await mkdir(join(bundle, "assets"), { recursive: true });
for (const [file, value] of [["plugin.json", prepared.manifest], ["mcp.json", prepared.mcp]] as const)
  await writeFile(join(bundle, file), JSON.stringify(value, null, 2) + "\n");
for (const [file, content] of Object.entries(prepared.skills)) {
  await mkdir(dirname(join(bundle, file)), { recursive: true });
  await writeFile(join(bundle, file), content);
}
const registeredApps = "registeredApps" in prepared ? prepared.registeredApps : undefined;
if (registeredApps) await writeFile(join(bundle, ".app.json"), JSON.stringify(registeredApps, null, 2) + "\n");
if (privateMode) await writeFile(join(bundle, "PRIVATE-READINESS.json"), JSON.stringify(prepared.readiness, null, 2) + "\n");
// Reuse the product's existing icon; no new brand or external project assets.
const icon = join(root, "ios/TalkHint/Assets.xcassets/AppIcon.appiconset/AppIcon.png");
await copyFile(icon, join(bundle, "assets/icon.png"));
await copyFile(icon, join(bundle, "assets/logo.png"));
const zip = join(out, privateMode ?
  registeredApps ? "talkhint-private-candidate.zip" : "talkhint-source-NEEDS-MCP-BINDING.zip" :
  draft ? "talkhint-NOT-FOR-UPLOAD.zip" : "talkhint-candidate.zip");
await rm(zip, { force: true });
const archived = spawnSync("zip", ["-q", "-X", zip, "plugin.json", "mcp.json", "assets/icon.png", "assets/logo.png",
  ...Object.keys(prepared.skills), ...(registeredApps ? [".app.json"] : []),
  ...(privateMode ? ["PRIVATE-READINESS.json"] : [])],
  { cwd: bundle, stdio: "pipe" });
if (archived.status !== 0) throw new Error("Local ZIP builder unavailable; no submission attempted");
await writeFile(join(out, "readiness.json"), JSON.stringify(prepared.readiness, null, 2) + "\n");
console.log(`Prepared local ${privateMode ? "private source/candidate" : draft ? "NOT-FOR-UPLOAD draft" : "candidate"}: ${zip}`);
console.log("Resolve readiness.json blockers before installation or submission. Nothing uploaded or enabled.");
