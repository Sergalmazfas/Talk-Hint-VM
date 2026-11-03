/** Only fixed public codes cross the owner HTTP boundary. Never expose provider
 * bodies, SQL messages, arbitrary exception text or credentials. */
const messages: Record<string, string> = {
  STALE_REVISION: "Состояние изменилось. Обновите страницу перед новым решением.",
  CREW_NOT_INITIALIZED: "Сначала инициализируйте AI Crew.",
  HINT_PILOT_REQUIRES_SEPARATE_OWNER_DECISION: "Контроль всё ещё привязан к серии Hint. Нужно отдельное решение владельца о завершении серии; закрытие карточки само по себе не снимает эту привязку.",
  OTHER_CREW_WORK_REQUIRES_OWNER_DECISION: "Есть очередь или расписание другого отдела. Нужен разбор этой очереди владельцем.",
  GLOBAL_LIMIT_CHANGE_REQUIRES_SEPARATE_OWNER_DECISION: "Общий дневной лимит уже включён с другим значением.",
  SECRETARY_MODELS_UNVERIFIED: "Не все модели отдела Секретаря подтверждены каталогом Anthropic.",
  SECRETARY_OWNER_CHARACTER_UNAVAILABLE: "Не удалось прочитать утверждённые характеры Севы, Лёвы и Томы.",
  SECRETARY_OWNER_MISMATCH: "Отдел привязан к другому владельцу.",
  MODEL_NOT_VERIFIED: "Модель не подтверждена каталогом Anthropic.",
  PILOT_MODELS_UNVERIFIED: "Модели пилота не подтверждены каталогом Anthropic.",
  ONE_PILOT_TASK_ONLY: "Уже есть открытая задача пилота.",
  PREPARE_REQUIRES_OFF_ZERO: "Подготовка требует выключенного контроля и нулевого лимита.",
  PILOT_CLOSE_UNSAFE_EXECUTION_OR_RESERVATION: "Закрытие запрещено: есть выполнение, unknown или резерв.",
  PILOT_NOT_STALLED: "Это не зависший пилот; его нельзя закрыть как невыполненный.",
  PILOT_CLOSE_REQUIRES_OFF: "Для закрытия сначала требуется OFF.",
  TASK_CLOSED: "Задача уже закрыта.",
  TASK_NOT_FOUND: "Задача не найдена.",
};
export function commandFailure(error: unknown, stage: "models" | "characters" | "evidence" | "command") {
  const raw = error instanceof Error ? error.message : "";
  const code = Object.hasOwn(messages, raw) ? raw :
    stage === "models" ? "MODEL_CATALOG_UNAVAILABLE" :
    stage === "characters" ? "SECRETARY_CHARACTERS_READ_UNAVAILABLE" :
    stage === "evidence" ? "HINT_EVIDENCE_UNAVAILABLE" : "COMMAND_RESULT_UNKNOWN";
  return { error: code, message: messages[code] ?? ({
    MODEL_CATALOG_UNAVAILABLE: "Каталог Anthropic недоступен; запись не выполнялась.",
    SECRETARY_CHARACTERS_READ_UNAVAILABLE: "Анкеты с характерами недоступны; запись не выполнялась.",
    HINT_EVIDENCE_UNAVAILABLE: "Данные Hint недоступны; запись не выполнялась.",
    COMMAND_RESULT_UNKNOWN: "Результат записи неизвестен. Обновите состояние; не повторяйте вслепую.",
  } as Record<string, string>)[code] };
}
