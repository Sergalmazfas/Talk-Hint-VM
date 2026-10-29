/** Run AFTER the complete test suite, on the same retained isolated owner only. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { CompanyCutover } from "../../server/companyData/cutover/service";
import { cutoverCandidate } from "../../server/companyData/cutover/policy";
import { IncrementalCompanyRepository } from "../../server/companyData/v3/repository";
import { CommandCompanyRepository } from "../../server/companyData/v3/commands";
const dir = "generated-artifacts/company-cutover-secure";
assert.equal(process.env.NODE_ENV, "development");
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
const previous = JSON.parse(await readFile(`${dir}/REHEARSAL.json`, "utf8"));
assert(previous.finished && previous.owner.startsWith("cutover-protected:"));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const policy = { ...cutoverCandidate, owner: previous.owner, workspace: previous.workspace, environment: "development" as const };
const service = new CompanyCutover(pool, "development", policy, policy);
const commands = new CommandCompanyRepository(new IncrementalCompanyRepository(pool, "development"));
const report: any = { productionTouched: false, externalCalls: false, sameRetainedCopy: true,
  concurrentFullSuite: false, measurements: [], steps: [], cleanup: false };
const execute = async (action: any) => {
  const start = performance.now(), status = await service.status(policy.owner);
  const grant = await service.grant(policy.owner, action, status.source);
  const operation = await service.enqueue(policy.owner, action, status.source, grant);
  const result = await service.perform(policy.owner, operation);
  report.steps.push({ action, ms: performance.now() - start, result });
  await writeFile(`${dir}/ISOLATED_BENCH.json`, JSON.stringify(report, null, 2));
};
try {
  // Complete an explicit recovery after the simulated lost queued operation.
  await execute("rollback");
  await execute("reactivate");
  await execute("probe");
  await execute("open_writes");
  let state = await commands.read(policy.owner, "new-country");
  const doc = state.documents.find(d => d.id === policy.probeDocumentId)!;
  for (const kind of ["document", "role"]) for (let trial = 1; trial <= 3; trial++) {
    let command: any;
    if (kind === "document") command = { type: "saveDocument", id: doc.id,
      title: doc.title, url: doc.url, elementIds: doc.elementIds,
      text: `${doc.text}\nIsolated Dev-only benchmark ${trial}` };
    else {
      const last = state.operatingModel!.revisions.at(-1)!, data = structuredClone(last.data);
      data.nodes.find(n => n.kind === "role")!.description += `\nIsolated Dev-only benchmark ${trial}`;
      command = { type: "saveOperatingModel", baseVersion: last.version, data };
    }
    const start = performance.now();
    state = await commands.updateMany(policy.owner, state.revision, [command], "new-country");
    report.measurements.push({ kind, trial, revision: state.revision, ms: performance.now() - start,
      writerMs: commands.lastReceipt!.writerMs, verificationMs: commands.lastReceipt!.verificationMs });
    await writeFile(`${dir}/ISOLATED_BENCH.json`, JSON.stringify(report, null, 2));
  }
  // Leave the retained trial read-only, using the same reviewed rollback path.
  await execute("rollback");
  report.finalStatus = await service.status(policy.owner);
  assert.equal(report.finalStatus.phase, "checkpoint"); assert.equal(report.finalStatus.writesOpen, false);
  report.finished = true;
} catch (e) {
  report.finished = false; report.error = e instanceof Error ? e.message : "Unknown failure";
  throw e;
} finally {
  report.maxRssKiB = process.resourceUsage().maxRSS;
  await writeFile(`${dir}/ISOLATED_BENCH.json`, JSON.stringify(report, null, 2));
  await pool.end();
}
