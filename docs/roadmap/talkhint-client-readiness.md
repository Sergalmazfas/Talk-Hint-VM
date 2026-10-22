# TalkHint — единый roadmap клиентской готовности

Обновлено: 22 октября 2026. Основание: аудит политик/данных от 22 октября,
benchmark официальных документов и повторная проверка текущего кода.

## Правила исполнения и статусы

- Это **единая очередь работ в проекте**, а не десять новых задач в трекере.
  Номера ниже — номера этапов roadmap, не идентификаторы существующего трекера.
- Разрешена реализация **только №1 в Dev**. №2–10 сохранены в очереди и не
  запускаются автоматически. Завершение зависимости не является разрешением.
- Никакой публикации, внешних SMS/звонков, регистрации кампаний, покупки или
  переназначения номеров, изменения production/Twilio/provider account settings.
- Состояния: `DEV_IN_PROGRESS`, `DEV_VERIFIED`, `QUEUED_NOT_AUTHORIZED`,
  `OWNER_DECISION_REQUIRED`, `EXTERNAL_VERIFICATION_REQUIRED`.
  Dev-проверка не означает проверку production или настоящего ChatGPT/iPhone.
- Для каждого этапа отдельно фиксировать код, автоматические проверки,
  живые проверки, непроверенное и требуемое разрешение выпуска.
- Голосовая связь, аккаунты, номера, карточки, OAuth и разделение владельцев
  сохраняются. Запрет SMS/аудиозаписи не должен запрещать сам звонок.

## Подтверждённые решения владельца

1. Универсальный продукт для разных малых бизнесов. Бизнес-факты — только
   существующие явно разрешённые карточки; без отраслевых допущений и повторной
   бизнес-анкеты. Compliance evidence/KYC — не источник бизнес-фактов модели.
2. На старте SMS только сервисные; маркетинг не включать.
3. **12 месяцев для заявок НЕ утверждены. Отдельная постоянная CRM-база заявок
   НЕ нужна.** У TalkHint остаются транскрипт, итог/история звонка и необходимый
   статус доставки. Назначение и очистку существующих промежуточных intake,
   TEST, outbox и retry данных сначала установить по коду.
4. Календарные события и доставленные CRM-копии управляются владельцем или
   получателем. Удаление истории TalkHint **не отменяет событие и не удаляет
   CRM-копию автоматически**. Явные calendar cancel/delete — отдельные действия.
5. Ранее предложенные 30/90 дней и любые другие сроки — только предложения.
6. Юрлицо, адрес, контакты, ответственность, сроки и no-training не выдумывать.
7. Не добавлять Retell, внешнюю CRM как новый продукт, видео/рекламу.
   Benchmark/маркетинг — будущий внутренний раздел админки после базового продукта.

## Карта очереди

| № | Этап | Статус | Зависимости готовности |
|---|---|---|---|
| 1 | Карта готовности и безопасные ограничения коммуникаций | DEV_VERIFIED | Завершён в Dev; не опубликован |
| 2 | AI disclosure, запись/транскрипция, реальный отказ | QUEUED_NOT_AUTHORIZED | 1; тексты/правовая модель владельца |
| 3 | Провайдеры, обучение, хранение, регионы | QUEUED_NOT_AUTHORIZED | 1; может идти независимо от 2 после разрешения |
| 4 | Персональный Calendar end-to-end | QUEUED_NOT_AUTHORIZED | 1, 2, соответствующая часть 3 |
| 5 | Надёжный результат в разрешённый CRM/webhook | QUEUED_NOT_AUTHORIZED | 1, 3; формат результата 4 при calendar-действиях |
| 6 | Хранение, экспорт/удаление, отзыв интеграций | QUEUED_NOT_AUTHORIZED | 3; контракты данных 4–5 |
| 7 | Twilio ISV SMS readiness и suppression | QUEUED_NOT_AUTHORIZED | 1, 3, consent/cleanup-контракты 6; документы 8 |
| 8 | Реальные документы и процедуры | QUEUED_NOT_AUTHORIZED | 2–3, 6; проверенные границы 4–5/7 |
| 9 | Клиентский вход, карточка, голос, микрофонный тест | QUEUED_NOT_AUTHORIZED | 1–3; acceptance из 8; активация зависит от 4–7 |
| 10 | Web/iPhone/ChatGPT, уведомления, выпуск | QUEUED_NOT_AUTHORIZED | Принятые 1–9 и решения владельца |

