/** Server-owned v3 rendering. Unknown coverage is never a zero or a success. */
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
  return {
    version: 3, percent, numerator: countsValid ? used : null, denominator: countsValid ? needed : null,
    formula: "использованные подсказки / моменты, где подсказка была нужна по рубрике × 100%",
    rows, weakLink: "не установлено", goalSeparate: true,
  };
}

export function renderProcessLetter(report: any): { subject: string; body: string } {
  const p = processReport(report);
  const duration = Number.isFinite(report.duration_ms) && report.duration_ms >= 0
    ? `${Math.round(report.duration_ms / 6000) / 10} мин` : "? мин";
  const subject = `${report.synthetic ? "ТЕСТ · " : ""}Hint · ${duration} · процесс ${p.percent === null ? "?" : `${p.percent}%`} · слабое звено: ${p.weakLink}`;
  const body = [
    report.synthetic ? "СИНТЕТИЧЕСКИЙ ПРИМЕР v3. Реального звонка не было. Числа примера не данные продукта." : "Лаборатория Hint · форма v3",
    report.execution === "manual_assistant_review"
      ? "Ручной разбор ассистентом по сохранённым данным и скриншотам. CrewAI и независимый QA не запускались. Не приёмка владельцем."
      : "AI-оценка не является приёмкой владельцем или отзывом участника.",
    `QA: ${report.qa_status ?? "НЕ ПРОВЕРЕНО QA"}`,
    ...(report.qa_issues ?? []),
    "", "ПЛАН / ФАКТ",
    ...p.rows.map(r => `${r.name}\nПлан: ${r.plan} | Факт: ${r.fact} · ${r.reason}${
      report.execution === "manual_assistant_review" &&
      typeof report.manual_observations?.[r.id] === "string"
        ? `\nСохранённое свидетельство: ${report.manual_observations[r.id]}` : ""}`),
    "", `Общий процент: ${p.percent === null ? "?" : `${p.percent}% (${p.numerator}/${p.denominator})`}`,
    `Формула: ${p.formula}. Цель разговора не входит в процент.`,
    "", "ГДЕ СЛОМАЛОСЬ",
    "По доступным измерениям слабое звено не установлено. Неизвестное не означает дефект.",
    ...((report.analysis?.findings ?? []).slice(0, 3).map((f: any) =>
      `AI-наблюдение (${String(f.category)}), событие ${String(f.event_id)}: ${String(f.explanation)}`)),
    "", "КОМУ ПЕРЕДАТЬ",
    "P.LG.TECH — проверить полноту измерений; продукт — оценить наблюдения. Передача не означает выполненное исправление.",
    "HEAD.07 — последующий выборочный контроль; outbox не принимает QA.",
    "", "ПОЛНЫЙ РАЗБОР",
    typeof report.private_report_path === "string" && /^\/api\/admin\/call-lab\/reports\/[a-f0-9]+$/.test(report.private_report_path)
      ? `${reportOrigin(report.environment)}${report.private_report_path} (вход владельца обязателен)`
      : "Приватный раздел лаборатории /api/admin/call-lab/status; доступ владельца. Ссылка конкретного отчёта не сформирована.",
    "", "ОГРАНИЧЕНИЯ",
    ...(report.analysis?.limitations ?? []),
    `WER: ${typeof report.metrics?.wer === "number" ? report.metrics.wer : "неизвестно"}`,
    "Отправка и ACK не равны видимости до ответа; WER и цена минуты без исходных данных неизвестны.",
  ].join("\n");
  return { subject, body };
}

function reportOrigin(environment: unknown) {
  // Published origin verified with the platform deployment API, not inferred
  // from the Replit dev domain. Never take a destination from model output.
  if (environment === "production") return "https://talkhint.app";
  const domain = process.env.REPLIT_DEV_DOMAIN;
  return domain && /^[a-z0-9.-]+$/i.test(domain) ? `https://${domain}` : "";
}
