import { createHash } from "node:crypto";
import type { Pool } from "pg";

export const HINT_CANDIDATES = {
  latency: "Hint: разобрать задержку подсказок относительно SLA; не предлагать непроверенные причины как факты",
  usefulness: "Hint: разобрать низкую долю использованных подсказок; отличать метрику совпадения от полезности",
  unavailable: "Hint: разобрать ANALYSIS_UNAVAILABLE и границы полноты отчётов; не считать отправку письма успешным анализом",
} as const;
export type HintCandidate = keyof typeof HINT_CANDIDATES;
export type HintEvidence = ReturnType<typeof projectHintEvidence>;
const numeric = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e8 ? v : null;
const counters = (value: any, keys: string[]) => Object.fromEntries(keys.map(k => [k, numeric(value?.[k])]));
// Intentionally no free-text sanitizer: arbitrary text, names, numbers, IDs,
// titles, addresses, transcripts, prompts and exception messages never cross.
// Only exact enum values and bounded numeric counters survive projection.
export function projectHintEvidence(rows: { calls: any[]; reports: any[]; problems: any[] }) {
  const calls = rows.calls.slice(0, 12).map((c, i) => ({
    ref: `session-${i + 1}`,
    latency: counters(c.latency, ["e2eP50Ms", "e2eP95Ms", "brainP95Ms", "deliveryP95Ms", "withinSlaPct", "hintsSent", "hintsDropped"]),
    usage: counters(c.usage, ["delivered", "usedFull", "usedPartial", "ignored", "unknown", "usageRatePct"]),
    slaMs: numeric(c.sla),
    errors: counters(c.errors, ["stale", "cooldown", "duplicate_suggestion"]),
  }));
  const qa = ["QA: принято", "QA: расхождения не устранены", "НЕ ПРОВЕРЕНО QA"];
  const categories = ["верная", "неверная", "неизвестно", "неуместная", "запоздалая"];
  const reports = rows.reports.slice(0, 12).map((r, i) => ({
    ref: `report-${i + 1}`, qa: qa.includes(r.qa) ? r.qa : "unknown",
    findings: Array.isArray(r.categories) ? r.categories.slice(0, 100).map((c: unknown) => categories.includes(c as string) ? c : "unknown") : [],
  }));
  const problems = rows.problems.slice(0, 20).map((p, i) => ({
    ref: `problem-${i + 1}`, code: p.code === "ANALYSIS_UNAVAILABLE" ? "ANALYSIS_UNAVAILABLE" : "unknown",
    count: numeric(p.count),
  }));
  return { version: 1, calls, reports, problems,
    limitations: ["numeric_and_enum_excerpt_only", "no_transcripts_or_hint_text", "no_third_party_names_or_phone_numbers",
      "latency_starts_at_stt_final_not_physical_speech_end", "usage_matching_is_not_user_satisfaction",
      "historical_signals_do_not_prove_current_failure", "problem_source_is_call_lab_watchdog_not_all_company_issues"] };
}
export function evidenceHash(e: HintEvidence) { return createHash("sha256").update(JSON.stringify(e)).digest("hex"); }

/** Fixed, owner-scoped SELECTs. No user SQL, arbitrary table names, or raw text. */
export async function readHintEvidence(pool: Pool, ownerId: string): Promise<HintEvidence> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8s'");
    const calls = await client.query(`
      SELECT c.metadata->'hintLatency'->'summary' AS latency,
             c.metadata->'hintLatency'->'slaMs' AS sla,
             jsonb_build_object(
               'delivered',c.metadata->'hintUsage'->'delivered',
               'usedFull',c.metadata->'hintUsage'->'usedFull',
               'usedPartial',c.metadata->'hintUsage'->'usedPartial',
               'ignored',c.metadata->'hintUsage'->'ignored',
               'unknown',c.metadata->'hintUsage'->'unknown',
               'usageRatePct',c.metadata->'hintUsage'->'usageRatePct') AS usage,
             (SELECT jsonb_object_agg(reason,n) FROM (
                SELECT e->>'dropReason' reason,count(*)::integer n
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.metadata->'hintLatency'->'entries')='array'
                  THEN c.metadata->'hintLatency'->'entries' ELSE '[]'::jsonb END) e
                WHERE e->>'dropReason' IN ('stale','cooldown','duplicate_suggestion') GROUP BY 1
             ) drops) AS errors
      FROM calls c WHERE c.user_id=$1 AND c.metadata->'labHintSource'->>'mode'='hint'
        AND c.metadata->'labHintSource'->>'environment'='production'
      ORDER BY c.started_at DESC LIMIT 12`, [ownerId]);
    const reports = await client.query(`
      SELECT j.report->>'qa_status' AS qa,
        (SELECT jsonb_agg(f->>'category') FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(j.report->'analysis'->'findings')='array'
          THEN j.report->'analysis'->'findings' ELSE '[]'::jsonb END) f) AS categories
      FROM call_lab_jobs j WHERE j.owner_id=$1 AND j.environment='production'
        AND j.report->>'mode'='hint' AND j.report->>'synthetic'='false'
      ORDER BY j.created_at DESC LIMIT 12`, [ownerId]);
    const problems = await client.query(`
      SELECT w.value->>'code' AS code,count(*)::integer AS count
      FROM call_lab_controls c CROSS JOIN LATERAL jsonb_each(c.watchdog) w
      WHERE c.owner_id=$1 AND c.environment='production'
        AND w.value->>'code'='ANALYSIS_UNAVAILABLE'
      GROUP BY 1`, [ownerId]);
    await client.query("COMMIT");
    return projectHintEvidence({ calls: calls.rows, reports: reports.rows, problems: problems.rows });
  } catch {
    await client.query("ROLLBACK");
    throw Error("HINT_EVIDENCE_UNAVAILABLE");
  } finally { client.release(); }
}
