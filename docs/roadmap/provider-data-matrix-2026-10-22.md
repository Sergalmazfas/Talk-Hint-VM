# TalkHint — провайдеры, обучение, хранение и регионы

**Этап №3 единого roadmap. Проверено: 22 октября 2026.**
**Статус: EXTERNAL_VERIFICATION_REQUIRED.**

Исследование кода и первичных документов завершено. Закрытые настройки аккаунтов,
договорные исключения, фактические регионы и backup-политики проекта подтверждены
не полностью. Это **не разрешение на выпуск и не сертификат no-training/ZDR**.
Никакие исправления, переключения моделей, настройки провайдеров, активации,
отправки, звонки или публикации в рамках исследования не выполнялись.

## 1. Как читать доказательства

- **C — code:** факт текущих исходников, с указанием файла/символа. Условная
  ветка не означает, что её вызвали в production.
- **D — document:** актуально доступный официальный документ; условия могут
  зависеть от плана/договора. Ссылки и даты проверки — в §9.
- **A — account:** реально проверенная закрытая настройка конкретного аккаунта.
  Если нет доступа/подходящего read-only инструмента, явно указано «не проверено».
- **U — unknown:** установить из кода/доступных документов невозможно.

**Важные границы:** training, application state, abuse/security logs, billing
metadata, backups, voice clone assets и данные, сохранённые самим TalkHint, —
разные категории. Один `store:false` не управляет ими всеми. Место inference,
постоянного хранения, TLS termination и доступа поддержки тоже не одно и то же.
Здесь не объявляются утверждёнными сроки хранения TalkHint.

### Что удалось проверить из закрытого состояния

- Read-only `getDeploymentInfo`: опубликованный публичный Reserved VM,
  текущий build помечен successful, primary URL `https://talkhint.app`.
  Этот инструмент **не вернул регион, retention/backup window, план, DPA,
  commit/build fingerprint или provider privacy settings**.
- Следовательно, он не доказывает совпадение опубликованного кода с текущими
  исходниками или публикацию ограничений этапа №1.
- Twilio MCP в этой среде предоставляет **поиск/чтение документации и API-схем**,
  не выполнение authenticated account requests. Проверка его доступных операций
  не дала доступа к Console retention/regions/privacy settings.
- Google Calendar подключён к workspace по имеющемуся connection setup. Это
  не подтверждение персонального Calendar OAuth всех пользователей, типа
  Google-аккаунта, Workspace data-region policy или подписанного DPA.
- Административные панели OpenAI, Deepgram, ElevenLabs, Cartesia, Stripe,
  Apple Developer и договоры владельца не доступны через предоставленные
  инструменты этого исследования. Secrets не читались, не экспортировались
  и не использовались для самодельного доступа к панелям.
- Данные клиентов, реальные voice IDs, содержимое календарей, raw URLs
  получателей, записи/транскрипты и credentials не извлекались.

## 2. Фактическая карта цепочек по коду

Значения ниже — literal/default в коде, **не прочитанные production env
overrides и не новый тест доступности модели в аккаунте**.