№7 и №8 выполняются итерационно: черновики/инженерные проверки возможны до
регистрации, но регистрация/активация требует утверждённых документов и реального
opt-in. Это не циклический запрет на независимую разработку. Аналогично №9 может
иметь безопасный TEST без готовой телефонии/Calendar записи.

## №1. Карта готовности и ограничения коммуникаций

**Цель:** ни legacy, ни alert/recovery/retry не отправляют SMS или не запускают
диагностическую аудиозапись без проверяемых оснований.

**Исходное состояние:** два вызова Twilio `messages.create`; три recording
атрибута TwiML. Наличие credentials/номера и admin capability раньше было
достаточным для отдельных действий. Общего sender/consent/suppression authority
и participant recording-consent authority нет.

**Работа:**
- Весь фактический перечень ниже. Общий fail-closed gate с диагностикой без PII.
- До реализации подтверждаемого authority SMS запрещены: sender readiness,
  recipient/purpose SMS consent и suppression неизвестны.
- Новая диагностическая аудиозапись запрещена: consent участников, disclosure,
  назначение и retention неизвестны. Admin flag не является consent.
- Без env/client/admin bypass. Не создавать фиктивный реестр с заранее
  «одобренными» людьми. Не принимать proof из тела webhook/клиентского запроса.
- Readiness только для существующего администратора. Counters process-local,
  это не постоянная база заявок и не доказательство доставки.
- Callback исторической записи сохраняет metadata, но не запускает новый
  автоматический benchmark при неизвестном основании обработки.

**DoD:** hermetic проверки первого/повторного SMS, alert и recovery, отсутствия
вызова transport/client; diagnostic flag/global flag не включает запись;
TwiML Dial/Stream/ownership остаются; readiness закрыт гостям; нет секрета/номера
в новых diagnostic logs; TypeScript и регрессии проходят.

**Граница:** этот этап **не** реализует consent UI, STOP endpoint, provider
регистрацию, запись согласия или отказ от транскрипции. Не объявлять эти функции
готовыми. Никакие новые исходящие AI-звонки этим этапом не разрешаются.

### Инвентарь реальных путей и состояние после №1

| Путь | Реализация | Ограничение |
|---|---|---|
| Legacy SMS владельцу при входящем | `server/routes.ts`, `/twilio/voice`, `messages.create` | `sendSmsSafely(incoming_call_notification)`; неизвестны sender/consent/suppression → transport не вызывается |
| SMS write-health failure | `server/writeHealthAlerter.ts`, `trySendSms` | `sendSmsSafely(write_health_alert)`; credentials недостаточно |
| SMS recovery, cooldown/repeated poll | Тот же `trySendSms` через `sendWriteHealthAlert` | Тот же gate каждый раз; отдельного обходного SMS retry нет |
| Диагностический входящий, iOS conference | `server/routes.ts`, `/api/twilio/hold`, `record-from-start` | `recordingPermitted(incoming_conference)` до capability check → record отсутствует |
| Диагностический входящий, browser client | Там же, `record-from-answer-dual` | `recordingPermitted(incoming_browser)` → record отсутствует |
| Диагностический обычный исходящий | `/twilio/voice`, `record-from-answer-dual` | `recordingPermitted(outgoing_browser)` до capability check → record отсутствует |
| Поздний/повторный recording callback | `/twilio/recording-status` | Signature/metadata сохраняются; `recording_callback` gate запрещает auto-benchmark |
| Исходящий Secretary | `server/secretary/dialer.ts` | Уже `record:false`; не менять |
| Новый входящий AI, microphone TEST | `server/incomingSecretary` | Отдельная AI/текстовая обработка, не native recording; не считать решённым consent этапом №1 |
| AirAtoma webhook retry | `server/airatomaRetryWorker.ts`, `airatomaWebhook.ts` | Это HTTP delivery, не SMS/recording; не менять на этом этапе |
| Existing email/push alerts | `writeHealthAlerter.ts`, push services | Не SMS. Не менять и не считать согласием на SMS |

