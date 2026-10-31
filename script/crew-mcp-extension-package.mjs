import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = "generated-artifacts/crew-mcp-extension";
const out = `${root}/review`;
const tracked = ["server/productCrew/service.ts", "server/productCrew/routes.ts",
  "server/productCrew/productCrew.test.ts", "server/projectModel/competitorSchema.ts",
  "server/team/runtime.ts", "server/team/view.ts", "server/team/runtime.test.ts"];
const added = ["server/productCrew/teamChanges.ts", "server/productCrew/teamChanges.test.ts",
  "script/crew-katya-readonly-snapshot.ts", "docs/crew-mcp-narrow-tools-review.md"];
await fs.mkdir(out, { recursive: true });
for (const path of [...tracked, ...added]) {
  await fs.mkdir(`${out}/source/${path.slice(0, path.lastIndexOf("/"))}`, { recursive: true });
  await fs.copyFile(path, `${out}/source/${path}`);
}
let diff = execFileSync("git", ["diff", "--", ...tracked], { encoding: "utf8" });
for (const path of added) {
  try { diff += execFileSync("git", ["diff", "--no-index", "--", "/dev/null", path], { encoding: "utf8" }); }
  catch (e) { if (e.status !== 1 || !e.stdout) throw e; diff += e.stdout; }
}
await fs.writeFile(`${out}/diff.patch`, diff);
await fs.copyFile("docs/crew-mcp-narrow-tools-review.md", `${out}/00_ПРОЧИТАТЬ.md`);
for (const [source, target] of [
  ["/tmp/crew-extension-full-green.log", "full-tests.log"],
  ["/tmp/crew-extension-targeted.log", "targeted-tests.log"],
  ["/tmp/crew-extension-types.log", "typecheck.log"],
  [`${root}/katya-readonly-unavailable.json`, "katya-readonly-unavailable.json"],
  ["generated-artifacts/crew-stage/prepared/structure-pending.json", "structure-pending.json"],
  ["attached_assets/Pasted---1793486267184_1793486267184.txt", "Входящая_сверка_r970.txt"],
]) await fs.copyFile(source, `${out}/${target}`);
const log = await fs.readFile(`${out}/full-tests.log`, "utf8");
if (!/Test Files\s+\d+ passed/.test(log) || /Test Files[^\n]*failed/.test(log))
  throw Error("Full verification not green/finished; archive not created.");
const paths = execFileSync("find", [out, "-type", "f"], { encoding: "utf8" })
  .trim().split("\n").filter(p => !p.endsWith("/MANIFEST_SHA256.json"));
const manifest = {};
for (const path of paths) manifest[path.slice(out.length + 1)] =
  createHash("sha256").update(await fs.readFile(path)).digest("hex");
await fs.writeFile(`${out}/MANIFEST_SHA256.json`, JSON.stringify(manifest, null, 2));
await fs.writeFile(`${out}/build-metadata.json`, JSON.stringify({
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  incomingModelRevision: 970, productionMutated: false, published: false,
  independentReview: "pending", actualKatyaPromptCaptured: false }, null, 2));
// Include metadata in the checksum list too.
manifest["build-metadata.json"] = createHash("sha256").update(await fs.readFile(`${out}/build-metadata.json`)).digest("hex");
await fs.writeFile(`${out}/MANIFEST_SHA256.json`, JSON.stringify(manifest, null, 2));
const zip = "generated-artifacts/Crew_MCP_narrow_tools_review.zip";
execFileSync("zip", ["-qr", `${process.cwd()}/${zip}`, "."], { cwd: out });
console.log(JSON.stringify({ zip, files: Object.keys(manifest).length + 1, productionMutated: false }));
