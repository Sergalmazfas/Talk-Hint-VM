/**
 * Offline packaging only. No application boot, DB, credentials, HTTP, OpenAI
 * submission, provider calls or environment-variable reads.
 */
import { readFile, writeFile, mkdir, copyFile, rm } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { prepareSubmission } from "../server/chatgpt/submission";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const draft = args.length === 1 && args[0] === "--draft";
if (!draft && !(args.length === 2 && args[0] === "--config")) {
  console.error("Usage: npm run chatgpt:package -- --draft | --config /path/to/non-secret-settings.json");
  process.exit(2);
}
const draftInput = {
  origin: "https://talkhint-review.invalid", developerName: "OWNER VERIFICATION REQUIRED",
  websiteURL: "https://talkhint-review.invalid/about", privacyPolicyURL: "https://talkhint-review.invalid/privacy",
  termsOfServiceURL: "https://talkhint-review.invalid/terms", supportURL: "https://talkhint-review.invalid/support",
  demoRecordingURL: "https://talkhint-review.invalid/walkthrough", countries: ["US"], mode: "outbound",
};
let prepared: ReturnType<typeof prepareSubmission>;
try {
  const input = draft ? draftInput : JSON.parse(await readFile(resolve(args[1]), "utf8"));
  prepared = prepareSubmission(input, draft);
}
catch {
  // Do not echo possibly accidentally supplied sensitive configuration.
  console.error("Invalid non-secret submission settings. Check required HTTPS URLs, publisher, countries and mode.");
  process.exit(2);
}
const out = join(root, "generated-artifacts/talkhint-plugin", draft ? "draft" : "candidate");
const bundle = join(out, "package");
await mkdir(out, { recursive: true });
await rm(bundle, { recursive: true, force: true });
await mkdir(join(bundle, "assets"), { recursive: true });
for (const [file, value] of [["plugin.json", prepared.manifest], ["mcp.json", prepared.mcp]] as const)
  await writeFile(join(bundle, file), JSON.stringify(value, null, 2) + "\n");
// Reuse the product's existing icon; no new brand or external project assets.
const icon = join(root, "ios/TalkHint/Assets.xcassets/AppIcon.appiconset/AppIcon.png");
await copyFile(icon, join(bundle, "assets/icon.png"));
await copyFile(icon, join(bundle, "assets/logo.png"));
const zip = join(out, draft ? "talkhint-NOT-FOR-UPLOAD.zip" : "talkhint-candidate.zip");
await rm(zip, { force: true });
const archived = spawnSync("zip", ["-q", "-X", zip, "plugin.json", "mcp.json", "assets/icon.png", "assets/logo.png"],
  { cwd: bundle, stdio: "pipe" });
if (archived.status !== 0) throw new Error("Local ZIP builder unavailable; no submission attempted");
await writeFile(join(out, "readiness.json"), JSON.stringify(prepared.readiness, null, 2) + "\n");
console.log(`Prepared local ${draft ? "NOT-FOR-UPLOAD draft" : "candidate"}: ${zip}`);
console.log("NOT submission-ready: resolve readiness.json blockers. Nothing uploaded or enabled.");
