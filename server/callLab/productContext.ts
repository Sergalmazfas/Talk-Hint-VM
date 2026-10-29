import type { Pool } from "pg";
import { unpackModel } from "../projectModel/history";
import { readHypothesis } from "../projectModel/hypotheses";
import { buildProductFollowup, type ProductContext } from "./productFollowup";
import { activeCompanyDocument } from "../companyData/active";

/** Internal only: caller is the existing owner-scoped lab, never an HTTP input. */
export async function attachProductFollowup(pool: Pool, report: any, source: any, scope: {owner: string; environment: string}) {
  const context: ProductContext = { status: "unavailable", cases: [], previous: [], reason: "История не прочитана" };
  try {
    const previous = await pool.query(`SELECT report FROM (SELECT DISTINCT ON (call_sid) report,call_sid
      FROM call_lab_jobs WHERE owner_id=$1 AND environment=$2
      AND call_sid<>$3 AND report->>'mode'='hint' AND report IS NOT NULL
      AND coalesce(report->>'synthetic','false')='false'
      AND (report->>'ended_at')::timestamptz < $4::timestamptz
      ORDER BY call_sid,created_at DESC) previous_calls
      ORDER BY (report->>'ended_at')::timestamptz DESC LIMIT 3`,
    [scope.owner, scope.environment, report.call_id, report.ended_at]);
    context.previous = previous.rows.map(r => r.report);
  } catch { context.reason = "Предыдущие отчёты недоступны; не считаются нулём"; }
  try {
    const active = await activeCompanyDocument(pool, scope.owner, scope.environment, "DOC-TALKHINT-IMPROVEMENT-JOURNAL");
    if (active) {
      context.cases = JSON.parse(active.text).cases;
      if (!Array.isArray(context.cases)) throw Error("journal invalid");
      context.revision = active.revision; context.status = "available"; delete context.reason;
      return { ...report, product_followup: buildProductFollowup(report, source, context) };
    }
    const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
      (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
    if (q.rowCount !== 1) throw Error("ambiguous model");
    const s = readHypothesis(await unpackModel(pool, q.rows[0].owner_key, q.rows[0].state), "new-country");
    const document = s.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL");
    if (!document) throw Error("journal missing");
    context.cases = JSON.parse(document.text).cases;
    if (!Array.isArray(context.cases)) throw Error("journal invalid");
    context.revision = s.revision;
    context.status = "available";
    delete context.reason;
  } catch { context.reason = "Журнал модели недоступен; прежние попытки и их эффект не подтверждены"; }
  return { ...report, product_followup: buildProductFollowup(report, source, context) };
}