| ID | Назначение и фактический endpoint/модель | Какие данные уходят | Основание и состояние |
|---|---|---|---|
| T01 | Twilio Programmable Voice SDK/REST `api.twilio.com/2010-04-01`; TwiML, Conference, Media Streams в WebSocket TalkHint | Номера обеих сторон, идентификаторы/статусы/длительность, звук обеих сторон; для разрешённых операций metadata | C: `server/routes.ts`, `secretary/dialer.ts`, `twilioService.ts`. SDK создаётся без явного `region`/`edge` в проверенных call paths. Это не доказательство физической обработки всех данных в США |
| T02 | Прямой Secretary OpenAI: `wss://api.openai.com/v1/live/sessions`, **`gpt-live-1`**, built-in voice `marin`; delegation `responses` → **`gpt-6.1-sol`**, effort medium; верхнеуровневый `store:false` | Live PCM μ-law, реплики/коррекции, инструкции, поручение и разрешённый контекст; backend tools/их результаты | C: `incomingSecretary/liveAudio.ts: liveConfig/LiveAudio`; входящий `runtime.ts: handleIncomingSocket` → `livePhone`; исходящий `secretary/agent.ts: defaultRealtimeFactory` → `secretary/liveAudio.ts`. Противоречащий старый комментарий «Never used by telephony» в liveAudio не является доказательством — проверены реальные вызывающие ветки |
| T03 | Сохранённые ElevenLabs/Cartesia варианты Secretary: `wss://api.openai.com/v1/realtime?model=…`, default **`gpt-realtime`**, override `SECRETARY_REALTIME_MODEL`; input transcription **`gpt-4o-mini-transcribe`**; затем отдельный TTS | Входящий звук, распознанный текст/контекст/поручение; текст ответа отдельно передаётся TTS-провайдеру | C: `secretary/agent.ts: OpenAISecretaryRealtimeSession`, `translation/cloneSpeech.ts`. Это OpenAI conversation + direct TTS, **не ElevenAgents и не Cartesia Managed Agents** |
| T04 | Сохранённые Realtime стенды/adapters: `/v1/realtime`, **`gpt-realtime-2.1`**/`marin`; у legacy native Secretary transcription с `language:"en"`; у старого incoming adapter свой `audio.ts` | Голос/текст теста и контекст | C: `secretary/nativeAudio.ts`, `secretaryLab/openAIRealtime.ts`, `incomingSecretary/audio.ts`. Не подменять ими текущий основной Live runtime; наличие файла не доказывает активный пользовательский маршрут |
| T05 | Translator: `/v1/realtime`, default **`gpt-realtime`** (`TRANSLATOR_SPIKE_MODEL` override); отдельный adapter `/v1/realtime/translations?model=gpt-realtime-translate`; текстовые subtitles `/v1/chat/completions`, default **`gpt-4.1-mini`** | Речь для перевода, язык, переведённые фразы; при clone playback — текст в ElevenLabs/Cartesia | C: `translation/twilioBridge.ts`, `openaiRealtimeTranslator.ts`, `openaiRealtimeTranslateAdapter.ts`, `textSubtitle.ts`. Выбор актуального adapter зависит от режима. План RU/ES↔EN не означает, что все комбинации уже проверены |
| T06 | Live hints/подготовка/итоги/учебные и лабораторные API: `api.openai.com/v1/chat/completions`, `/responses`, `/audio/transcriptions`; default hint **`gpt-5.6-terra`**, PREPARE **`gpt-5.6-sol`** via Responses, вспомогательные **`gpt-4o-mini`**, STT **`gpt-4o-transcribe`**; benchmark выбирает candidate | Транскрипт, карточки/цель, контакты/факты при соответствующем действии, текст summary/judge; аудио STT/fixture в стенде | C: `websocket.ts`, `prepare.ts`, `routes.ts`, `training.ts`, `voiceLab/providers.ts`, `benchmark/{candidates,earsHarness,brainHarness}.ts`. Нельзя распространять `store:false` Live на все эти вызовы: отдельные Responses requests не задают его |
| T07 | Основной STT Deepgram `wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=mulaw&sample_rate=8000&eot_threshold=0.7&eot_timeout_ms=3000`; benchmarks v2 Flux EN/multi и v1 **`nova-3`** | Телефонный звук каждой дорожки; timing/endpoint events; в offline bench аудиофикстуры | C: `websocket.ts` основной dgUrl; `benchmark/candidates.ts`, `earsHarness.ts`. В основном dgUrl **нет `mip_opt_out=true`**. Это English STT конкретной ветки, не доказательство принудительного English в native Live |
| T08 | ElevenLabs direct TTS `https://api.elevenlabs.io/v1/text-to-speech/{voice}/stream?output_format=…`, **`eleven_multilingual_v2`**; clone `/v1/voices/add`, проверка `/v1/voices/{voice}` | Текст озвучки, выбранный voice reference, при клонировании — отдельно предоставленный образец голоса/метаданные | C: `translation/cloneSpeech.ts`, `voiceLab/providers.ts`, `voiceLab/routes.ts`. **Нет `enable_logging=false`** в проверенных direct TTS URL. Пользовательский clone ID в отчёт не включён |
| T09 | Cartesia direct TTS `https://api.cartesia.ai/tts/bytes`, **`sonic-3.6`**; clone `/voices/clone`, проверка `/voices/{voice}` | Текст, язык/формат, voice reference; при clone — образец голоса | C: те же cloneSpeech/providers/routes. Глобальный endpoint; dedicated region в этих вызовах не задан. Это не Managed Agents |
| T10 | Replit VM + PostgreSQL (`pg`, Drizzle); production предпочитает `PROD_DATABASE_URL`, иначе `DATABASE_URL` | Все наши персистентные категории из §3, application logs; секреты управляются отдельно | C: `db.ts`, `shared/schema.ts`, storage modules. Адрес/credentials не извлекались. **Managed vs external production DB не установлен этой проверкой**, код допускает оба |
| T11 | Google sign-in: существующий Replit OIDC login, провайдер Google выбирается в существующем входе; не Calendar API | Identity claims (идентификатор, имя/email/avatar по возвращённым claims), session | C: `replit_integrations/auth` и auth middleware. OAuth-вход не является Calendar/Gmail/SMS/recording consent |
| T12 | Персональный Calendar: `accounts.google.com/o/oauth2/v2/auth`, `oauth2.googleapis.com/token`, `www.googleapis.com/calendar/v3/users/me/calendarList`, `/freeBusy`. Scopes **calendarlist.readonly + calendar.events.freebusy** | OAuth grant/refresh, списки календарей для владельца, временные интервалы busy | C: `incomingSecretary/ownerCalendar.ts`, `ownerCalendarStore.ts`. Vault AES-256-GCM owner/profile bound; local disconnect не доказывает глобальное Google revoke. Это пока **не create/reschedule/cancel** |
| T13 | Отдельный admin/Dev Calendar путь: Replit Google Calendar connector → `www.googleapis.com/calendar/v3/...` | Выбранный календарь, запросы тестовой записи/занятости по этому сценарию | C: `incomingSecretary/workCalendar.ts`, `calendarRoutes.ts`. Workspace connector может иметь широкие scopes, но это не полномочия других владельцев. Его приватный account type/DPA/region не проверены |
| T14 | ChatGPT MCP/OAuth: TalkHint `/api/chatgpt/mcp`, инструменты/ресурс карточки/monitor | Параметры поручения, профиль/статус/результат; transcript/listen — отдельные разрешения; результаты становятся контекстом чата | C: `chatgpt/{routes,tools,secretary,monitor,security,releaseConfig}.ts`. Base grant `calls:read offline_access`; дополнительные scopes не выводятся из Google login. ChatGPT host — **отдельная** обработка, не OpenAI API policy |
| T15 | AirAtoma / owner-specified webhook, HTTPS/HTTP POST на configured destination | `callId`, полный `transcript`, `callerName`, `durationSecs`, optional `recordingUrl` | C: `airatomaWebhook.ts: AirAtomaPayload/post`, retry worker/storage. Реальный destination задаётся секретом/профилем; **юридический получатель, регионы, storage/training не подтверждены**. Название адаптера не доказывает одного получателя у всех |
| T16 | Apple APNs обычные alert и отдельные VoIP push через `@parse/node-apn`; отдельный browser Web Push transport | Device token/topic, notification payload (минимальный текст/тип/task/request/call identifiers в зависимости от ветки), адрес доставки | C: `secretary/notifications.ts`, push services. У report alert `expiry` около часа, generic alert, payload-ссылка на результат, не весь transcript. VoIP — отдельные credentials/назначение. Фактическая доставка не проверялась |
| T17 | Stripe SDK → Stripe API, customer/Checkout/portal/subscription | Email/customer reference, userId metadata, product/price/subscription IDs, суммы/события платежа | C: `stripeClient.ts`, `stripeService.ts`, соответствующие routes/webhook. Payment UI обрабатывает карточные данные через Stripe; нет основания обещать отсутствие любых финансовых данных у нас. Test/live режим аккаунта не установлен |
| T18 | Опциональный Google Gemini hints: `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`; selectable **`gemini-2.5-flash-lite` / `gemini-2.5-flash`** | Текст контекста/цели/разрешённых карточек и реплик | C: `websocket.ts` Gemini branch, `hintProvider.ts`. Это отдельный Google AI API, не Calendar и не OpenAI. Включение и paid entitlement в текущем production не доказаны |
| T19 | Отдельный Tutor Engine, default `https://ai-tutor-engine.replit.app` (`TUTOR_ENGINE_BASE` override), engine session/WS/asset API | Учебный профиль/контекст, goal/memory, речь/реплики учебной сессии | C: `tutorEngine.ts`, `tutorTranslate.ts`, tutor routes. Не телефонный Secretary; оставить изолированным. Кто оператор engine и какие его downstream vendors/privacy contracts — U |
| T20 | Техническая почта SendGrid `api.sendgrid.com/v3/mail/send`; browser push; внешние assets/CDN в Tutor | Write-health failure/recovery по opt-in env recipients; технический error text. CDN получает сетевые metadata, не следует автоматически считать, что получает transcript | C: `writeHealthAlerter.ts`, `pushService.ts`, `tutorAvatarPage.ts`. Наличие кода не доказывает включённый email. Gmail-уведомления владельцу этим не реализованы |

