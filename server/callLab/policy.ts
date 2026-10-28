/** Owner decision 2026-10-28. Never authorizes other users or new recordings. */
export const labRelease = {
  version: "owner-calls-v6",
  decision: "2026-10-28",
  framework: "crewai@1.15.30",
};

/** Existing call history is authoritative; Secretary links take precedence. */
export const ownerCallsSql = `SELECT c.*,
  CASE WHEN EXISTS (SELECT 1 FROM secretary_tasks t
    WHERE t.user_id=c.user_id AND (t.call_id=c.id OR t.call_sid=c.call_sid))
    THEN 'secretary'
    WHEN c.metadata->>'mode' IN ('hint','copilot','translator','prepare','secretary')
      THEN c.metadata->>'mode'
    WHEN c.metadata#>>'{labHintSource,mode}' IN ('hint','copilot','translator','prepare','secretary')
      THEN c.metadata#>>'{labHintSource,mode}'
    ELSE 'unknown' END AS lab_mode
  FROM calls c`;

export function modeLabel(mode: string) {
  return ({ hint: "Hint", copilot: "Copilot", translator: "Translator",
    secretary: "Катя", prepare: "Prepare", unknown: "не определён" } as Record<string, string>)[mode] ?? "не определён";
}

export function modeNotice(call: any, environment: string) {
  const mode = call.lab_mode ?? "unknown";
  return {
    format: "talkhint.plab.mode-notice", version: 1, lab_release: labRelease,
    mode, call_id: call.call_sid, environment, synthetic: false,
    execution: "mode_analysis_not_connected", qa_status: "НЕ ПРИМЕНИМО: разбор не подключён",
    ended_at: call.ended_at, analysis: null,
    letter: { subject: `Звонок в ${modeLabel(mode)} · разбор не подключён`,
      body: `Ваш звонок в ${modeLabel(mode)} зафиксирован.\nРазбор не подключён; AI-оценка и QA не выполнялись.\nЛаборатория: ${labRelease.version} (${labRelease.framework}).\nЗавершение: ${new Date(call.ended_at).toISOString()}.\nЭто уведомление, не успешный разбор.` },
  };
}
