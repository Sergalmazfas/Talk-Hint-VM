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
    // Match individual attempts, never an unrelated paragraph elsewhere in a
    // broad incident. A case label alone is not a previous attempted fix.
    const history = context.cases.map(c => ({ ...c,
      history: (c.history ?? []).filter((h: any) =>
        (!c.problemKey || c.problemKey === kind) &&
        match.test(`${h.problemKey ?? ""} ${h.note ?? h.action ?? ""}`) &&
        (/^(implemented|verified|tested)/.test(h.stage ?? "") ||
          (!h.stage && /исправил|проверил|прогнал|внедрил|изменил/i.test(h.note ?? "")))),
    })).filter(c => c.history.length).slice(0, 3).map(c => ({
      caseId: c.caseId, label: c.label ?? c.caseId,
      attempts: (c.history ?? []).slice(-2).map((h: any) => ({
        at: h.at ?? null, action: compact(h.note ?? h.stage ?? h.source),
        evidence: compact(h.evidence ?? h.verification ?? "не приложено"),
      })),
      // A rating of a broad incident is not a rating of this particular fix.
      effect: c.history.at(-1)?.ownerEvaluationOfImplementedChange == null
        ? "помогло ли — не подтверждено" : compact(c.history.at(-1).ownerEvaluationOfImplementedChange),
    }));
    issues.push({ id: `${report.call_id ?? "call"}:D${issues.length + 1}`, kind, problem, evidence,
      tried: history, historyStatus: context.status === "unavailable" ? "журнал недоступен"
        : history.length ? "найдены попытки именно по этой проблеме; эффект отдельно" : "раньше не пробовали (по доступному журналу)",
      proposal, executor: "HEAD.07", acceptor: "владелец: да/нет; затем технические проверки",
      criterion, decision: kind === "diagnostics" ? "internal_role_step" : "awaiting_owner",
      implemented: false, nextCall: "сверить тот же признак; эффект неизвестен до проверки" });
    const issue = issues.at(-1)!;
    const approved = context.cases.flatMap(c => c.history ?? []).filter((h: any) =>
      h.decisionId === issue.id && h.ownerDecision === "yes" &&
      ["implemented_dev", "verified_dev"].includes(h.stage)).at(-1);
    if (approved && kind !== "diagnostics") {
      issue.decision = "approved_dev";
      issue.implemented = true;
      issue.acceptor = "владелец: да; эффект ещё не принят, Publish владельцем";
    }
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
      "Заменять старые варианты сразу, сбрасывать прокрутку новой карточки и отправлять отметку в том же обновлении экрана → начало новой подсказки не скрывается. Варианты: замена сразу / сохранение позиции; рекомендуем замену сразу. Сверить время устройства и получения отметки: разрыв 24 с сам по себе не доказывает задержку экрана.",
      "Для каждой карточки сопоставлены ID, ACK, время устройства и получение отметки; неизвестное не объявлено задержкой экрана.",
      /телеметр|показ|карточ|scroll|visibility|ios_display/i);
  if (hints.some((h: any) => /sure[,.]?\s+i['’]?ll wait/i.test(h.text ?? "")) ||
      /Sure, I'll wait/.test(JSON.stringify(report.engineering_dossier ?? {})))
    add("trigger", "Проверить уместность «Sure, I'll wait»",
      "В сохранённом материале есть эта фраза. Наличие фразы не доказывает ошибку во всех ситуациях; контекст проверяется отдельно.",
      "Убрать срабатывание ожидания от одиночного checking; вопрос о ваших действиях выпускает обычную подсказку → вместо «подожду» помощь с ответом. Варианты: явные фразы ожидания / полностью убрать короткое подтверждение; рекомендуем явные фразы, сохранив полезное ожидание.",
      "Вопрос о результате не вызывает «я подожду»; реальное ожидание сохраняется; неизвестное состояние владельца не выдумывается.",
      /wait_state|ожидан|подожд|checking/i);
  const mismatch = (report.engineering_dossier?.answers ?? []).some((a: any) => /не на тот|текущ.*вопрос|несовпад/i.test(a.question ?? ""));
  const disputed = (report.analysis?.findings ?? []).filter((f: any) => f.category === "ошибочная");
  if (mismatch || disputed.length)
    add("filter", "Проверить соответствие подсказки текущему вопросу",
      mismatch ? "В инженерной сверке зарегистрировано несовпадение; точный этап потери соответствия не установлен."
        : `Сигнал разбора: ${disputed.map((f: any) => `#${f.event_id}`).join(", ")}; QA: ${report.qa_status ?? "неизвестно"}. Это не подтверждённая причина.`,
      "Новый явный вопрос заменяет старый в переносе; устаревший ответ отсекать до любой подсказки, включая «подожду» → ответ относится к текущему вопросу. Варианты: приоритет нового вопроса / отключить перенос совсем; рекомендуем приоритет нового, сохранив перенос при продолжении речи. Затем сверить соответствие на сохранённых примерах.",
      "Ответ привязан к проверяемому вопросу, устаревшая карточка не выдаётся за текущую; сравнение с исходником без новых фактов.",
      /перенос|carryover|устар|текущ.*вопрос|не на тот вопрос|состояни/i);
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
  const rows = f.issues.filter((x: any) => ["awaiting_owner", "approved_dev"].includes(x.decision))
    .map((x: any, i: number) => `${i + 1} [${x.id}] | ${x.proposal} | ${x.executor} | ${x.decision === "approved_dev" ? "да; подготовлено в Dev, ждёт публикации" : "да / нет"}`);
  return ["", "ЧТО УЖЕ ПРОБОВАЛИ",
    ...f.issues.filter((x: any) => x.kind !== "diagnostics").flatMap((x: any) => [
      `${x.problem}:`,
      ...x.tried.slice(0, 2).map((c: any) => `${c.caseId}: ${c.attempts.slice(-1).map((a: any) => `${a.at ?? "дата ?"} — ${a.action.slice(0, 160)}`).join("; ")}. ${c.effect}.`),
      ...(!x.tried.length ? [x.historyStatus] : []),
    ]),
    "НУЖНО РЕШЕНИЕ", "№ / ID | Предложение | Кто делает | Ваш ответ",
    ...(rows.length ? rows : ["Подтверждённых оснований для изменения не найдено. Это не оценка «всё хорошо»."]),
    f.issues.some((x: any) => x.decision === "approved_dev") && !f.issues.some((x: any) => x.decision === "awaiting_owner")
      ? "По этим строкам решение уже получено. Следующий шаг — публикация владельцем и проверка эффекта."
      : perCallPolicy.reply, perCallPolicy.next];
}