**Retell:** рабочей runtime-интеграции в проверенном серверном коде не найдено.
Исследованный вариант не подключён и не добавляется. Copilot остаётся в
существующем коде, но исключён из плана клиентской версии; его текущие
provider/data paths не скрываются этим решением.

## 3. Что сохраняет сам TalkHint

| Категория | Что подтверждено C | Чего нельзя обещать |
|---|---|---|
| Аккаунты/вход/номера | users, sessions/grants, owner-bound назначения и профили | Нет проверенного единого срока для account/session/audit/backup; identity-provider retention отдельно |
| Карточки/контакты/цель | Существующие карточки/контакты; цель в соответствующих call/task payloads; разрешённый контекст для агента | Общая карточка не является разрешением раскрывать её звонящему; no-training не следует из owner isolation |
| История/транскрипт/summary | calls transcript/metadata, Secretary tasks/results; live text/timing logs в отдельных ветках | Отключение Twilio recording не отключает STT, Live audio processing, transcript и logs |
| Incoming intake/TEST/outbox | JSON payloads в PostgreSQL, тестовые результаты отделены; durable delivery/retry | Это существующие промежуточные данные, **не новый разрешённый CRM**; назначение/cleanup ещё предстоит определить в №6 |
| Diagnostic audio | Исторические Twilio recording references; frozen fixture `audioBase64` в benchmark DB | №1 блокирует новые native diagnostic recordings и automatic benchmark callback. **Историческое аудио не удалено**, сроки/полное удаление зависимых fixtures не утверждены |
| Потоковое аудио | Live/Realtime/TTS буферы/очереди в RAM; provider assets при клонировании; различные browser caches | RAM buffering не означает, что провайдер не хранит данные. Полное стирание browser caches/системных буферов/backup не доказано |
| Calendar/OAuth | Encrypted personal Calendar refresh grant + выбранный календарь; state/PKCE attempts с expiry; MCP grants/task linkage | Expiry попытки входа не равен общей очистке старых строк; disconnect не удаляет events/provider copy |
| Доставка/уведомления/платежи | Outbox delivery status и attempts/errors, push device tokens, customer/subscription references | Эти категории могут содержать PII; нельзя обещать «у нас только обезличенный итог» |
| Logs/backups | Серверные logs существуют; отдельные legacy logs включают call metadata, ошибки/реплики | Глобального log-redaction/retention/deletion/SIEM договора в этой проверке не установлено. Нельзя переносить отсутствие PII в **новых safety logs №1** на все старые логи |

Персистентное аудио звонка в App Storage в проверенных путях не найдено: native
audio у Twilio и fixture copies в DB — разные места. Это не доказательство
отсутствия всех файлов/backup вне просмотренных веток.

Сроки TalkHint **12 месяцев, 30/90 дней не утверждены**. Удаление нашей истории
не отменяет Calendar event и не удаляет доставленную CRM-копию автоматически.

## 4. Матрица внешних гарантий и неизвестных

Каждая строка относится только к соответствующему продукту провайдера.
«Backup U» означает: срок, deletion lag и применимость конкретного договора
не подтверждены для нашего аккаунта, а не «backup отсутствует».

