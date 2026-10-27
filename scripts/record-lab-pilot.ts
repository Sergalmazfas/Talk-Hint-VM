// Save only verified installation/synthetic evidence and the owner's acceptance.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis } from "../server/projectModel/hypotheses";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { acceptLabPilot, pilotId } from "../server/projectModel/research/labPilotApproval";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.ok(["helium", "lithium"].includes(new URL(process.env.DATABASE_URL!).hostname), "Dev only");
  const report = JSON.parse(await readFile("generated-artifacts/plab-synthetic/report.json", "utf8"));
  assert.equal(report.synthetic, true);
  assert.equal(report.framework.version, "1.15.30");
  assert.equal(report.delivery_confirmed, false);
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rowCount, 1);
  const row = q.rows[0], before = await unpackModel(pool, row.owner_key, row.state);
  const revision = readHypothesis(before, "new-country").revision;
  const facts = {
    framework: { ...report.framework, pinnedGitCommit: "38db11e3324fa0e23beb5eecd0d87e8e31ca2bb0",
      packageInstallation: "Official PyPI release mapped to official GitHub tag; not a source clone",
      dependencyFiles: ["pyproject.toml", "uv.lock"] },
    model: { name: report.model, existingProjectKeyUsed: true, secretValuesIncluded: false },
    synthetic: { completed: true, mode: "hint", qaStatus: report.qa_status, qaReturns: report.qa_returns,
      stages: report.metrics.usage.map((s: any) => s.stage), realCall: false, replayPerformed: false,
      mailStatus: "file_only; not sent", reportFile: "generated-artifacts/plab-synthetic/Пробное_письмо_P-LAB.html" },
    tests: { offlinePython: "6 flow tests passed; no API calls", typescript: "typecheck passed" },
    mail: { selectedCandidate: "Gmail OAuth connector", connected: false, realSendingVerified: false,
      registrationRequired: "Existing Google account; no new provider account requested",
      nativeReplitSender: "No documented zero-connection owner mail sender verified; AgentMail is a separate connector",
      sendgrid: "Not selected; owner does not want a new SendGrid registration" },
    execution: { roleInstances: "Two agents exist only during the synthetic invocation",
      continuousWorkerActive: false, eventQueueActive: false, outboxActive: false,
      adminWebAuthChanged: false, telephonyChanged: false, postCallHookChanged: false },
  };
  const transform = (root: typeof before) => {
    assert.equal(readHypothesis(root, "new-country").revision, revision, "Concurrent update");
    return acceptLabPilot(root, new Date().toISOString(), facts);
  };
  const after = process.argv.includes("--save")
    ? await persistModelUpdate(pool, row.owner_key, transform, true) : transform(before);
  console.log(JSON.stringify({ saved: process.argv.includes("--save"), beforeRevision: revision,
    revision: readHypothesis(after, "new-country").revision, documentId: pilotId,
    synthetic: facts.synthetic, privateDataIncluded: false }));
} finally { await pool.end(); }
