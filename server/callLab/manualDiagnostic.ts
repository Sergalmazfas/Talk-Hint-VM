import { hintMeasurements } from "./measurements";

/** Evidence dossier for this saved owner-authorized call, not a live incident verdict. */
export function savedMintDiagnostic(source: any) {
  if (source?.call_id !== "CA0d57ac3746143478fd70c1c624d14412")
    throw new Error("DIAGNOSTIC_CALL_SCOPE_REQUIRED");
  const m = hintMeasurements(source);
  const visible = new Set((source.ui_visibility?.events ?? [])
    .filter((e: any) => e.kind === "hint").map((e: any) => String(e.utteranceId)));
  const missing = source.hints.filter((e: any) => e.outcome === "sent" &&
    e.delivered_at != null && !visible.has(String(e.id))).map((e: any) => String(e.id));
  const reasons = Object.entries(m.drop_reasons).map(([reason, count]) => {
    const ids = source.hints.filter((e: any) => e.outcome === "dropped" && e.drop_reason === reason)
      .map((e: any) => e.id).join(", ");
    return `${reason} ${count} [${ids}]`;
  }).join("; ");
  const latency = source.latency_summary;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : "?";
  const menu = source.hints.find((e: any) => String(e.id) === "16")?.text;
  return {
    version: 1, basis: "saved_snapshot_and_read_only_code_inspection",
    qa_is_independent: true, not_owner_acceptance: true,
    acknowledged_without_ui_ids: missing,
    answers: [
      { id: "D1", question: "Почему подавлено 10?",
        answer: `${reasons}. По коду cooldown — пауза после предыдущей подсказки; stale — новая реплика обогнала генерацию; duplicate_suggestion — похожий недавний смысл; reaction_only — короткая реакция. Это причины фильтров, не доказательство правильности каждого подавления: тексты этих кандидатов не сохранены.`,
        evidence: ["source.hints: outcome/drop_reason", "server/websocket.ts: cooldown/reactionOnly/freshness/dedup guards"] },
      { id: "D2", question: "Почему 3 из 14 ACK без показа?",
        answer: `Для #${missing.join(", #")} есть ACK, но нет отметки показа. Подтверждён разрыв телеметрии, а не доказанные непоказы. ACK означает приём сообщения; причина отсутствия UI-отметки по снимку не установлена.`,
        evidence: ["source.hints.delivered_at", "source.ui_visibility.events.kind=hint"] },
      { id: "D3", question: "Почему выросла задержка?",
        answer: `Рост не доказан: сопоставимого исходного периода в снимке нет. Основное время в замерах — Brain: p50/p95 ${num(latency?.brainP50Ms)}/${num(latency?.brainP95Ms)} мс; отправка→ACK ${num(latency?.deliveryP50Ms)}/${num(latency?.deliveryP95Ms)} мс. Это локализация задержки, не доказанная причина её роста. STT final не конец физической речи.`,
        evidence: ["source.latency_summary", "source.hints.stt_final_at/sent_at/delivered_at"] },
      { id: "D4", question: "Где теряется I see?",
        answer: typeof menu === "string" && menu.includes('If found: "the reset menu now."')
          ? 'В #16 уже в сохранённом серверном тексте found начинается с «the reset menu now.», без «I see». Это не только отрисовка iPhone. Ответ модели до обработки и промежуточные варианты не сохранены — этап обрезания внутри серверной цепочки не установлен.'
          : "Текст #16 не даёт ожидаемого подтверждения; место потери по этому снимку неизвестно.",
        evidence: ["source.hints[id=16].text", "скриншот владельца: IMG_3771"] },
      { id: "D5", question: "Почему нет перевода собеседника?",
        answer: "В снимке нет payload перевода реплик собеседника и сквозного журнала их отправки/показа. 11/11 отметок перевода относятся к подсказкам, не к собеседнику. На скриншотах владельца перевод собеседника отсутствует; первопричина (настройка, генерация, доставка или UI) не установлена.",
        evidence: ["source limitations", "source.ui_visibility", "скриншоты владельца IMG_3770/IMG_3772"] },
    ],
  };
}