| Провайдер/продукт | Обучение и хранение по D | Регион и backups | DPA/subprocessors, план и что остаётся U |
|---|---|---|---|
| **Twilio Voice/SMS** | DPA различает customer content/usage и допускает обработку/внутреннее улучшение моделей для service-abuse prevention. Общий запрет любого training обещать нельзя. Content до удаления/customer instructions; recording deletion не равно мгновенному стиранию всей metadata | В коде нет подтверждённой regional routing policy. DPA Schedule 1 описывает **после termination**, не общий TTL: content deletion через 30 дней, backup через 60, исключения по закону; SendGrid отдельно. Recording API указывает 40 дней для soft-deleted recording metadata. **Не наши утверждённые сроки** | DPA 9 Apr 2026, subprocessors Sep 2026 [S01–03]. U: Console regions/recording settings, применимый договор, текущие historical audio/logs, account retention overrides. Не считать всех перечисленных Twilio subprocessors получателями каждого звонка |
| **OpenAI API Live + delegated Responses** | API customer content не используется для training по умолчанию; добровольное sharing/договор/endpoint exceptions проверить. Live `store:false` не сохраняет completed session recording как application state, но **не отменяет abuse logs** (default up to 30 days с исключениями). У delegated backend свои controls; top-level Live flag не доказательство их наследования | Global `api.openai.com`, без регионального prefix. Docs поддерживают US/EU Live и eligible модели/эндпоинты, но требуется соответствующая project/account конфигурация; support by model. Backup отдельного аккаунта U | [S04–06]. DPA effective 1 Jan 2026; subprocessors updated 14 Oct 2026. U: project/organization ZDR/MAM, sharing opt-ins, residency, training exceptions; delegated backend application state. В docs у Live нет public stored-session deletion endpoint |
| **Другие OpenAI API** | Realtime table: no application state, стандартные abuse controls. Chat completions: exceptions для audio outputs/cache. Responses default application-state retention по docs — 30 дней; `store:false` не задан во всех наших request builders. Audio transcription table отдельно: no abuse/application state retention, но не распространять это на Realtime/Live/TTS | Global endpoint не доказывает выбранный регион. ZDR не универсально для всех функций/моделей; model-specific prompt-cache lifetime тоже учитывать. Backup U | Существующий план/API availability не равно approval ZDR. Проверить endpoint-level controls и перечень моделей. Даже при ZDR нельзя обещать «вообще нет metadata/security exceptions» [S04–06] |
| **Deepgram STT** | **MIP default ON**, retained content может участвовать в model improvement; у нашего основного dgUrl flag отсутствует. `mip_opt_out=true` исключает запрос из MIP и по docs даёт content ZDR после ответа; usage/metadata остаются отдельно. Account-level enforcement возможно, но **не проверено** | `api.deepgram.com` global. Полностью in-region требует regional endpoint **и** opt-out. Нельзя считать global endpoint доказанным US-only. При retained MIP data обработка для improvement может быть вне региона. Backup/delete guarantee аккаунта U | [S07–10]. DPA/ограничивающий договор требуется получить/проверить; subprocessors list найден. Список также упоминает comparative benchmarking с third-party speech providers; opt-out/DPA важны. Не утверждать, что именно наш материал уже использован для training |
| **ElevenLabs direct TTS / clone** | Default retention по Privacy; Enterprise no-training default кроме необходимого для оказания услуги; self-serve может отключить “Improve the models for everyone”, действует на новые данные. **ZRM — отдельная возможность eligible Enterprise + `enable_logging=false` на eligible endpoint**. В наших TTS URL flag отсутствует. Clone samples/models — отдельные сохранённые assets, не простой TTS request | Global `api.elevenlabs.io` не подтверждает region. Subprocessor list: non-Enterprise может обрабатываться US/EU/Singapore; Enterprise selected hosting зависит от договора/availability. Privacy говорит о transfer в US; нельзя обещать blanket EU-only на основании endpoint. Backup U | [S11–15]. DPA 8 Apr 2026; Privacy 9 Oct 2026. U: план, opt-out timestamp, ZRM eligibility и enforcement, clone ownership/retention/deletion, selected hosting |
| **ElevenAgents** | Отдельные agent settings для audio/transcript, configurable retention, unlimited `-1`. Эти настройки **не регулируют наши direct TTS вызовы** | Не считать dashboard Agents retention установленным для clone/TTS или OpenAI backend | Официальная Agents документация [S16] — сравнение границ, не используемый TalkHint product и не предложение миграции |
| **Cartesia TTS / clone** | Terms допускают training Inputs/Outputs/interactions, если не согласовано иначе. Training opt-out — отдельный обработанный запрос для будущих данных. **ZDR доступен Enterprise, включается админом org**, применяется к eligible TTS/STT без per-request flag. DPA §13 отдельно позволяет необходимые отдельно предоставленные clone samples | Global endpoint closest routing, не pinned region. Dedicated regional deployments — Enterprise; ZDR отдельно от regional endpoint. Backup U; clone sample exception сохраняется даже с ZDR | [S17–21]. U: план/org ZDR toggle, обработанный training opt-out, contract exception, dedicated endpoint и применимость DPA. Отсутствие per-request flag здесь **не равно** отсутствию ZDR — в отличие от Eleven TTS механизма |
| **Replit VM/managed DB или external DB** | Собственные данные/логи/бэкапы — не inference-provider ZDR. Replit model-improvement policy касается контента, предоставленного Replit Agent; нельзя автоматически объявлять ею использование каждого phone payload для training, но нельзя и давать общий no-training на workspace content | Docs: publishing geography выбирается, artifacts/managed DB/storage colocated; workspace geography отдельная. Actual selected geography U. Managed DB Core до 7 дней restore, Pro/Enterprise до 28 (7 default), scheduled backups отдельны; **наш план/window не прочитан**. External `PROD_DATABASE_URL` требует отдельной проверки | [S22–26]. DPA 1 Apr 2026, commercial applicability проверить. Subprocessors Aug 2026. Pro opt-out model improvement, Enterprise no-training по docs — account opt-out U. Нельзя считать docs-лимиты реальной backup config |
| **Google sign-in/Calendar** | Identity и Calendar — разные services/permissions. Google API User Data Policy требует раскрытия доступа/использования, Limited Use для применимых scope/use cases. Это обязательства **нас**, не универсальный no-training договор всех Google services | Consumer vs Workspace, Workspace edition/data regions и retention различаются; account type/region U. Google Privacy допускает global processing и разные сроки. Нельзя переносить Google Cloud/Workspace DPA на consumer Calendar автоматически | [S27–30]. У персонального Calendar только read-only/freebusy grants. U: issuer account/edition, действующий договор/DPA, region policy/backups; connector authorization не доказывает их для всех клиентов |
| **ChatGPT host** | Business/Enterprise/Edu: connected apps data не используются для training default. Free/Plus/Go/Pro: могут использоваться при ON “Improve the model for everyone”. Это **не** API policy. MCP result/transcript может стать chat context/memory | Обычные/архивные chats остаются до удаления/Workspace policy; delete scheduled within 30 days с security/legal/deidentified exceptions. Disconnect TalkHint не удаляет chat. Account plan/retention/region U | [S31–32], Business DPA/S06 применимость по продукту и договору; consumer Terms/Privacy отдельно. Видимость widget/audio/доступность host — не основание заявлять no-training |
| **AirAtoma / custom webhook recipient** | Мы видим payload и delivery queue, не юридическую политику получателя. Их training/retention **U**, любой blanket no-training недопустим | Region/backups/U; upstream deletion не удаляет внешнюю копию. Raw destination/PII не извлекались | Потребуется allowlisted approved recipient, identity/DPA/subprocessor/region/retention подтверждение отдельно для каждого фактически разрешённого destination. Название интеграции недостаточно |
| **Apple APNs** | Notification processing, не разговорная модель TalkHint. Docs: APNs может хранить undelivered notification до 30 дней или меньше по `apns-expiration`; `0` — без store, но попытка может иметь network retries. Это не TTL нашей DB device token | В коде report expiry около часа; не утверждать нулевую задержку удаления/US-only. Backup/provider logs U. Не посылали тестовый push | [S33–35]. Apple Developer Program Agreement/Privacy, **применимый APNs-specific DPA/subprocessor schedule не подтверждён**. U: accepted version/account agreements/certificates, точная privacy applicability. Не заявлять alert delivery успешной |
| **Stripe** | Transaction/fraud/legal data; processor и controller роли различаются. Нельзя переносить no-training генеративного OpenAI API на Stripe fraud/analytics processing. Privacy не задаёт один срок всем финансовым данным | По DPA transfer к Stripe LLC US, global affiliates/subprocessors; retention по service/legal obligations, не универсальные 30/90 дней. Actual account mode/region/contracts/backups U | [S36–38]. DPA 28 Sep 2026, subprocessors 27 Sep 2026, Privacy 28 Apr 2026. U: live readiness, applicable entities/settings. Никаких платежей/правок account в аудите |
| **Gemini optional hints** | Paid vs unpaid **разные условия**. Unpaid обычно используются для улучшения с возможным human review; paid-content не используется для улучшения по соответствующему разделу, но есть monitoring/security processing. EEA/CH/UK и linked Cloud Billing имеют специальные правила — не угадывать entitlement по наличию API key | Global API endpoint, actual billing project/service terms/region/backups U | [S39]. Это реальный selectable код, хотя не доказан production use. До no-training claim проверить активный Paid Services статус и все условия, не просто «платный аккаунт Google» |
| **Tutor Engine** | Внутренний/внешний сервис по URL, но его оператора и downstream retention/training контракты этот repo не доказывает | Region/backups U, даже если default host также Replit | C source есть, верифицированного service-specific DPA/subprocessor register нет. Не распространять результаты Secretary vendor audit на Tutor |
| **SendGrid / browser Web Push / CDN** | SendGrid email body/recipient; push endpoint выбирается подпиской браузера. CDN сетевые metadata. Нет основания обещать один no-training/TTL/region для всех | Для SendGrid termination-backup Schedule 1 Twilio **отдельный (один год)**, не Voice 60 дней и не наш retention. Push services/Google/Mozilla/Apple зависят от браузера; backup U | Twilio DPA/subprocessors для применимого SendGrid [S01–02]; browser delivery providers требуют отдельного register перед public notification claim. Technical email не Gmail integration и не SMS consent |

