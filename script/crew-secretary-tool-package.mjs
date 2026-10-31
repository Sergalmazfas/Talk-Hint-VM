import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = "generated-artifacts/secretary-department-tool-review";
const out = `${root}/review`, previous = "generated-artifacts/crew-mcp-extension/review";
const metadata = JSON.parse(await fs.readFile(`${previous}/build-metadata.json`, "utf8"));
const oldFiles = execFileSync("find", [previous, "-type", "f"], { encoding: "utf8" }).trim().split("\n");
const oldService = oldFiles.find(p => p.endsWith("/server/productCrew/service.ts"));
if (!oldService) throw Error("Previous six-tool source baseline unavailable.");
const oldSource = oldService.slice(0, -"server/productCrew/service.ts".length);
const files = [
  "server/productCrew/service.ts", "server/productCrew/routes.ts", "server/productCrew/productCrew.test.ts",
  "server/productCrew/teamChanges.ts", "server/productCrew/teamChanges.test.ts",
  "server/productCrew/mariaPassport.ts", "server/productCrew/mariaPassport.test.ts",
  "server/productCrew/secretaryDepartment.ts", "server/productCrew/secretaryDepartment.test.ts",
  "shared/secretaryDepartment.ts", "shared/team.ts",
  "server/projectModel/competitorSchema.ts", "server/team/runtime.ts", "server/team/runtime.test.ts", "server/team/view.ts",
];
const patch = (a, b) => {
  try { return execFileSync("git", ["diff", "--no-index", a, b], { encoding: "utf8" }); }
  catch (e) { if (e.status === 1) return e.stdout.toString(); throw e; }
};
let combined = "", incremental = "";
for (const file of files) {
  await fs.mkdir(`${out}/source/${file.slice(0, file.lastIndexOf("/"))}`, { recursive: true });
  await fs.copyFile(file, `${out}/source/${file}`);
  let inBase = true;
  try { execFileSync("git", ["cat-file", "-e", `${metadata.baseCommit}:${file}`], { stdio: "ignore" }); }
  catch { inBase = false; }
  combined += inBase ? execFileSync("git", ["diff", metadata.baseCommit, "--", file], { encoding: "utf8" }) : patch("/dev/null", file);
  const old = `${oldSource}${file}`;
  let exists = true; try { await fs.access(old); } catch { exists = false; }
  incremental += patch(exists ? old : "/dev/null", file).replaceAll(`a/${old}`, `a/${file}`);
}
await fs.writeFile(`${out}/Combined_seven_tools.diff`, combined);
await fs.writeFile(`${out}/Secretary_only.diff`, incremental);
await fs.copyFile("docs/secretary-department-mcp-review.md", `${out}/00_ПРОЧИТАТЬ.md`);
await fs.copyFile("docs/crew-mcp-narrow-tools-review.md", `${out}/Предыдущие_шесть_инструментов.md`);
for (const path of oldFiles) {
  const file = path.slice(previous.length + 1);
  if (!file.includes("/") && /^(Maria|P[_-]BENCH|katya-readonly).*\.json$/i.test(file))
    await fs.copyFile(path, `${out}/previous-${file}`);
}
await fs.copyFile("/tmp/secretary-department-full.log", `${out}/full-tests.log`);
await fs.copyFile("/tmp/secretary-department-specific.log", `${out}/nine-new-tests.log`);
await fs.copyFile("/tmp/secretary-department-types.log", `${out}/typecheck.log`);
const log = await fs.readFile(`${out}/full-tests.log`, "utf8");
if (!/Test Files\s+\d+ passed/.test(log) || /Test Files[^\n]*failed/.test(log))
  throw Error("Full test run unfinished or failed; ZIP not created.");
await fs.cp(`${root}/fixtures`, `${out}/fixtures`, { recursive: true });
await fs.copyFile("generated-artifacts/secretary-structure/review/Stage2_questions.json", `${out}/Этап_2_только_вопросы.json`);
await fs.copyFile("generated-artifacts/secretary-structure/review/Read_evidence.json", `${out}/Последнее_production_чтение.json`);
await fs.writeFile(`${out}/build-metadata.json`, JSON.stringify({
  baseCommit: metadata.baseCommit, lastReadProductionRevision: 971, productionWritesThisWork: 0,
  published: false, newToolAppliedInProduction: false, actualKatyaRuntimeRead: false,
  independentReview: "pending", examples: "OFFLINE_DEV_FIXTURES_ONLY",
}, null, 2));
const paths = execFileSync("find", [out, "-type", "f"], { encoding: "utf8" }).trim().split("\n")
  .filter(p => !p.endsWith("/SHA256.json"));
const hashes = {};
for (const p of paths) hashes[p.slice(out.length + 1)] = createHash("sha256").update(await fs.readFile(p)).digest("hex");
await fs.writeFile(`${out}/SHA256.json`, JSON.stringify(hashes, null, 2));
const zip = "generated-artifacts/Crew_MCP_with_Secretary_department_review.zip";
execFileSync("zip", ["-qr", `${process.cwd()}/${zip}`, "."], { cwd: out });
console.log(JSON.stringify({ zip, files: paths.length + 1, productionWritesThisWork: 0, published: false }));