Найдено **2 transport sinks SMS**, **3 TwiML recording sinks**, без отдельного
REST `recordings.create`. Исторические ссылки/аудио, fixtures и данные не удалять.
Ручная обработка исторических данных — отдельная retention/vendor работа.

### Readiness №1

`GET /api/admin/communications/readiness` — существующая server-side admin
allowlist; no-store. `allowed:false`, явные reason codes, никакого публичного
consent API. Статус `transcriptionConsentImplemented:false` честно сохраняется.

## №2. AI disclosure и реальный отказ

**Сейчас:** входящий агент представляется виртуальным секретарём; нет общего
pre-consent состояния для всех phone/microphone веток. Старый silent diagnostic
policy не является допустимым основанием.

**Работа:** отдельно AI processing, transcript persistence и audio recording.
Согласие конкретной сессии/участников/цели/версии notice. EN/RU/ES понятные тексты.
Не передавать запрещённый контент в модель «до получения согласия». При отказе
не продолжать скрытую обработку. Предложить человека/альтернативный канал только
если реально настроен. Изменение состава участников требует политики.

**DoD:** consent/decline/timeout/обрыв/retry проверены без PSTN; аудио и
транскрипция не смешиваются; отказ не заявляет несуществующий human transfer;
cross-owner/replay consent не принимается; voice routing без запрещённой
обработки работает согласно реально доступному fallback.

**Owner:** утвердить AI/recording/transcription policy с юристом. Florida
§934.03, California §632, Washington §9.73.030 и федеральное §2511 не сводить
к универсальному one-party consent. Подтверждение владельца в ChatGPT не
заменяет право вызвать адресата AI-голосом.

## №3. Провайдеры и данные

**Сейчас:** Twilio; OpenAI Live и другие API; Deepgram в speech-ветках;
ElevenLabs/Cartesia TTS/clone варианты; hosting/DB; Google и ChatGPT;
дополнительные получатели только по фактической функции. Native Live имеет
`store:false`, но это не account-wide ZDR. Deepgram URL не содержит
`mip_opt_out=true`; account-level exemption не подтверждён.

**Работа:** перечень actual endpoint/model/режим, договорное юрлицо, регион,
категории данных, retention/backup, training opt-in/out, сотрудники/субпроцессоры,
DPA. Отдельно код, фактический кабинет и production. Не менять провайдерские
account settings без разрешения. Не обещать universal no-training.

**DoD:** для каждой активируемой цепочки заполнены проверенные поля или стоит
блокер; отсутствующий privacy setting запрещает соответствующее обещание/
активацию, не подменяет модель. Тесты не используют реальные клиентские данные.
Не публиковать voice IDs/секреты.

## №4. Сквозной персональный Calendar

**Сейчас:** owner-bound Calendar OAuth с encrypted refresh credential,
calendar list/free-busy; локальный disconnect. Отдельный admin Dev connector не
является календарём всех пользователей. Booking agent ещё не готов.

**Работа:** персональное отдельное разрешение; выбирать календарь записи,
учитывать личную/рабочую занятость только интервалами busy. Не показывать клиенту
названия/описания личных событий. Create/reschedule/cancel — явные операции,
только при реальных API successes. Карточка определяет график/услуги/правила,
недостающее уточняется, без фиксированного массажа/понедельника.

Проверка занятости сама по себе не атомарная бронь Google: нужны локальная
сериализация/конкурентный контроль, stable idempotency/event linkage и обработка
внешних изменений календаря. Нельзя обещать невозможную глобальную блокировку.

**DoD:** два одновременных запроса, повтор после timeout/неопределённого ответа,
перенос без двух событий, отмена только нужного события, DST/timezone, исправления
даты, конфликт с личной занятостью, отозванный доступ, чужой аккаунт. Ни одна
неуспешная операция не называется подтверждённой записью.

**Не делать:** удаление истории TalkHint не отменяет Calendar event.
**Owner:** какие календари учитываются, разрешённые действия/подтверждения.

## №5. Разрешённый CRM/webhook — только доставка результата