## 5. Пробелы → конкретные предлагаемые исправления

**Ни один из пунктов ниже не внедрён этим исследованием.** Это часть существующего
№3/его зависимостей, не новые дубли задач и не запуск №2/4–10.

| Приоритет | Пробел / риск | Изменение для отдельного решения | Как затем доказать |
|---|---|---|---|
| P0 | Deepgram основной поток без per-request MIP opt-out; account exception U | После согласования privacy posture: добавить `mip_opt_out=true` во **все** STT request builders (live/candidate/bench), либо документировать enforce account opt-out; отдельно согласовать регион и проверить поддержку моделей | Unit inventory + provider Usage Logs `mip_opt_out:true` на синтетическом запросе, без настоящего звонка; account evidence. В этой задаче запросы STT не выполнялись |
| P0 | Live `store:false` ошибочно можно принять за все API calls | Отдельно проверить delegated Responses storage и явные `store:false` во всех применимых standalone Responses builders; уточнить project/org ZDR/MAM/cache settings и endpoint exceptions | Builder tests + read-only org/project screenshots/contract; делегированный backend не выводить из Live flag |
| P0 | Eleven direct TTS без eligible ZRM flag, training setting U | Проверить план/entitlement и timestamp training opt-out; при требуемом ZRM согласовать `enable_logging=false` для direct TTS/stream и проверить endpoint support; clone lifecycle отдельно | Разрешённый synthetic TTS + history без saved audio и план/договор. Agents slider не evidence |
| P0 | Cartesia ZDR/training/region неизвестны | Получить org/plan/opt-out evidence; при нужной политике отдельное согласование Enterprise ZDR/contract/regional endpoint. Учесть clone sample exception | Read-only настройки/подписанное условие; не вводить несуществующий per-request bypass |
| P0 | Actual Replit prod DB/region/backup/DPA не установлены | Владелец проверяет publishing geography, DB target class (без строки подключения), retention window/scheduled backup, workspace Agent data-use policy; external DB — отдельный vendor review | Скриншот settings без secrets/customer rows, дата/кто подтвердил; restore/delete exercise позже в №6 |
| P0 | Recipient identity/DPA/region для CRM неизвестны | Определить реальных разрешённых destinations и contracts; proposal ограничить передачу минимально нужным payload, отдельно решить передачу recordingUrl/full transcript и HTTP endpoints | Owner approval recipient/use case, безопасная allowlist validation и delivery tests в №5. Ничего не рассылать ради аудита |
| P1 | Logs/fixtures/intake/TEST/outbox не имеют утверждённого lifecycle | Разделить purpose/data classification/TTL/exception policy, согласовать сроки и cleanup/backups в №6; redaction diagnostics без потери наблюдаемости | Тесты удаления/экспорта/restore/tombstones; не удалять существующее автоматически |
| P1 | Google Workspace/consumer и workspace connector смешиваются в обещаниях | Явно per-owner grants, минимальные scopes; Google data-use disclosure; no private event details to caller; не расширять scopes до approval №4 | Owner OAuth read-only evidence, isolated mock Calendar tests; booking authority отдельно |
| P1 | Consumer ChatGPT может обучаться на app results | Disclosure пользователю о host plan/settings и минимизация tool-result data; отдельное transcript permission; проверить Enterprise DPA при таком предложении | Реальные ChatGPT account settings владельца без secrets; не обещать управление ими из TalkHint |
| P1 | Gemini selectable without verified paid data controls | До privacy release определить, допускается ли этот маршрут для клиентских данных и какой project Paid Services entitlement требуется; если запрещать — отдельное code решение, не молчаливая подмена | Account evidence + model-selection tests; в этом аудите не отключали существующий режим |
| P1 | APNs/Stripe/SendGrid agreements and config unclear | Read-only account evidence + правильные роли/минимальные payloads. Уведомления не считать готовыми только по credentials. Финансовые retention commitments отделить | Отдельные разрешённые delivery/payment tests на этапе №10; сейчас никаких внешних действий |
| P2 | Tutor/optional CDN не охвачены Secretary договорами | Отдельный service register/contract chain перед включением в публичные promises; Tutor не расширяет текущий клиентский MVP | Operator confirmation, endpoint/model inventory и vendor documents |

