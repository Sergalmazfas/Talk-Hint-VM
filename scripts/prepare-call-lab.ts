// Guarded Dev schema setup + read-only Gmail proof; NO mail, model calls or worker activation.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { GmailLabMail } from "../server/callLab/mail";
import { isBenchmarkAdmin } from "../server/benchmark/adminGate";
import { checkHintLabRuntime } from "../server/callLab/process";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev DB only");
  await pool.query(await readFile("server/callLab/schema.sql", "utf8"));
  const mail = new GmailLabMail();
  const profile = await mail.profile();
  assert.ok(isBenchmarkAdmin(profile), "Connected Gmail must be the private administrator");
  const owner = (await pool.query("SELECT id FROM users WHERE lower(email)=$1", [profile])).rows[0];
  assert.ok(owner, "Existing owner account required");
  const binding = await mail.bindingFor(profile);
  await mail.verify(binding);
  const runtime = await checkHintLabRuntime();
  await mkdir("/tmp/hint-lab-private", { recursive: true, mode: 0o700 });
  // Private runtime setup, not a second catalogue; no key values or OAuth tokens.
  await writeFile("/tmp/hint-lab-private/binding.json", JSON.stringify({ ownerId: owner.id, ...binding }), { mode: 0o600 });
  console.log(JSON.stringify({ devSchemaPrepared: true, mailboxMatchesExistingAdmin: true,
    applicationSdkReadVerified: true, runtime, mailSent: false, workerEnabled: false }));
} finally { await pool.end(); }
