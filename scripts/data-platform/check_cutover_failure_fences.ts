/** Metadata-only negative checks on the retained successful Dev rehearsal owner. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { CompanyCutover } from "../../server/companyData/cutover/service";
import { cutoverCandidate } from "../../server/companyData/cutover/policy";
assert.equal(process.env.NODE_ENV, "development");
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
const dir = "generated-artifacts/company-cutover-secure";
const trial = JSON.parse(await readFile(`${dir}/REHEARSAL.json`, "utf8"));
assert.equal(trial.finished, true);
assert.match(trial.owner, /^cutover-protected:/);
assert.match(trial.workspace, /^company-cutover-protected-/);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const policy = { ...cutoverCandidate, owner: trial.owner, workspace: trial.workspace, environment: "development" as const };
const service = new CompanyCutover(pool, "development", policy, policy);
const result: any = { productionTouched: false, modelChanged: false, grantTokensIncluded: false,
  note: "Only simulated queued operation and grants. No model/root/checkpoint overwritten; no worker launched." };
try {
  const status = await service.status(policy.owner);
  assert.equal(status.phase, "verifying"); assert.equal(status.writesOpen, false);
  await assert.rejects(() => service.grant("other", "probe", status.source), /не разрешено/);
  await assert.rejects(() => service.grant(policy.owner, "probe", { ...status.source, manifestHash: "0".repeat(64) }), /CAS/);
  await assert.rejects(() => service.grant(policy.owner, "probe", { ...status.source, rootHash: "0".repeat(64) }), /CAS/);
  await assert.rejects(() => service.grant(policy.owner, "open_writes", status.source), /ещё не подтверждены/);
  result.ownerPinAndPrematureOpenRejected = true;
  const unused = await service.grant(policy.owner, "probe", status.source);
  const expired = await service.grant(policy.owner, "probe", status.source);
  await pool.query(`UPDATE company_cutover_grants SET expires_at=now()-interval '1 second'
    WHERE token_hash=$1 AND owner_key=$2 AND environment='development'`,
  [createHash("sha256").update(expired).digest("hex"), policy.owner]);
  await assert.rejects(() => service.enqueue(policy.owner, "probe", status.source, expired), /истекло|использовано/);
  result.expiredGrantRejected = true;
  const current = await service.grant(policy.owner, "probe", status.source);
  const queued = await service.enqueue(policy.owner, "probe", status.source, current);
  await assert.rejects(() => service.enqueue(policy.owner, "probe", status.source, current), /уже выполняется/);
  await assert.rejects(() => service.grant(policy.owner, "probe", status.source), /сверки/);
  result.duplicateAndBlindResumeRejected = true;
  // Simulate lost queued worker. Explicit rollback confirmation fences it,
  // without automatically running rollback, a probe, or a repeat generation.
  await service.grant(policy.owner, "rollback", status.source);
  await assert.rejects(() => service.perform(policy.owner, queued), /Повтор выполнения запрещён/);
  await assert.rejects(() => service.enqueue(policy.owner, "probe", status.source, unused), /старое разрешение/);
  result.lostWorkerFencedAndOldUnusedGrantRejected = true;
  await pool.query(`UPDATE company_cutover_grants SET expires_at=now()-interval '1 second'
    WHERE owner_key=$1 AND environment='development' AND consumed_at IS NULL`, [policy.owner]);
  const final = await service.status(policy.owner);
  assert.deepEqual(final.source, status.source); assert.equal(final.writesOpen, false);
  assert.equal(final.phase, "verifying");
  result.finished = true;
  result.retainedCopyFinalState = "normalized/verifying, writes closed; latest FAILED audit is intentionally simulated, rollback was not executed again";
} finally {
  await writeFile(`${dir}/FAILURE_FENCES.json`, JSON.stringify(result, null, 2));
  await pool.end();
}