Stage №1 остаётся без изменений: **нет разрешения на SMS/новую diagnostic
recording**, даже если провайдер имеет хороший DPA. Privacy setting провайдера
не является consent получателя SMS/участника звонка.

## 6. Точный список сведений от владельца

Не присылать credentials, voice IDs, клиентские transcripts или полные
connection strings. Достаточны redacted screenshots/документы и даты.

1. **OpenAI:** какой API org/project используется Dev/production; approved
   ZDR/MAM/None на обоих уровнях, sharing opt-ins, residency/processing setting;
   применимый договор/DPA и исключения конкретных Live/delegated models.
2. **Deepgram:** plan/contract, есть ли enforced account MIP opt-out; подтверждение
   request-log flag без payload и project keys; approved region/model support;
   применимый DPA/benchmarking terms.
3. **ElevenLabs:** plan, training opt-out и дата, Enterprise ZRM eligibility,
   hosting setting/contract; какие clone assets разрешены и как удаляются
   (без идентификаторов/образцов).
4. **Cartesia:** plan, org ZDR toggle, обработанный training opt-out и дата,
   selected region/dedicated endpoint entitlement, clone exception и DPA.
5. **Twilio:** Voice processing region/recording lifecycle/deletion overrides,
   какой договор/DPA применим; существующие historical recordings/backup
   obligations. SMS registrations/consents здесь не включать и не подавать.
6. **Replit/DB:** publishing geography и separate workspace geography,
   managed/external production DB, actual plan + restore window + scheduled
   backups; external DB vendor/region; Replit DPA applicability/Agent opt-out.
7. **Google:** consumer vs Workspace у используемых календарей, Workspace
   edition/data-region policy при наличии, accepted DPA; не содержимое событий.
   Личный per-user OAuth — отдельно от workspace Calendar connector.