**Сейчас:** AirAtoma per-user delivery, durable transcript/outbox/retry,
SSRF-защита, trusted env-secret boundary. Есть существующая задача
«Prevent rare duplicate CRM sends when a call ends» (ref 111) — **переиспользовать,
не создавать дубль**. Связанные локальные планы:
`.local/tasks/talkhint-airatoma-webhook.md`, `.local/tasks/task-103.md`,
`.local/tasks/task-105.md` — исторический контекст, не доказательство текущего
статуса задач.

**Работа:** только разрешённый destination/минимальный результат, tenant binding,
stable delivery ID/idempotency, видимые pending/sent/failed/unknown, честный
ambiguous timeout, retry/backoff/dead-letter и ручной повтор без нового звонка.
Не разрабатывать собственную CRM и не добавлять нового CRM-поставщика.

**DoD:** обрыв до/после отправки, параллельные final callbacks, crash/restart,
destination revoked/changed, чужие URL/private network, unavailable receiver.
Для exactly-once нужен контракт идемпотентности получателя; без него указывать
границу гарантии, не заявлять недоказуемый exactly-once side effect.

**Граница:** delivered copy управляется получателем; удаление TalkHint не
удаляет CRM автоматически. Персональные данные в outbox минимизировать, сроки
согласовать в №6.

## №6. Наши данные, удаление/экспорт/отзыв

**Сейчас:** call transcript/history, secretary result, incoming intake/TEST,
delivery/outbox, contacts/cards, diagnostic fixtures. Есть отдельные deletes
cards/contacts/recording, не сквозной account lifecycle. Отзыв ChatGPT есть;
Calendar disconnect локальный, не автоматический client-wide Google revoke.

**Работа:** определить назначение каждого intermediate payload и его cleanup,
не закрепляя постоянную базу заявок. Сохранить нужные transcript/result/history
и delivery status. Матрица retention только после решения владельца.
Экспорт/удаление с проверкой identity, зависимых summaries/fixtures/provider
копий, backup tombstones/legal hold, revocation и suppression exceptions.

**DoD:** экспорт собственного аккаунта; чужой запрещён; частичная provider
ошибка видима; restore не возвращает удалённые данные/consent; disconnect не
выдаётся за удаление внешних копий; история удаляется без отмены Calendar/CRM.

**Owner:** сроки по категориям, backup, legal hold, обращения субъектов.
Сроки 12 месяцев, 30/90 дней **не приняты**.

## №7. Twilio SMS readiness (ISV, сервисные только)

**Сейчас:** карантин №1, нет canonical consent/suppression authority. Актуальные
Brand/Campaign/Trust Hub/TF approvals не подтверждены; прежнее одобрение другого
сайта/сценария не переносить автоматически и повторную регистрацию не требовать
без проверки.

**Работа:** сначала read-only проверка существующего состояния; tenant sender/
profile/brand/use case/service/number binding; transactional opt-in отдельно от
маркетинга и OTP. Durable versioned evidence, STOP/HELP/natural-language revoke,
queue cancellation, suppression перед transport и каждой retry, STOP не обходится
другим номером. Не давать одному tenant пользоваться согласием другого.
Credentials и запись телефона не являются readiness.

**DoD:** unverified sender/consent/suppression down → deny; opt-out между enqueue
и send/retry → deny; подтверждение STOP не дублирует Twilio; HELP не opt-in;
новое explicit consent сохраняет историю. Verify OTP не используется как
разрешение напоминаний или обязательное условие любой заявки.

**Внешние шаги:** регистрация/платные услуги/реальные проверки только после
отдельного согласования, финальных документов №8 и решений владельца.

## №8. Документы и реальные процедуры

**Сейчас:** Dev Privacy/Terms/Support — честные заглушки; production URL в аудите
возвращал старую HTML-оболочку, не готовые политики. Наличие HTTP 200 недостаточно.

**Набор:** Privacy, Terms, SMS program/consent/opt-out, AI recording/transcription
notice, Subprocessors, DPA с annexes при применимости, retention/deletion,
support/privacy contact, incident response, vendor review/access и complaints.

