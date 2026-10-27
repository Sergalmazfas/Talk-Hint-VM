/** Server-owned v3 rendering. Unknown coverage is never a zero or a success. */
import { hintMeasurements } from "./measurements";
import { manualDiagnosticLetter } from "./manualDiagnostic";

export function completeLabReport(report: any, source: unknown, key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("LAB_BAD_REPORT_KEY");
  const result = { ...report, deterministic: hintMeasurements(source),
    private_report_path: `/api/admin/call-lab/reports/${key}`, mail_form_version: 3 };
  return { ...result, process_plan_fact: processReport(result) };
}

export const processSteps = [
  ["prepare_goal", "Цель задана в Prepare"],
  ["opening_visible", "Первая фраза показана на экране звонка"],
  ["speech_recognized", "Речь собеседника распознана"],
  ["hint_created", "Подсказка создана, где была нужна"],
  ["hint_before_reply", "Подсказка показана до ответа владельца"],
  ["translation_visible", "Русский перевод показан"],
  ["hint_used", "Подсказка использована"],
  ["goal_achieved", "Цель разговора достигнута"],
] as const;

export function processReport(report: any) {
  // Only a separately verified rubric result may supply counts. LLM findings,
  // speech-match and generation counts are not a denominator of need.
  const assessment = report.process_rubric;
  const verified = assessment?.verification === "independently_verified" &&
    typeof assessment?.evidence === "string" && assessment.evidence.trim() &&
    typeof assessment?.rubric_version === "string" && assessment.rubric_version.trim();
  const needed = assessment?.needed_moments;
  const used = assessment?.used_hints;
  const countsValid = verified && Number.isSafeInteger(needed) && needed > 0 &&
    Number.isSafeInteger(used) && used >= 0 && used <= needed;
  const percent = countsValid ? Math.round(1000 * used / needed) / 10 : null;
  const rows = processSteps.map(([id, name]) => ({
    id, name, plan: id === "goal_achieved" ? "да" : "100% применимых случаев",
    fact: id === "hint_used" && countsValid ? `${percent}% (${used}/${needed})` : "?",
    reason: ["opening_visible", "hint_before_reply", "translation_visible"].includes(id)
      ? "нет подтверждённой телеметрии; время ответа/видимости не проверено"
      : id === "speech_recognized" ? "нет проверенного эталона распознавания"
      : id === "hint_used" ? countsValid ? "независимо проверенная рубрика" : "моменты нужности/использование не оценены по проверенной рубрике"
      : id === "prepare_goal" ? "наличие goalText не подтверждает принятие цели в Prepare"
      : id === "hint_created" ? "нет полного оценённого знаменателя нужности"
      : "результат цели не подтверждён",
  }));
  const m = report.deterministic;
  const row = (id: string) => rows.find(r => r.id === id)!;
  if (Number.isSafeInteger(m?.opening_ui_claims) && m.opening_ui_claims > 0)
    Object.assign(row("opening_visible"), { fact: `${m.opening_ui_claims} отметка iPhone`,
      reason: "клиент сообщил показ; не доказательство чтения или произнесения" });
  if (Number.isSafeInteger(m?.with_recorded_text))
    Object.assign(row("hint_created"), { fact: `${m.with_recorded_text} записей с текстом; покрытие ?`,
      reason: "число в сохранённом журнале, не знаменатель нужности" });
  if (Number.isSafeInteger(m?.hints_ui_claimed) && m.hints_ui_claimed > 0)
    row("hint_before_reply").reason = `${m.hints_ui_claimed} отметок показа; сопоставление со временем ответа не подтверждено`;
  if (Number.isSafeInteger(m?.translations_ui_claimed) && m.translations_ui_claimed > 0)
    Object.assign(row("translation_visible"), { fact: `${m.translations_ui_claimed} пар отметок подсказки/перевода`,
      reason: "диагностическое заявление клиента, не проверка чтения или правильности перевода" });
  return {
    version: 3, percent, numerator: countsValid ? used : null, denominator: countsValid ? needed : null,
    formula: "использованные подсказки / моменты, где подсказка была нужна по рубрике × 100%",
    rows, weakLink: report.execution === "analysis_not_completed" ? "AI-разбор не завершён" : "не установлено", goalSeparate: true,
  };
}