8. **ChatGPT:** personal vs Business/Enterprise/Edu и relevant data controls,
   retention/Memory settings и applicable agreements. Наш API key этого не говорит.
9. **CRM/webhook:** юридический получатель каждого разрешённого destination,
   назначение/категории данных, DPA/subprocessors/training/region/retention/
   deletion/contact. Не присылать secret URLs: подтверждение связи через
   закрытые настройки владельца отдельно.
10. **Apple/Stripe/почта:** действующие developer/payment/service agreements,
    environment/readiness, applicable entities/regions; channel delivery
    подтверждается потом отдельно, не отсылкой тестового сообщения сейчас.
11. **Решения TalkHint:** юридическое лицо/контакты, требования к региону и
    допустимому training/abuse processing, category retention/backup/deletion.
    Ни 12 месяцев, ни 30/90 дней для наших данных пока не принято.

## 7. Допустимые публичные формулировки — только проект для №8

**Не опубликованы.** Перед размещением сопоставить с релизом, реальными
поставщиками и решениями владельца. Это не готовая Privacy Policy.

### Можно использовать как ограниченные технические объяснения

> TalkHint uses service providers to process calls, speech, account information,
> and the integrations you choose. The providers and data involved depend on
> the features you use.

> When enabled, speech processing and transcription may send audio and text to
> the providers for that feature. Disabling an audio recording does not
> necessarily disable speech processing or transcription.

> Connecting ChatGPT is separate from TalkHint’s API processing. Information
> returned to ChatGPT is also subject to your ChatGPT plan, settings, and
> OpenAI’s applicable policies.

> Disconnecting an integration or deleting TalkHint history does not
> automatically delete copies already delivered to another service or cancel
> calendar events.

### Только с явной областью действия

> The current TalkHint GPT-Live request sets `store` to `false`. This setting
> does not establish account-wide Zero Data Retention and does not cover every
> other endpoint, delegated service, security log, or provider.

> OpenAI states that API customer content is not used to train its models by
> default, subject to applicable controls and agreements. This is not a
> no-training guarantee for all TalkHint providers or for consumer ChatGPT use.

### Нельзя публиковать сейчас

- «Ни один провайдер не обучается на ваших данных».
- «У нас account-wide ZDR», «аудио никогда нигде не сохраняется».
- «Всё строго в США/ЕС», «регион guaranteed» без всей chain/account evidence.
- «Все данные удаляются через 30/90 дней / 12 месяцев».
- «Удаление TalkHint удаляет ChatGPT chats, Calendar и CRM».
- «Все поставщики подписали наш DPA» или «любые данные автоматически HIPAA
  compliant» на основании SOC2/заявления провайдера.
- «Нет записи» как синоним отсутствия STT/AI processing/transcripts/logs.
- «Google sign-in дал Calendar/Gmail, SMS и recording consent».

## 8. Критерии закрытия №3 и текущее решение

**Завершено:** current code inventory, provider-specific primary-source review,
проверяемые ссылки/даты, разграничение Live/Realtime/delegation/TTS/Agents,
список account unknowns, предлагаемые изменения, public wording constraints.

**Не закрыто:** org/project/privacy/region/backup/contract evidence из §6,
фактический production route/config match; необходимые privacy/code решения.
Настоящие API speech requests, модельная availability, iPhone/ChatGPT аудио,
звонки, SMS, push и платежи **не проверялись**.

**Статус этапа №3: EXTERNAL_VERIFICATION_REQUIRED.**
Не считать этот статус полным выполнением privacy readiness. Задача №1
сохранена; №2 и №4–10 остаются в очереди без запуска.

**Проверка сохранности этапа №1:** 22 октября повторно выполнен только
`npx vitest run server/communications/safety.test.ts` — **10/10 passed**, без
внешних transport calls. Runtime source/config не менялись; полный build/test
suite заново не запускались, поскольку изменены только документы и память.
`git diff --check` пройден. Исходное незавершённое изменение generated mockup
registry оставлено нетронутым и не относится к этому аудиту.

## 9. Реестр первичных источников

Все перечисленные страницы проверены **2026-10-22** через webFetch, кроме
platform metadata, проверенных read-only callback. Ссылки — первичные источники;
search snippets не использовались как единственное основание ключевых выводов.
Где страница не показывает revision date, фиксируется **дата проверки**, не
придуманная «дата политики». Содержимое длинных страниц использовано только в
прочитанных разделах; это не подтверждение всех их annexes.