/** Short manual-only mail. Arithmetic and evidence dossier are never supplied by the LLM. */
export function manualDiagnosticLetter(report: any, origin: string) {
  const m = report.deterministic;
  const value = (v: unknown) => typeof v === "number" ? String(v) : "?";
  const qa = report.qa_status ?? "НЕ ПРОВЕРЕНО QA";
  const groups = new Map<string, string[]>();
  for (const f of report.analysis?.findings ?? []) {
    if (typeof f.category !== "string" || typeof f.event_id !== "string") continue;
    groups.set(f.category, [...(groups.get(f.category) ?? []), f.event_id]);
  }
  const rejected = qa !== "QA: принято";
  const shortIssue = (issue: unknown) => {
    const text = String(issue).trim();
    const sentence = text.match(/^([\s\S]*?[.!?])(?:\s|$)/)?.[1] ?? text;
    return sentence.length <= 450 ? sentence : sentence.slice(0, 420).replace(/\s+\S*$/, "") + "…";
  };
  const link = /^\/api\/admin\/call-lab\/reports\/[a-f0-9]{64}$/.test(report.private_report_path ?? "")
    ? `${origin}${report.private_report_path} (вход владельца)` : "Ссылка не сформирована.";
  return {
    subject: `ПОВТОР · Hint · Mint · ${qa}`,
    body: [
      "Лаборатория Hint · короткая форма v3 · сохранённый звонок Mint",
      "Разбор из Dev. Новый звонок не совершался, production не изменён. AI-оценка, не приёмка владельцем.",
      qa, "",
      "ЦИФРЫ КОДА",
      `Попыток ${value(m?.recorded_attempts)}; создано с сохранённым текстом ${value(m?.with_recorded_text)} (всего сгенерировано — неизвестно).`,
      `Отправлено ${value(m?.sent)}; ACK ${value(m?.acknowledged)}; отметок показа на iPhone ${value(m?.hints_ui_claimed)}.`,
      `Подавлено ${value(m?.dropped)}: ${Object.entries(m?.drop_reasons ?? {}).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
      `ACK без отметки показа: #${report.manual_diagnostic.acknowledged_without_ui_ids.join(", #")}. Это не доказанный непоказ.`,
      `Перевод подсказок: ${value(m?.translations_ui_claimed)}/${value(m?.hints_ui_claimed)} отметок; перевод собеседника — неизвестно.`,
      `STT final→ACK: p50 ${value(m?.stt_final_to_ack_ms?.p50)} / p95 ${value(m?.stt_final_to_ack_ms?.p95)} мс; n=${value(m?.stt_final_to_ack_ms?.samples)}.`,
      "Отметки iPhone не доказывают чтение или показ до ответа. Использование/нужность и общий процент — неизвестно.",
      "", "ПЯТЬ ВОПРОСОВ — ИНЖЕНЕРНАЯ СВЕРКА",
      "Код и скриншоты проверялись отдельно главным инженером; сами файлы не были вложены в JSON для QA. Это ограничение независимой приёмки.",
      ...report.manual_diagnostic.answers.map((a: any) => `${a.id}. ${a.question} ${a.answer}`),
      "", "P.LAB",
      report.analysis?.summary_ru
        ? "Разбор D1–D5 и черновик письма подготовлены. Полный текст и основания — по ссылке ниже; статус QA не изменён."
        : `Разбор не завершён: ${report.analysis_failure?.code ?? "причина неизвестна"}.`,
      ...(rejected ? ["", "ПОЧЕМУ QA НЕ ПРИНЯЛА",
        `Категории разбора (не приняты QA): ${Array.from(groups).map(([c, ids]) => `${c}: #${ids.join(", #")}`).join("; ") || "нет оценок"}.`,
        ...(report.qa_issues?.length ? report.qa_issues.map((issue: string, i: number) =>
          `${i + 1}. ${shortIssue(issue)}`) : ["Причина не получена от QA; приёмку не утверждаем."])] : []),
      "", "Замечания выше сокращены до первых предложений. Полный разбор, QA, основания и ограничения:", link,
    ].join("\n"),
  };
}
