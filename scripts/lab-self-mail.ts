// A single OWNER-CONFIRMED synthetic self-mail, not a call or an autonomous worker.
// Without --send it prepares a durable outbox record only. Never writes to Gmail.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { GmailLabMail } from "../server/callLab/mail";
import { LabStore, labKey, messageIdFor } from "../server/callLab/store";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
  const binding = JSON.parse(await readFile("/tmp/hint-lab-private/binding.json", "utf8"));
  const text = await readFile("generated-artifacts/plab-synthetic/report.json", "utf8");
  const report = JSON.parse(text);
  assert.equal(report.synthetic, true); assert.equal(report.qa_status, "QA: принято");
  assert.equal(report.framework.version, "1.15.30");
  const mail = new GmailLabMail();
  await mail.verify(binding);
  const sid = "synthetic-self-mail:" + createHash("sha256").update(text).digest("hex");
  const key = labKey("development", binding.ownerId, sid), messageId = messageIdFor(key);
  await pool.query(`WITH added AS (
    INSERT INTO call_lab_jobs(key,environment,owner_id,call_sid,status,source,report,journal)
    VALUES($1,'development',$2,$3,'report_ready','{"synthetic":true}'::jsonb,$4::jsonb,
      '[{"phase":"manual-test:imported-existing-synthetic-report"}]'::jsonb)
    ON CONFLICT(key) DO NOTHING RETURNING key)
    INSERT INTO call_lab_outbox(key,environment,owner_id,message_id)
    VALUES($1,'development',$2,$5) ON CONFLICT(key) DO NOTHING`,
  [key, binding.ownerId, sid, text, messageId]);
  if (!process.argv.includes("--send")) {
    console.log(JSON.stringify({ prepared: true, synthetic: true, needsOwnerSendConfirmation: true, mailSent: false }));
  } else {
    const store = new LabStore(pool);
    const row = (await pool.query("SELECT * FROM call_lab_outbox WHERE key=$1", [key])).rows[0];
    const found = await mail.sent(binding, messageId, row.gmail_id);
    if (found) {
      await store.mailState(key, "sent_confirmed", found);
      console.log(JSON.stringify({ previouslySent: true, confirmedInSent: true, noResend: true }));
    } else if (row.status !== "prepared") {
      console.log(JSON.stringify({ status: row.status, needsReview: true, noResend: true }));
    } else {
      const claimed = await pool.query("UPDATE call_lab_outbox SET status='sending',updated_at=now() WHERE key=$1 AND status='prepared' RETURNING key", [key]);
      assert.equal(claimed.rowCount, 1, "Another sender claimed this message");
      try {
        await store.note(key, "manual-test:owner-confirmed-self-send");
        const gmailId = await mail.send(binding, messageId, report);
        await store.mailState(key, "gmail_accepted", gmailId);
        const confirmed = await mail.sent(binding, messageId, gmailId);
        await store.mailState(key, confirmed ? "sent_confirmed" : "unknown", confirmed ?? gmailId);
        await writeFile("/tmp/hint-lab-private/self-mail-receipt.json",
          JSON.stringify({ key, messageId, gmailId, confirmedInSent: !!confirmed }), { mode: 0o600 });
        console.log(JSON.stringify({ mailSubmitted: true, confirmedInSent: !!confirmed, ownerReadingConfirmed: false }));
      } catch {
        await store.mailState(key, "unknown");
        console.log(JSON.stringify({ status: "unknown", noBlindRetry: true, needsReview: true }));
        process.exitCode = 1;
      }
    }
  }
} finally { await pool.end(); }