| ID | Источник | Дата документа / оговорка |
|---|---|---|
| S01 | [Twilio DPA](https://www.twilio.com/en-us/legal/data-protection-addendum) | Last Updated 2026-04-09; прочитаны relevant Schedule 1 / deletion / abuse-processing sections |
| S02 | [Twilio subprocessors](https://www.twilio.com/en-us/legal/sub-processors) | Last Updated September 2026; service-specific список |
| S03 | [Twilio Recording resource](https://www.twilio.com/docs/voice/api/recording) | Revision date не указана; soft-deleted metadata retention section прочитан |
| S04 | [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data.md) | Revision date не указана; endpoint table, GPT-Live/delegation, Responses, ZDR/MAM, residency прочитаны |
| S05 | [OpenAI DPA](https://openai.com/policies/data-processing-addendum/) | Updated 2025-12-01, effective 2026-01-01 |
| S06 | [OpenAI subprocessors](https://openai.com/policies/sub-processor-list/) | Last updated 2026-10-14; API/Business products, не universal consumer contract |
| S07 | [Deepgram Your Data](https://developers.deepgram.com/trust-security/your-data) | Revision date не указана; MIP default/opt-out/regional processing/metadata |
| S08 | [Deepgram compliance](https://developers.deepgram.com/trust-security/data-privacy-compliance) | Revision date не указана; не доказательство DPA нашего аккаунта |
| S09 | [Deepgram Privacy](https://deepgram.com/privacy) | Отображает Last Updated 2021-10-26; собственный notice прямо отделяет Customer Data, не заменять им customer DPA |
| S10 | [Deepgram subprocessors](https://deepgram.com/privacy/subprocessors) | Revision date не указана; содержит comparative analysis / MIP opt-out условия |
| S11 | [ElevenLabs Privacy](https://elevenlabs.io/privacy-policy) | Updated 2026-10-09 |
| S12 | [ElevenLabs training controls](https://elevenlabs.io/docs/help-center/legal/is-my-data-used-to-improve-eleven-labs-ai-models) | Revision date не указана; Enterprise/default, future-data opt-out |
| S13 | [ElevenLabs ZRM](https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode) | Revision date не указана; Enterprise/eligible endpoints/per-request logging |
| S14 | [ElevenLabs DPA](https://elevenlabs.io/dpa) | Last Updated 2026-04-08 |
| S15 | [ElevenLabs subprocessors](https://compliance.elevenlabs.io/subprocessors) | Revision date не указана; plan-specific hosting table |
| S16 | [ElevenAgents retention](https://elevenlabs.io/docs/eleven-agents/customization/privacy/retention) | Revision date не указана; отдельно от direct TTS |
| S17 | [Cartesia Terms](https://www.cartesia.ai/legal/terms) | Revision date не установлена в прочитанном тексте; §5.3 training и opt-out |
| S18 | [Cartesia DPA](https://cartesia.ai/legal/dpa) | Revision date не установлена; §13 ZDR/clone sample exception |
| S19 | [Cartesia ZDR](https://docs.cartesia.ai/enterprise/zero-data-retention.md) | Revision date не указана; Enterprise/org control, не per-request flag |
| S20 | [Cartesia regional endpoints](https://docs.cartesia.ai/enterprise/regional-endpoints) | Revision date не указана; Enterprise dedicated vs global closest routing |
| S21 | [Cartesia subprocessors](https://trust.cartesia.ai/subprocessors) / [Privacy](https://cartesia.ai/legal/privacy) | Public list доступен; не evidence своего plan/settings |
| S22 | [Replit publishing geography](https://docs.replit.com/cloud-services/deployments/publishing-geography) | Revision date не указана; Core/Pro/Enterprise options и colocated managed artifacts; не подтверждает наш выбранный region |
| S23 | [Replit data recovery](https://docs.replit.com/features/data-and-storage/data-recovery) | Revision date не указана; plan/window/scheduled backups отдельно |
| S24 | [Replit model improvement](https://docs.replit.com/legal-and-security-info/model-improvement) | Revision date не указана; Agent content, Pro opt-out, Enterprise |
| S25 | [Replit DPA](https://replit.com/dpa) / [Privacy](https://replit.com/privacy) | DPA 2026-04-01; Privacy 2026-08-03; applicable agreement проверить |
| S26 | [Replit subprocessors — ссылка из DPA](https://repl.it/site/subprocessors) | Last updated August 2026. Trust center route показывал “No subprocessors found”; **не** интерпретировать как отсутствие поставщиков |
| S27 | [Google API User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) | Last updated 2024-02-15 |
| S28 | [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) | Дата проверки; проверены freebusy/list vs write scopes |
| S29 | [Google Privacy](https://policies.google.com/privacy) | Прочитаны relevant retention/global processing sections; не заменяет Workspace agreement |
| S30 | [Workspace DPA entry](https://workspace.google.com/terms/dpa_terms.html) / [subprocessors](https://workspace.google.com/terms/subprocessors.html) | DPA entry перенаправляет на Cloud DPA; применимость к нашему consumer/Workspace аккаунту **не доказана** |
| S31 | [Connected apps in ChatGPT](https://help.openai.com/en/articles/11487775-connectors-in-chatgpt) | Показывает относительное “Updated: 21 hours ago” при проверке; не стабильная абсолютная revision date |
| S32 | [ChatGPT chat retention/deletion](https://help.openai.com/en/articles/8809935-how-to-delete-and-archive-chats-in-chatgpt) | Аналогичная относительная дата; regular/archive/delete различия |
| S33 | [Sending notifications to APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns) | Revision date не указана; store-and-forward, apns-expiration |
| S34 | [Apple Privacy](https://www.apple.com/legal/privacy/en-ww/) | Дата проверки; не APNs-specific DPA |
| S35 | [Apple Developer Program Agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/) | Public agreement entry доступен; accepted account version/полный APNs annex не проверены |
| S36 | [Stripe DPA](https://stripe.com/legal/dpa) | Last updated 2026-09-28 |
| S37 | [Stripe subprocessors](https://stripe.com/legal/service-providers) | Last updated 2026-09-27 |
| S38 | [Stripe Privacy](https://stripe.com/privacy) | Last updated 2026-04-28; прочитаны applicable service/controller/retention sections |
| S39 | [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) | Last updated 2026-04-28 UTC; Paid/Unpaid sections, не archived terms |

**Ограничение исследований:** сведения о customer-facing guarantees берутся из
конкретных продуктов и договоров, не из marketing badges. Ни trust-center
наличие, ни список subprocessors не доказывают выбранную конфигурацию TalkHint.
