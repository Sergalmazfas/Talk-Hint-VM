/** P.PRODUCT's bounded, code-owned handoff. No approval, model call or execution. */
export type ProductContext = {
  revision?: number; status: "available" | "unavailable";
  cases: any[]; previous: any[]; reason?: string;
};
export const perCallPolicy = {
  id: "owner-per-call-decisions-2026-10-28", version: 1,
  role: "P.PRODUCT", reference: "DOC-OWNER-CALLS",
  allowedChanges: ["prompt", "trigger", "ios_display", "cooldown", "filter", "diagnostics"],
  escalation: "Модель/связка/провайдер — только доказанная недостаточность настроек в журнале или новая находка P.TECH; отдельное решение владельца.",
  reply: "Ответ владельца сейчас в чат: ID строки — да/нет. Gmail-приём этим изменением не подключается.",
  next: "После да — HEAD.07 в Dev, проверки, ближайшая публикация владельцем; следующий звонок — было → стало. Недельная сводка только итог.",
};
const compact = (x: any) => typeof x === "string" ? x.replace(/\s+/g, " ").slice(0, 450) : JSON.stringify(x ?? null).slice(0, 450);

export function buildProductFollowup(report: any, source: any, context: ProductContext) {
  const issues: any[] = [], m = report.deterministic;
  const previous = context.previous.filter(p => p.call_id !== report.call_id).slice(0, 3).map(p => ({
    callId: p.call_id, at: p.ended_at ?? null, laboratory: p.lab_release?.version ?? "не сохранена",
    shown: p.deterministic?.hints_ui_claimed ?? null, sent: p.deterministic?.sent ?? null,
    p50: p.deterministic?.stt_final_to_ack_ms?.p50 ?? null,
    p95: p.deterministic?.stt_final_to_ack_ms?.p95 ?? null,
    verdict: p.qa_status ?? "неизвестно",
  }));
  const add = (kind: string, problem: string, evidence: string, proposal: string, criterion: string, match: RegExp) => {
    const history = context.cases.filter(c => match.test(JSON.stringify(c))).slice(0, 3).map(c => ({
      caseId: c.caseId, label: c.label ?? c.caseId,
      attempts: (c.history ?? []).slice(-2).map((h: any) => ({
        at: h.at ?? null, action: compact(h.note ?? h.stage ?? h.source),
        evidence: compact(h.evidence ?? h.verification ?? "не приложено"),
      })),
      effect: c.ownerEvaluationOfImplementedChange == null
        ? "помогло ли — не подтверждено" : compact(c.ownerEvaluationOfImplementedChange),
    }));
    issues.push({ id: `${report.call_id ?? "call"}:D${issues.length + 1}`, kind, problem, evidence,
      tried: history, historyStatus: context.status === "unavailable" ? "журнал недоступен"
        : history.length ? "найдены связанные записи; это не доказательство результата" : "связанная запись не найдена, не доказательство отсутствия попыток",
      proposal, executor: "HEAD.07", acceptor: "владелец: да/нет; затем технические проверки",
      criterion, decision: kind === "diagnostics" ? "internal_role_step" : "awaiting_owner",
      implemented: false, nextCall: "сверить тот же признак; эффект неизвестен до проверки" });
  };
  const hints = source?.hints ?? [];
  const events = source?.ui_visibility?.events ?? [];
  let maxGap: { id: string; ms: number } | null = null;
  for (const h of hints) {
    const ui = events.find((e: any) => e.kind === "hint" && String(e.utteranceId) === String(h.id));
    const received = Date.parse(ui?.receivedAt ?? "");
    const ack = Number(h.delivered_at);
    if (ui && Number.isFinite(received) && Number.isFinite(ack) && ack > 0 && received >= ack &&
        (!maxGap || received - ack > maxGap.ms)) maxGap = { id: String(h.id), ms: received - ack };
  }
  // 5s is a diagnostic selection filter, NOT an approved display SLA.
  if ((m?.acknowledged > m?.hints_ui_claimed) || (maxGap && maxGap.ms >= 5000))
    add("ios_display", "Не совпали подтверждения получения и отметки показа",
      `ACK ${m?.acknowledged ?? "?"}; отметок показа ${m?.hints_ui_claimed ?? "?"}.` +
      (maxGap ? ` #${maxGap.id}: разрыв серверных отметок ${maxGap.ms} мс; не доказательство задержки физического показа.` : ""),
      "Проверить обновление карточки и отметки показа iOS; отделить время события на устройстве от времени получения сервером. Исправлять найденный дефект, не менять модель.",
      "Для каждой карточки сопоставлены ID, ACK, время устройства и получение отметки; неизвестное не объявлено задержкой экрана.",
      /экран|телеметр|показ|карточ/i);
  if (hints.some((h: any) => /sure[,.]?\s+i['’]?ll wait/i.test(h.text ?? "")) ||
      /Sure, I'll wait/.test(JSON.stringify(report.engineering_dossier ?? {})))
    add("trigger", "Проверить уместность «Sure, I'll wait»",
      "В сохранённом материале есть эта фраза. Наличие фразы не доказывает ошибку во всех ситуациях; контекст проверяется отдельно.",
      "Уточнить триггер wait_state: отличать реальное ожидание от вопроса собеседника о результате действий владельца. Сначала offline-примеры.",
      "Вопрос о результате не вызывает «я подожду»; реальное ожидание сохраняется; неизвестное состояние владельца не выдумывается.",
      /wait_state|ожидан|подожд|быстр.*разговор/i);
  const mismatch = (report.engineering_dossier?.answers ?? []).some((a: any) => /не на тот|текущ.*вопрос|несовпад/i.test(a.question ?? ""));
  const disputed = (report.analysis?.findings ?? []).filter((f: any) => f.category === "ошибочная");
  if (mismatch || disputed.length)
    add("filter", "Проверить соответствие подсказки текущему вопросу",
      mismatch ? "В инженерной сверке зарегистрировано несовпадение; точный этап потери соответствия не установлен."
        : `Сигнал разбора: ${disputed.map((f: any) => `#${f.event_id}`).join(", ")}; QA: ${report.qa_status ?? "неизвестно"}. Это не подтверждённая причина.`,
      "Проверить привязку к реплике и актуальность карточки; на сохранённом тексте проверить фильтр устаревших ответов и правило неизвестного состояния владельца.",
      "Ответ привязан к проверяемому вопросу, устаревшая карточка не выдаётся за текущую; сравнение с исходником без новых фактов.",
      /вопрос|цель|устар|кофейн|состояни/i);
  if (report.execution !== "mode_analysis_not_connected" &&
      (report.execution === "analysis_not_completed" || report.qa_status !== "QA: принято"))
    add("diagnostics", "Разбор не получил независимого принятия",
      report.execution === "analysis_not_completed" ? "AI-разбор не завершён; цифры кода сохранены отдельно." : compact(report.qa_issues ?? "QA недоступна"),
      "Инженеру сверить сбой или спорные основания рубрики offline; сохранить исходный возврат. Новый платный повтор — только в действующем разрешении.",
      "Структура валидна, оценки имеют проверяемые основания; QA остаётся независимой, спорные выводы не превращены в факты.",
      /рубри|QA|провер|разбор/i);
  return {
    version: 1, policy: perCallPolicy, callId: report.call_id ?? null,
    sourceRevision: context.revision ?? null, journal: "DOC-TALKHINT-IMPROVEMENT-JOURNAL",
    contextStatus: context.status, contextReason: context.reason ?? null,
    issues, previous, current: { shown: m?.hints_ui_claimed ?? null, sent: m?.sent ?? null,
      p50: m?.stt_final_to_ack_ms?.p50 ?? null, p95: m?.stt_final_to_ack_ms?.p95 ?? null },
    comparison: "Сравниваются одинаковые сохранённые счётчики; разные разговоры не доказывают причинный эффект исправления.",
    decisionStatus: issues.some(i => i.decision === "awaiting_owner") ? "awaiting_owner" : "not_required",
    executionStarted: false,
  };
}

export function productLetterSection(report: any): string[] {
  const f = report.product_followup;
  if (!f) return ["", "ЧТО УЖЕ ПРОБОВАЛИ", "История не приложена; P.PRODUCT должен прочитать журнал. «Не найдено» не значит «не пробовали».",
    "НУЖНО РЕШЕНИЕ", "Нет подготовленных доказательных строк. Сначала адресная сверка P.PRODUCT; новая модель не предлагается."];
  const rows = f.issues.filter((x: any) => x.decision === "awaiting_owner")
    .map((x: any, i: number) => `${i + 1} [${x.id}] | ${x.proposal} | ${x.executor} | да / нет`);
  return ["", "ЧТО УЖЕ ПРОБОВАЛИ",
    ...f.issues.flatMap((x: any) => [
      `${x.problem}. ${x.evidence}`,
      ...x.tried.slice(0, 2).map((c: any) => `${c.caseId}: ${c.attempts.slice(-1).map((a: any) => `${a.at ?? "дата ?"} — ${a.action.slice(0, 160)}`).join("; ")}. ${c.effect}.`),
      ...(!x.tried.length ? [x.historyStatus] : []),
    ]),
    ...(f.previous.length ? ["ПРОШЛЫЕ ЗВОНКИ → ТЕКУЩИЙ",
      ...f.previous.map((p: any) => `${p.at ?? "дата ?"} (${p.callId}; ${p.laboratory}): показ ${p.shown ?? "?"}/${p.sent ?? "?"} → ${f.current.shown ?? "?"}/${f.current.sent ?? "?"}; p50/p95 ${p.p50 ?? "?"}/${p.p95 ?? "?"} → ${f.current.p50 ?? "?"}/${f.current.p95 ?? "?"} мс.`)]
      : ["Сопоставимые предыдущие отчёты не приложены; эффект неизвестен."]),
    f.comparison,
    ...f.issues.filter((x: any) => x.decision === "internal_role_step")
      .map((x: any) => `Внутренняя работа роли, не запрос владельцу: ${x.executor} — ${x.proposal}`),
    "НУЖНО РЕШЕНИЕ", "№ / ID | Предложение | Кто делает | Ваш ответ",
    ...(rows.length ? rows : ["Подтверждённых оснований для изменения не найдено. Это не оценка «всё хорошо»."]),
    perCallPolicy.reply, perCallPolicy.next, perCallPolicy.escalation];
}