**DoD:** каждый claim сопоставлен с кодом/договором/тестом; нет выдуманных сроков,
no-training, контактов, pricing/approval; реальные публичные документы проверены
как документы, versioned acceptance раздельно по каналам; юридическая проверка
штатов и международных передач. Изменение политики не означает активацию SMS.

Неизвестные юридические данные блокируют финальное утверждение и выпуск, а не
независимые тесты/код в остальных этапах после разрешения.

## №9. Клиентский путь

**Сейчас:** публичный Dev draft; прежний полный web UI в owner-only `/admin`.
Нельзя открыть лаборатории каждому вошедшему. В публичном onboarding честно
указаны пробелы customer login/card tools/microphone adapter.

**Работа:** один аккаунт, отдельные permissions; существующая разрешённая
карточка голосом/текстом с review; фактический доступный голос и greeting; TEST
на тех же карточках/настройках, без звонков/SMS/броней. Нет новой анкеты/CRM.
Личный/рабочий/оба номера — существующий сценарий без переназначения реальных.
Независимый browser TEST не требует номера.

**DoD:** ordinary customer не получает admin; cross-owner/card доступа нет;
исправление/повтор TEST, закрытие микрофона/сессии, одна тестовая сессия без
дубликатов; Google sign-in не выдаётся за Calendar/Gmail consent; реальная
активация номера — отдельное действие. Не обещать free ChatGPT eligibility.

## №10. Сквозная проверка и выпуск

**Работа:** web/iPhone/ChatGPT целиком: вход/refresh/revoke, карточка подтверждения,
точные номер/цель/model, один start, восстановление task_id без redial, статусы/
итог/разрешённый transcript/audio, Calendar/delivery и notifications. Native
сборка отдельно от backend publish. Отказ хоста в widget/audio показан честно.

**DoD:** автоматические тесты, staging/Dev integration и отдельно реальный
ChatGPT web/iPhone evidence. APNs/почта/SMS не называются доставленными без
факта. Контролируемые звонки/SMS только с отдельным согласием; подготовлен
release checklist, review блокеров, rollback/monitoring. Production publish
выполняется только после отдельного разрешения владельца.

**Существующие проверки — без новых дублей:** refs 10 (rejected/timeouts),
11 (Twilio forgery), 112 (short-call/crash transcript), 100 (save-alert readiness),
97 (schema startup), 260/368 (native build/minimum iOS). Статусы из снимка
`PROPOSED` не считать текущим прогрессом; перед работой сверить трекер.

## Нерешённые вопросы владельца — отдельный список

| Решение | Что блокирует | Что не блокирует |
|---|---|---|
| Юрлицо, адрес, support/privacy контакты | Финальные документы, регистрации, выпуск | Карантин и hermetic тесты |
| AI/disclosure/recording/decline правовая модель | Активация обработки/записи | Разработка fail-closed состояний |
| Сроки каждой категории, backup/legal hold | Очистка/финальные обещания | Инвентаризация/проектирование экспорта |
| Provider plans, regions, training controls/DPA | No-training обещания/privacy activation | Read-only vendor assessment |
| Calendar назначения/правила действий | Реальное booking включение | Mocked calendar concurrency tests |
| Разрешённые destinations/схема результата | Реальная отправка CRM | Local idempotency/failure tests |
| Ответственность, billing/cancellation/porting | Terms/release | Независимая Dev-разработка |
| Outbound AI use cases/consent | Реальные исходящие клиентские звонки | Проверки без PSTN |

## Benchmark: применённые решения, не копии документов

Все ссылки — из аудита 22 октября; перед финальным утверждением перепроверить.

