/** Render a saved-call example only; never analyses a call or sends mail. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { authorizedHintSource } from "../server/callLab/source";
import { completeLabReport, renderProcessLetter } from "../server/callLab/processReport";
import { attachProductFollowup } from "../server/callLab/productContext";
import { labRelease } from "../server/callLab/policy";
const dir = "generated-artifacts/hint-tuning-28oct";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
  const snapshot = JSON.parse(await readFile("generated-artifacts/owner-call-28oct/snapshot.json", "utf8"));
  const original = JSON.parse(await readFile("generated-artifacts/owner-call-28oct/review/report.json", "utf8"));
  const source = authorizedHintSource(snapshot.call, snapshot.control, snapshot.control.environment);
  assert(source);
  let report: any = completeLabReport({ ...original, lab_release: labRelease }, source,
    original.private_report_path.split("/").at(-1));
  report = await attachProductFollowup(pool, report, source, { owner: snapshot.call.user_id, environment: "development" });
  assert.equal(report.product_followup.issues.filter((i: any) => i.decision === "approved_dev").length, 3);
  const letter = renderProcessLetter(report);
  const warning = "ПРИМЕР, НЕ ОТПРАВЛЕН. Новый AI-разбор не запускался; прежний возврат QA сохранён. Исправления в Dev, не в production.";
  await writeFile(`${dir}/EXAMPLE.json`, JSON.stringify({ ...report, input_lab_release: original.lab_release,
    exampleOnly: true, mailStatus: "NOT_SENT", independentReviewReused: true, mail_form_revision: 2 }, null, 2));
  await writeFile(`${dir}/LETTER_EXAMPLE.txt`, `${warning}\n\n${letter.subject}\n\n${letter.body}`);
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  await writeFile(`${dir}/LETTER_EXAMPLE.html`, `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hint — пример письма v4.2</title><style>body{margin:0;background:#f4f7f7;color:#17212b;font:16px/1.55 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:20px}aside{background:#fff3cd;padding:14px;border-radius:12px}h1{font-size:21px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;background:white;padding:18px;border-radius:12px}</style><main><aside>${escape(warning)}</aside><h1>${escape(letter.subject)}</h1><pre>${escape(letter.body)}</pre></main></html>`);
  console.log(JSON.stringify({ exampleOnly: true, mail: "NOT_SENT", qa: report.qa_status,
    revision: report.product_followup.sourceRevision, approved: 3, sections: 4 }));
} finally { await pool.end(); }
