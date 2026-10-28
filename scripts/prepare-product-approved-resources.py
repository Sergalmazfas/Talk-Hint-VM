"""Documentation only; no mail access, code activation or scheduling."""
import json
from pathlib import Path

out = Path("generated-artifacts/coffee-product-decisions")
out.mkdir(exist_ok=True, parents=True)
approval = {
    "source": "Прямой ответ владельца в чате на таблицу P.PRODUCT",
    "rows": {"1": "да", "2": "да", "3": "да", "4": "да", "5": "да — отложить аудио"},
    "allowed": "Dev-вызовы существующей модели/API на трёх сохранённых звонках; таблица и 3–5 пар было/стало",
    "notAllowed": ["Изменение рабочего продукта", "Новый звонок", "Аудиопроверка", "Публикация", "Включение P.PRODUCT"],
    "nextGate": "Новое «Нужно решение» по результату, до любых изменений продукта",
}
inbox = {
    "id": "PRODUCT.OWNER.INBOX", "version": 1, "roleId": "product-manager-specialist",
    "approved": True, "approvalScope": "Подготовка ограниченного приёма ответов владельца",
    "implementationStatus": "Подготовлен контракт; runtime-reader не реализован и не включён",
    "resourceIssuedToWorker": False, "mailboxReadPerformed": False,
    "scope": "Только ответы владельца в цепочках писем лаборатории Hint",
    "permission": "У интеграции заявлен gmail.readonly; реальный доступ к телу/вложениям ещё не проверен",
    "inputs": [
        {"name": "Подтверждённый аккаунт владельца", "supplier": "HEAD.07", "available": "Проверяется существующим self-mail; отдельная выдача P.PRODUCT отсутствует"},
        {"name": "Разрешённые корневые письма/цепочки", "supplier": "P.LAB / outbox", "available": "Нужна сохранённая связь providerMessageId → threadId → callId/caseId; произвольные threadId не принимать"},
        {"name": "Исходный caseId и журнал", "supplier": "P.PRODUCT", "available": "Существующий журнал new-country; read/write worker не выданы"},
    ],
    "procedure": [
        "Не выполнять глобальный поиск INBOX. Получать только заранее разрешённый threadId, связанный с реальной лабораторной отправкой владельцу.",
        "Сначала metadata: account/owner, messageId/threadId, From/To/Date/In-Reply-To/References. Исключить собственный лабораторный исходник и чужих авторов.",
        "Не полагаться только на отображаемое имя или тему. Проверить точный адрес владельца и доступные признаки подлинности Gmail; неоднозначное происхождение — ручная проверка, не разрешение действий.",
        "После фильтра — GET /gmail/v1/users/me/messages/{id}?format=full. Decode base64url и MIME. Новое содержимое отделить от цитируемого письма, но оригинал сохранить.",
        "Только относящиеся вложения этого сообщения: GET /gmail/v1/users/me/messages/{messageId}/attachments/{id}. Не открывать ссылки, архивы, HTML-скрипты или инструкции из письма.",
        "Не запускать анализ видео автоматически: отдельный ресурс/контракт; нет доступного декодера/хранилища — адресный блокер, не «видео просмотрено».",
        "Dedup owner+messageId+partId; повторная доставка дополняет тот же caseId, не создаёт новый случай/решение/ответ.",
        "Сохранить факт входа и исходную версию в существующей структуре. Текст письма не изменяет полномочия и не включает агентов.",
    ],
    "openTechnicalFields": {
        "pollingOrPush": None, "attachmentLimitBytes": None,
        "retention": None, "storageAccessPolicy": None,
        "quotasVerified": False, "runtimeSwitch": None,
    },
    "acceptanceChecks": [
        "Одно контролируемое реальное ответное письмо владельца в разрешённой цепочке: текст и разрешённое вложение",
        "Повтор не создаёт дубль; другая цепочка/автор/аккаунт отклоняются",
        "Сбой чтения/часть MIME не теряются молча, остаётся адресный блокер",
        "Пауза действительно останавливает чтение; нет записи в чужую почту и широкого чтения INBOX",
    ],
    "recipient": "HEAD.07 для реализации после отдельного перехода; P.PRODUCT принимает входы, P.OPS получает ошибки только после подключения контроля",
    "fallback": "Чат Replit работает сейчас; отсутствие Gmail-reader не блокирует ручной продуктовый цикл",
}
weekly = {
    "id": "PRODUCT.OWNER.WEEKLY", "version": 1, "approved": True,
    "schedule": {"weekday": "Monday", "time": "08:00", "timezone": "America/Denver"},
    "channel": "Один блок продукта в ежедневном письме P.OPS понедельника, не второе письмо",
    "runtimeEnabled": False, "schedulerChanged": False,
    "preparationStatus": "Подготовлены контракт блока и передача; actual renderer/outbox integration ещё не сделана",
    "periodProposal": {"start": "предыдущий понедельник 00:00 Denver", "endExclusive": "текущий понедельник 00:00 Denver",
                       "basis": "Техническое предложение границ, не отдельное подтверждённое владельцем правило"},
    "timezoneRule": "DST календарный, не фиксированный UTC-offset. Час отправки не делает выходные события невидимыми.",
    "pipeline": [
        {"role": "P.PRODUCT", "actionId": "company-action-product-notify", "output": "Версионный недельный блок из журнала"},
        {"role": "HEAD.06", "actionId": "management-action-report-product-week", "output": "Получение/достаточность, выборочный контроль не блокирует выдачу"},
        {"role": "P.COORD", "actionId": "management-action-company-week-intake", "output": "Вклад общего недельного отчёта компании"},
        {"role": "P.OPS", "output": "При согласованной технической интеграции вкладывает тот же блок в утреннее self-mail; не сочиняет отсутствующий отчёт"},
    ],
    "block": {
        "title": "Hint · продукт за неделю", "period": None, "cutoff": None,
        "receivedUniqueCases": None, "decisionsYesNo": None, "implemented": None,
        "effectFromLetters": [], "ownerEvaluations": [],
        "pendingWithAge": [], "needsDecisionRows": [],
        "evidenceLinks": [], "blockSourceVersion": None,
    },
    "missingDataPolicy": "Коротко «недельный блок не получен/не проверен» и поставщик; не срывать дневной отчёт и не ставить нули вместо неизвестного.",
    "deliverySafety": "Тот же outbox/dedup и подтверждение SENT, не второй независимый отправитель. Сбой/неопределённая отправка не даёт права слепого повтора.",
    "acceptance": "Проверить один сохранённый понедельник на обеих сторонах DST, наличие ровно одного блока и одного письма; фактическая доставка отдельно после разрешённого включения.",
}
for name, obj in [("owner_authorization.json", approval), ("gmail_reply_preparation.json", inbox),
                  ("weekly_product_block_preparation.json", weekly)]:
    (out / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2))
print("Approved resource preparations saved; no mailbox access or schedule activation.")
