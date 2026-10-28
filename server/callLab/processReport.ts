/** Mail v4 (per-call decisions), funnel v3. Unknown never means zero/success. */
import { hintMeasurements } from "./measurements";
import { manualDiagnosticLetter } from "./manualDiagnostic";
import { labRelease } from "./policy";
import { productLetterSection } from "./productFollowup";

export function completeLabReport(report: any, source: unknown, key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("LAB_BAD_REPORT_KEY");
  const result = { ...report, lab_release: report.lab_release ?? labRelease, deterministic: hintMeasurements(source),
    private_report_path: `/api/admin/call-lab/reports/${key}`, mail_form_version: 4 };
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
  if (report.execution === "mode_analysis_not_connected")
    return { subject: report.letter.subject, body: [report.letter.body, ...productLetterSection(report)].join("\n") };
  if (report.manual_trigger && report.manual_diagnostic?.version === 1) {
    const mail = manualDiagnosticLetter(report, reportOrigin(report.environment));
    return { ...mail, body: [mail.body, ...productLetterSection(report)].join("\n") };
  }
  const p = processReport(report), m = report.deterministic;
  const value = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? String(v) : "?";
  const duration = Number.isFinite(report.duration_ms) && report.duration_ms >= 0
    ? `${Math.round(report.duration_ms / 6000) / 10} мин` : "? мин";
  const failed = report.execution === "analysis_not_completed";
  const qaAccepted = !failed && report.qa_status === "QA: принято";
  const qaReturned = !failed && report.qa_status === "QA: расхождения не устранены";
  const uiGap = typeof m?.acknowledged === "number" && typeof m?.hints_ui_claimed === "number"
    && m.acknowledged > m.hints_ui_claimed;
  const weak = uiGap ? "показ не подтверждён" : failed ? "разбор не завершён"
    : qaReturned ? "разбор не принят проверкой" : !qaAccepted ? "проверка не выполнена" : "не установлено";
  const subject = `${report.synthetic ? "ТЕСТ · " : report.manual_trigger ? "ПОВТОР · " : ""}Hint · ${duration} · до экрана дошло ${value(m?.hints_ui_claimed)} из ${value(m?.sent)} · слабое звено: ${weak}`;
  const problems: string[] = [];
  if (failed) problems.push("Разбор не завершён, независимая проверка не выполнена. Исправляет инженер лаборатории.");
  else if (qaReturned) problems.push("Проверка вернула разбор на доработку. Отвечают аналитик лаборатории и проверяющий.");
  else if (!qaAccepted) problems.push("Независимая проверка не завершилась. Разбор не принят. Отвечает инженер лаборатории.");
  if (uiGap) problems.push("Телефон подтвердил получение, но для части подсказок не сообщил показ. Проверяет инженер приложения; это ещё не доказательство, что их не было на экране.");
  if (Array.isArray(report.qa_issues) && report.qa_issues.length && !failed)
    problems.push(`Замечания проверки: ${report.qa_issues.slice(0, 2).map((s: unknown) => String(s).replace(/\s+/g, " ").slice(0, 180)).join("; ")}. Подробности — по ссылке.`);
  if (!problems.length) problems.push("Подтверждённое слабое звено не установлено. Это не означает, что разговор прошёл хорошо.");
  const latency = (v: any) => `обычно ${value(v?.p50)} / в 95% случаев до ${value(v?.p95)} мс`;
  const used = report.owner_feedback?.usedHints;
  const body = [
    `Лаборатория: ${report.lab_release?.version ?? "версия не сохранена"}; ${report.lab_release?.framework ?? "framework неизвестен"}.`,
    ...(report.engineering_dossier ? [
      "ИНЖЕНЕРНАЯ ПРОВЕРКА РЕГРЕССИИ (отдельно от AI-приёмки)",
      ...report.engineering_dossier.answers.map((a: any) => `${a.question}: ${a.answer}`),
      "Полные основания инженерной сверки сохранены в результате разбора.",
    ] : []),
    ...(report.manual_trigger ? ["Ручной повторный запуск из Dev по сохранённому звонку. Исходный production-отчёт не изменён."] : []),
    report.synthetic ? "СИНТЕТИЧЕСКИЙ ПРИМЕР. Реального звонка не было. Числа примера не данные продукта." : "Короткий отчёт Hint",
    `Проверка разбора: ${qaAccepted ? "принято" : qaReturned ? "не принято" : "не выполнена"}. Это не приёмка владельцем.`,
    "", "ВОРОНКА — ЦИФРЫ ПРОГРАММЫ",
    `Попыток ${value(m?.recorded_attempts)} → отправлено ${value(m?.sent)} → показано ${value(m?.hints_ui_claimed)}.`,
    `Получение телефоном подтверждено: ${value(m?.acknowledged)}.`,
    `Подавлено: ${value(m?.dropped)}. Причины: ${dropSummary(m?.drop_reasons)}.`,
    `Перевод у подсказок: ${value(m?.translations_ui_claimed)} из ${value(m?.hints_ui_claimed)} показанных.`,
    `Перевод собеседника: ${value(m?.guest_translation_count)} — нет сохранённого измерения, не ноль.`,
    `Время до подсказки: ${latency(m?.stt_final_to_ack_ms)}; из них подготовка текста: ${latency(m?.brain_ms)}.`,
    "Время считается от завершения распознавания до подтверждения телефоном, не до чтения на экране.",
    `Использовано: ${Number.isSafeInteger(used) && used >= 0 ? `${used} — со слов владельца` : "не установлено"}.`,
    `Общий процент: ${p.percent === null ? "?" : `${p.percent}% (${p.numerator}/${p.denominator})`}. Использовано / нужно по рубрике.`,
    "Цель разговора: отдельно, достижение не подтверждено.",
    "",
    "ГДЕ СЛОМАЛОСЬ",
    ...problems.slice(0, 3),
    ...productLetterSection(report),
    "ПОЛНЫЙ РАЗБОР",
    typeof report.private_report_path === "string" && /^\/api\/admin\/call-lab\/reports\/[a-f0-9]+$/.test(report.private_report_path)
      ? `${reportOrigin(report.environment)}${report.private_report_path} (вход владельца обязателен)`
      : "Приватный раздел лаборатории /api/admin/call-lab/status; доступ владельца. Ссылка конкретного отчёта не сформирована.",
    "Журнал может быть неполным. Отметки iPhone не доказывают чтение/произнесение. «?» — неизвестно.",
  ].join("\n");
  return { subject, body };
}

function dropSummary(reasons: Record<string, number> | undefined) {
  const names: Record<string, string> = {
    superseded: "собеседник уже продолжил", cooldown: "слишком близко к предыдущей",
    no_suggestion: "модель не предложила ответ", stale: "ответ устарел",
    duplicate: "повтор", duplicate_suggestion: "повтор похожей подсказки",
    echo: "повтор речи", farewell: "завершение разговора",
    goal_achieved: "цель сочтена достигнутой", waiting_for_info: "ожидание информации",
    reaction_only: "короткая реакция", delivery_timeout: "телефон не подтвердил получение",
  };
  return Object.entries(reasons ?? {}).map(([key, n]) => `${names[key] ?? "другая причина (подробнее в разборе)"} — ${n}`).join("; ") || "не сохранены";
}

function reportOrigin(environment: unknown) {
  // Published origin verified with the platform deployment API, not inferred
  // from the Replit dev domain. Never take a destination from model output.
  if (environment === "production") return "https://talkhint.app";
  const domain = process.env.REPLIT_DEV_DOMAIN;
  return domain && /^[a-z0-9.-]+$/i.test(domain) ? `https://${domain}` : "";
}