export function renderProcessLetter(report: any): { subject: string; body: string } {
  if (report.manual_trigger && report.manual_diagnostic?.version === 1)
    return manualDiagnosticLetter(report, reportOrigin(report.environment));
  const p = processReport(report);
  const duration = Number.isFinite(report.duration_ms) && report.duration_ms >= 0
    ? `${Math.round(report.duration_ms / 6000) / 10} мин` : "? мин";
  const subject = `${report.synthetic ? "ТЕСТ · " : report.manual_trigger ? "ПОВТОР · " : ""}Hint · ${duration} · процесс ${p.percent === null ? "?" : `${p.percent}%`} · слабое звено: ${p.weakLink}`;
  const labels: Record<string, string> = {
    prepare_goal: "Цель Prepare", opening_visible: "Первая фраза", speech_recognized: "Распознавание",
    hint_created: "Создание подсказок", hint_before_reply: "Показ до ответа",
    translation_visible: "Перевод подсказки", hint_used: "Использование", goal_achieved: "Цель разговора",
  };
  const body = [
    ...(report.manual_trigger ? ["Ручной повторный запуск из Dev по сохранённому звонку. Исходный production-отчёт не изменён."] : []),
    report.synthetic ? "СИНТЕТИЧЕСКИЙ ПРИМЕР v3. Реального звонка не было. Числа примера не данные продукта." : "Лаборатория Hint · форма v3",
    report.execution === "manual_assistant_review"
      ? "Ручной разбор ассистентом по сохранённым данным и скриншотам. CrewAI и независимый QA не запускались. Не приёмка владельцем."
      : "AI-оценка не является приёмкой владельцем или отзывом участника.",
    `QA: ${report.qa_status ?? "НЕ ПРОВЕРЕНО QA"}`,
    "", "ПЛАН / ФАКТ",
    "План — 100% применимых случаев; цель — отдельно.",
    ...p.rows.map(r => `${labels[r.id]}: ${r.fact}`),
    "", `Общий процент: ${p.percent === null ? "?" : `${p.percent}% (${p.numerator}/${p.denominator})`}`,
    "Использовано / нужно по рубрике. Цель разговора не входит в процент.",
    ...measurementLines(report.deterministic),
    "ГДЕ СЛОМАЛОСЬ",
    report.execution === "analysis_not_completed"
      ? `AI-разбор не завершён: ${report.analysis_failure?.code ?? "причина не сохранена старой версией"}. QA не выполнена.`
      : "Слабое звено по проверенной рубрике не установлено; неизвестное не означает дефект.",
    ...((report.analysis?.findings ?? []).slice(0, 1).map((f: any) =>
      `AI-наблюдение, не приёмка: ${String(f.explanation).slice(0, 160)}`)),
    "ПОЛНЫЙ РАЗБОР",
    typeof report.private_report_path === "string" && /^\/api\/admin\/call-lab\/reports\/[a-f0-9]+$/.test(report.private_report_path)
      ? `${reportOrigin(report.environment)}${report.private_report_path} (вход владельца обязателен)`
      : "Приватный раздел лаборатории /api/admin/call-lab/status; доступ владельца. Ссылка конкретного отчёта не сформирована.",
    `WER: ${typeof report.metrics?.wer === "number" ? report.metrics.wer : "неизвестно"}`,
    "Отметки iPhone не доказывают чтение/произнесение. Ограничения и основания — в полном разборе.",
  ].join("\n");
  return { subject, body };
}

function measurementLines(m: any): string[] {
  if (!m || m.recorded_attempts === null) return ["Измерения: нет сохранённого снимка."];
  const value = (v: unknown) => typeof v === "number" ? String(v) : "?";
  const latency = m.stt_final_to_ack_ms;
  return ["ИЗМЕРЕНИЯ СОХРАНЁННОГО ЖУРНАЛА",
    `Отправлено ${value(m.sent)} · ACK ${value(m.acknowledged)} · iPhone ${value(m.hints_ui_claimed)}`,
    `Подавлено ${value(m.dropped)}: ${Object.entries(m.drop_reasons ?? {}).map(([k, v]) => `${k} ${v}`).join(", ") || "причины неизвестны"}`,
    `STT final → ACK: p50 ${value(latency?.p50)} / p95 ${value(latency?.p95)} мс, n=${value(latency?.samples)}`,
    `Перевод: ${value(m.translations_ui_claimed)}/${value(m.hints_ui_claimed)} среди отметок показа; реплики собеседника — ?`];
}

function reportOrigin(environment: unknown) {
  // Published origin verified with the platform deployment API, not inferred
  // from the Replit dev domain. Never take a destination from model output.
  if (environment === "production") return "https://talkhint.app";
  const domain = process.env.REPLIT_DEV_DOMAIN;
  return domain && /^[a-z0-9.-]+$/i.test(domain) ? `https://${domain}` : "";
}
