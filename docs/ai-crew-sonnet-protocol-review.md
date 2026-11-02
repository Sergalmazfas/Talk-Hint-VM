# Sonnet: HTTP 400, исправление протокола и новый пилот

## Подтверждённая ошибка

По разрешению владельца выполнен ровно один отдельный запрос к Anthropic Messages,
не перезапуск run. Источник — обезличенный evidence существующей production-задачи
`1f21a46d-a564-47d1-8989-16dab6702f36`, полученный read-only SELECT.
Те же system, pilotInput, max_tokens=2000, модель и thinking.disabled.
Запрос выполнен из Replit с проектным ANTHROPIC_API_KEY; его равенство production
ключу не проверялось и значение не извлекалось/не печаталось.

2026-11-02T01:13:45.286Z → HTTP **400**, request-id
`req_011CgdDPeNYNYaSdE2yfUBtF`, тип `invalid_request_error`:

> To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}. The model does not think before responding. The short updates it writes between tool calls come back as thinking blocks.

Хэш отправленного body SHA-256:
`e688390c305894f9740186484b63d2e62c23a1276261cdcd56308927f05a0f4b`.
Журнал attempt/response приложен, ключей/заголовков авторизации в нём нет.
Файл попытки создавался с O_EXCL; скрипт не может отправить второй запрос.
Новых model-запросов для «проверки исправления» до Publish не выполняли.
Исходный production unknown не переименовывается задним числом в HTTP 400.

## Исправление и официальная документация

https://platform.claude.com/docs/en/build-with-claude/thinking

- Sonnet 5.5: `thinking.type=between_tools`, effort=high (допустим high и ниже),
  без tools — нет предварительного reasoning.
- Opus 5.5: **не** between_tools — его API отвергает и disabled, и between_tools.
  `thinking.type=adaptive`, display=omitted, effort=low.
- Haiku не включается; его прежний протокол не менялся.
- Те же модели и утверждённые ставки: Sonnet $2/$10; Opus $4/$20 за 1M.
- По новому решению владельца: Паша max_tokens=2000, Фома max_tokens=4000.
  Это общий предел reasoning + видимого текста; usage.output_tokens учитывает оба.
  Резерв Фомы увеличен на $0.040: максимум output $0.080 вместо $0.040;
  вход резервируется отдельно. Общие лимиты денег и ставки не увеличены.
- Нет tools, дополнительных модельных конвертеров, fallback или автоповторов.
  Личности, system prompt и продуктовые промпты не менялись.

## Безопасный постоянный журнал

Каждый HTTP-ответ генерации, включая успех, отказ и поздний ответ, имеет отдельную
durable-запись anthropic_http_response: run/task/model, stage, category,
httpStatus, безопасный requestId. Она сохраняется до settlement, чтобы rollback
расчёта/проверки результата не потерял HTTP-диагностику.
Для сети/abort без ответа — httpStatus=null, requestId=null.
Тип ошибки — фиксированный enum, не error.message/body.
Сырые тела, ключи, заголовки авторизации, thinking blocks не пишутся в журнал.
При известном HTTP 400 бюджет/unknown автоматически не «возвращаются».

## Новая задача, не повтор

Старые run `fecfac6c-08ab-4da6-9513-8ee0e997b69f`, unknown, деньги и дневной
резерв сохраняются. Только при явной MCP prepare-команде после Publish разрешено
закрыть именно эту задачу как «не выполнено» и создать новый UUID.
Проверяются OFF/нет running, точные ID, прежний charged-event и сумма,
тот же grant, отсутствие proposal/review/documents. Другая unknown не обходится.
Операция выполняется на draft и в CrewStore transaction: ошибка моделей/evidence
не может частично закрыть старую задачу.

Одновременно один раз переносится в общий бюджет максимальный расход отдельной
диагностики: $0.036716, не подтверждённый invoice (ответ не содержал usage).
До нового пилота серия conservatively spent=$0.110148; старый unknown не
списывается второй раз. Этот перенос не вызывает API и не создаёт агента.
В журнале — исходные diagnostic UUID, время, request-id, HTTP 400 и hash.
Все изменения только в существующем JSON state; DDL/миграций нет.

## После одного Publish владельцем

1. tools/list + state: production, OFF, прежний действующий grant и бюджет.
2. Новая prepare: атомарно закрыть только утверждённый failed task, учесть
   отдельную диагностику один раз, создать новый latency task.
3. Enable → start: Паша Sonnet → независимый Фома Opus → автоматический OFF.
4. Проверить документы, verdict, модели, usage, HTTP metadata и стоимость.
   При error/unknown — STOP без повтора.
5. Владельцу короткий факт: ошибка/сработала ли цепочка. Успех mock-тестов не
   выдавать за production-результат. До Publish реальная цепочка не проверена.

Старый Secret/scope crew-test $5/7 дней пока остаётся; месячные бюджеты не входят
в этот точечный пакет. Катя, звонки, UI, активные публичные промпты не трогались.
Сам Publish и автоматический старт при нём не выполняются.

Полный прогон выявил существующий недетерминированный тест retellEnding:
запрещённая дата browser fixture совпала с реальным UTC-днём 2 ноября.
Исправлен только тест: контролируется Date, исходный запрет сохранён и отдельно
проверяется допустимый runtime timestamp. Код/поведение Кати не изменялись.