- HighLevel: controller/processor separation, DPA/subprocessor change process,
  доказательный outbound consent. [Privacy](https://www.gohighlevel.com/privacy-policy)
  (July 2026), [DPA](https://www.gohighlevel.com/data-processing-agreement)
  (July 2026), [Terms](https://www.gohighlevel.com/terms-of-service) (June 2026),
  [Subprocessors](https://www.gohighlevel.com/sub-processors). Применение №2/3/7/8.
- Smith.ai: SMS evidence/no marketing transfer; [Privacy](https://smith.ai/privacy)
  (29 Sep 2026), [Terms](https://smith.ai/terms-and-conditions),
  [recording/transcription](https://smith.ai/features/call-recording-transcription):
  описанные 90 дней — **не срок TalkHint**. Применение №2/6/8.
  Полный актуальный DPA/subprocessor register в аудите не подтверждён.
- Goodcall: [Privacy](https://help.goodcall.com/en/articles/8007565-privacy),
  [Terms](https://help.goodcall.com/en/articles/8007566-terms-of-service)
  (28 Sep 2024), [subprocessors](https://trust.goodcall.com/subprocessors),
  [notice](https://help.goodcall.com/en/articles/8007564-goodcall-s-call-recording-notification).
  Не копировать training license; notice help имеет исторические оговорки.
  Полный публичный DPA не подтверждён. Применение №2/3/8.
- Retell: [Privacy](https://www.retellai.com/legal/privacy-policy) (20 Jul 2026),
  [Terms](https://www.retellai.com/terms-of-service) (7 Oct 2026),
  [retention](https://docs.retellai.com/accounts/data-retention),
  [DPA/security](https://docs.retellai.com/general/compliance),
  [subprocessors](https://trust.retellai.com/subprocessors):
  не повторять indefinite default/no-training без plan proof. Их пять лет consent
  evidence — не автоматически наше правило. Retell не интегрировать. №3/6/8.
- ElevenLabs: [Privacy](https://elevenlabs.io/privacy-policy),
  [Terms](https://elevenlabs.io/terms-of-use) (9 Oct 2026),
  [DPA](https://elevenlabs.io/dpa) (8 Apr 2026),
  [subprocessors](https://compliance.elevenlabs.io/subprocessors).
  Различать self-serve/Enterprise и ElevenAgents/direct TTS. №3/6/8.
- Twilio: [Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy)
  (13 Apr 2026), [ISV](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv),
  [opt-out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out),
  [recordings](https://www.twilio.com/docs/voice/recordings). №1/2/7/8.

## Проверка №1 и выпуск

Проверено 22 октября 2026:

- `npm run check -- --pretty false` — PASS.
- `npm test` — 151 test files passed, 1 skipped; 1794 tests passed,
  9 skipped. Это автоматические проверки, не звонки и не живое consent UX.
- `npm run build:prepare` — PASS: client/server build и MCP runtime inclusion.
  Offline prepare, без production boot, live Tutor probe или публикации.
  Остались необязательные предупреждения размера JS bundle/возраста browser data.
- Dev workflow штатно перезапущен; сервер слушает 5000, DB schema без drift.
  Existing startup provision проверил существующее назначение, не назначил номер.
- HTTP в текущем Dev: `/` → 200; readiness без входа → 401.
  Mocked identity tests: ordinary user → 403, existing admin → 200/no-store.
  Настоящий Google sign-in владельца в этой задаче не выполнялся.
- Screenshot публичной страницы: загружается, прежний Dev интерфейс не сломан.
- Dev MCP и OAuth discovery сейчас → **503** с сообщением
  `ChatGPT integration is disabled or not configured`.
  Проверена существующая ветка `server/chatgpt/routes.ts`: её конфигурация и
  код не менялись. Это ограничение текущего Dev, не доказательство исправности
  OAuth и не вывод о production. Сам OAuth/refresh flow здесь не тестировался.
- Существующие deployment logs отдельно показывают ошибку настройки ordinary
  APNs alert certificate; в этой задаче она не исправлялась. Доставка push не
  подтверждена и остаётся проверкой №10; SMS не используется как обход.
- `git diff --check` — PASS. Новые reason logs не содержат адресатов, текста,
  токенов или call identifiers.

Важно: существующие cooldown/recovery unit tests используют **тестовый**
mock-approved transport; отдельные тесты настоящего gate и alerter проверяют,
что в Dev ни client construction, ни отправка SMS не происходят. Это не
существующий production-механизм выдачи согласия.

Ни внешних SMS/звонков, ни provider account changes, ни публикации в этой задаче.
Production этой реализацией не менялся и его readiness не подтверждался.
Никакая строка этого roadmap не является одобрением публикации/активации.
№2–10 остаются `QUEUED_NOT_AUTHORIZED`.
