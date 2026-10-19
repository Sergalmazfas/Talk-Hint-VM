# Личный TalkHint Secretary через Custom GPT Actions

**Дата проверки первоисточников: 19.10.2026.**
Публичный каталог, review и Plugin ZIP для этого сценария не нужны.
Приоритет — отдельный личный GPT **TalkHint Secretary**, без изменения
Road Ranger Business Processes, Route Leader, iOS или действующей телефонии.

## Зафиксированное архитектурное решение

Поддерживаются **два независимых способа подключения**:
Custom GPT Actions и OAuth/MCP. Они обращаются к **одному защищённому
backend TalkHint и одному существующему Secretary**: общие история, задачи,
результаты и native idempotency, но раздельные credentials, grants и
проверки протокола. Подтверждение одного подключения нельзя переносить
в другое для обхода согласия.

Телефония TalkHint работает независимо от подписки ChatGPT. Доступность
Actions/MCP на Plus/Pro и конкретном клиенте проверяется на стороне
подключения и не определяет работу обычных звонков.

Порядок: **завершить API → проверить реальное подключение и работу →
только затем рассматривать расширение возможностей**. Локальные mock-тесты
не заменяют реальную OAuth/ChatGPT-проверку. Следующий тестовый этап —
авторизация, чтение и mock-запуск через согласованный HTTPS endpoint;
реальные звонки и изменения production по-прежнему требуют отдельного разрешения.

## Важное ограничение личных тарифов, включая Pro 100

[OpenAI официально предлагает Pro 100 за $100/месяц](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers).
Это не Plus. Но наличие Pro 100 само по себе не снимает следующие ограничения.

[OpenAI: Creating and editing GPTs](https://help.openai.com/en/articles/8554397)
сейчас прямо указывает: **новые GPT нельзя создавать на личных Free/Go/Plus/Pro**;
ранее созданные GPT можно продолжать использовать и редактировать при
соответствующих правах. Создание доступно в разрешённых Business/Enterprise/Edu
workspaces. Pro не является решением этого ограничения.

Поэтому сначала нужен **отдельный уже существующий редактируемый TalkHint GPT**
или подтверждённая возможность создания в вашем аккаунте/workspace.
Наличие Road Ranger не означает, что можно создать ещё один; его не заменяем.
Если отдельного GPT нет и Create недоступен, установка этим способом
сейчас блокируется возможностями ChatGPT, а не OpenAPI TalkHint.

Другой механизм — custom MCP: [официальная справка](https://help.openai.com/en/articles/12584461)
разрешает Pro подключения с read/fetch permissions, но указывает web-only.
Это не доказанный путь для команды «позвони» на iPhone. Нельзя переименовать
write-инструмент в read-only ради обхода ограничения. Сначала нужно отличить
существующий Custom GPT от подключения в Plugins/Apps.

Та же справка подтверждает: настройка GPT — только web, мобильные клиенты
могут использовать GPT. Фактические OAuth/Actions TalkHint на iPhone
ещё не проверялись. Apps и Actions одновременно в одном GPT не поддерживаются.
Actions также недоступны в **Pro mode** — это режим модели, не требование
сменить Plus-тариф.

OpenAI предупреждает о предстоящем retirement custom GPTs: для затронутых
Enterprise — 11.12.2026, для остальных планов ожидается подобный график;
точную применимость к личному аккаунту нужно проверять по его уведомлениям.
Без нового согласования не переводим сценарий обратно в публичный каталог.

## Что реализовано в исходниках

Отдельный namespace **/api/chatgpt-actions**, собственные client ID,
credential audience, browser cookies и шифрование browser tickets.
Разрешён только один явно настроенный backend owner ID.
Никаких ownerId/userId в Actions-запросах.

Переиспользуются native Secretary/backend, прежняя БД, OAuth grants/markers,
refresh rotation/revocation, web-login/consent, per-call approval и native
idempotency. Нет новой очереди черновиков и нет миграций:
неодобренный draft — подписанное краткоживущее предложение, а не queued job.
История/результаты остаются в существующем backend.

**Это не ослабление MCP OAuth.** MCP по-прежнему требует resource и S256.
Actions — отдельный confidential client: secret обязателен при code/refresh
exchange; resource необязателен у клиента, но на сервере фиксирован.
Если Actions прислал PKCE, он обязательно проверяется. Поддержаны POST body
и HTTP Basic client authentication, JSON и form token exchange.
Callback — только точный настроенный HTTPS /aip/g-.../oauth/callback
на chatgpt.com либо chat.openai.com, без wildcard.

| Метод и путь после /api/chatgpt-actions | operationId | Право |
|---|---|---|
| GET /profile | get_profile | calls:read |
| GET /calls | list_calls | calls:read |
| GET /calls/{id} | get_call | calls:read |
| GET /tasks | list_tasks | calls:read |
| GET /tasks/{id} | get_task | calls:read |
| POST /drafts | prepare_call | secretary:start + outbound gate |
| POST /launches | start_call | secretary:start + gate + отдельный owner approval |

Для includeTranscript=true отдельно нужен **calls:transcript**.
Начальные scopes: **calls:read offline_access**.
API не принимает голос/язык/ownerId/confirmed в draft; используется прежний
Secretary с прежними defaults. В Actions нет generic executor, MCP,
SMS, incoming AI, записи, покупки номеров или API self-approval.

Запуск помечен x-openai-isConsequential:true. Даже если пользователь
подтвердил действие в ChatGPT, сервер всё равно требует независимый web-approval
точного номера/задания. GET ссылки и POST Approve **не набирают номер**.
Только последующий start_call входит в существующий idempotent native launch.
Повтор использует тот же clientRequestId; при неопределённом ответе провайдера
автоматического повторного набора нет. Абсолютное exactly-once внешнего
эффекта при сетевом сбое не обещается.

После 202 получаем task_id и читаем get_task. Нет фоновой доставки отчёта
в исходный чат. Данные отчётов считаются недоверенными, не инструкциями.
Отзыв OAuth останавливает будущий API-доступ, но не отменяет уже начатый звонок.

## Что нужно настроить позже, только после согласования окружения

Сейчас **ничего не включено и не размещено заново**. Основной сервер не
перезапускался. Нет действующего нового публичного HTTPS подключения.
Подготовлены следующие opt-in параметры:

| Параметр | Назначение |
|---|---|
| CHATGPT_ACTIONS_ENABLED | По умолчанию OFF |
| CHATGPT_ACTIONS_ORIGIN | Точный публичный HTTPS origin, TLS 1.2+, порт 443 |
| CHATGPT_ACTIONS_REDIRECT_URI | Точный callback из editor отдельного GPT |
| CHATGPT_ACTIONS_OWNER_ID | ID разрешённого существующего владельца TalkHint |
| CHATGPT_ACTIONS_CLIENT_SECRET | Новый независимый secret минимум 32 символа |
| CHATGPT_ACTIONS_OUTBOUND_ENABLED | Отдельный opt-in, по умолчанию OFF |

Client ID: **talkhint-personal-actions**. Signing использует существующий
SESSION_SECRET без его раскрытия или изменения.
Нельзя использовать как client secret ключи Twilio/OpenAI, SESSION_SECRET
или ключ другого проекта. Новый secret вводится владельцем только через
защищённое хранение сервера и Authentication editor GPT — **не в чат,
OpenAPI JSON, Instructions, URL или Git**. На этом этапе ключ не создавался
и не запрашивался.

До отдельного разрешения никакой настройки production и реальных outbound.
Для следующего этапа нужен согласованный HTTPS test endpoint с mock dialer,
а не запуск основного приложения ради теста.

## OpenAPI и инструкция GPT

```
npm run chatgpt:actions -- --draft --outbound
```

Создаёт `generated-artifacts/talkhint-actions/draft/talkhint-actions-NOT-FOR-CONNECTION.json`.
Это структурированная OpenAPI 3.1.0 schema с **заведомо нерабочим .invalid origin**,
для просмотра/подготовки, а не рабочего подключения.

Когда будет согласован публичный test origin:

```
npm run chatgpt:actions -- --origin https://YOUR-APP-HOST
```

По умолчанию — только пять read-операций. `--outbound` добавляет draft/start
в документ, но **не включает backend и не разрешает звонки**.
GET /api/chatgpt-actions/openapi.json выдаёт документ текущего backend режима.
Все URLs OAuth и API — одного origin, как требует документация Actions.
Нет зависимости от Plugin ZIP / extensions или его schema conflict.
Инструкции модели: [готовый текст для Instructions](talkhint-actions-gpt-instructions.md).

Экспорт офлайн: не читает secrets/env/БД, не включает flags, не подключает GPT.
OpenAPI проверяется локально на структуру, уникальные operationId, обязательные
path parameters, scopes, response schemas, consequential flags и соответствие
реальным HTTP endpoints. Import в реальном ChatGPT ещё не выполнялся.

## Пошагово для владельца в ChatGPT web

Эти действия — **следующий этап**, а не выполненная установка.

1. Открыть [My GPTs](https://chatgpt.com/gpts/mine) в web и проверить наличие
   отдельного GPT, который разрешено использовать для TalkHint.
   Если его нет и Create недоступен — остановиться. Road Ranger/Route Leader
   не переименовывать, не заменять и не подключать к ним TalkHint.
2. Edit GPT → Configure. Name: **TalkHint Secretary**.
   Description: «Личный Secretary TalkHint: моя история, поручения и результаты;
   каждый звонок — только с отдельным подтверждением».
3. Вставить приложенный текст Instructions. Не включать Apps.
4. Actions → Create new action → вставить schema, сгенерированную для
   **реального согласованного HTTPS test endpoint**, сначала read-only.
5. Authentication → OAuth:
   client ID talkhint-personal-actions; независимый client secret;
   Authorization URL: `https://HOST/api/chatgpt-actions/oauth/authorize`;
   Token URL: `https://HOST/api/chatgpt-actions/oauth/token`;
   scopes **calls:read offline_access**; exchange — Default POST или Basic.
6. Скопировать **точный Callback URL из этого GPT** в разрешённую
   серверную конфигурацию. Не использовать callback другого GPT.
   На сервере также должен быть разрешён именно ваш backend owner ID.
7. Выбрать совместимую с Actions модель, не Pro mode. Сохранить **только
   для себя / Only me**, если доступно. Ничего не отправлять в GPT Store.
   Публичная или link-sharing версия потребовала бы дополнительных privacy
   условий; здесь такое распространение не предлагается.
8. В Preview попросить «покажи мой профиль и последние поручения» →
   штатная кнопка Sign in → first-party TalkHint login → проверить и выдать
   перечисленные scopes. Если основной аккаунт passwordless — проверить
   существующий web-SSO/session bridge, а не передавать app bearer в GPT.
9. Проверить собственные данные, отказы для чужого ID, logout и OAuth revoke
   через защищённую страницу `/api/chatgpt-actions/connections/manage`.
10. Для транскрипций отдельно добавить calls:transcript и переподключиться
    с новым согласием. Actions не обещает автоматический MCP-style scope challenge.
11. Только в разрешённом **mock окружении** добавить secretary:start и
    outbound schema, повторно согласовать права, проверить draft → approval_url →
    owner review → возврат → start → один mock dispatch → task_id → get_task.
    Не нажимать Test у launch на backend с реальным dialer.
12. На официальном iPhone открыть тот же личный GPT в том же аккаунте,
    проверить Sign in/браузер/cookie/возврат, чтение и mock approval.
    Только эти результаты могут подтвердить совместимость TalkHint.

## Ограничения и проверки

Actions: лимит round trip **45 секунд**, payload меньше **100 000 символов**,
HTTPS/TLS 1.2+ на 443; не рассчитывать на произвольные custom headers.
Плагин не ждёт окончания разговора: возвращает задачу и читает результат позже.
При сетевом timeout — искать существующую задачу по clientRequestId, не делать
новый звонок. Большой результат возвращает **413**, а не тихо обрезанный текст;
полный отчёт можно открыть в защищённой web-истории. Постраничное чтение
длинных транскрипций пока не реализовано.

Автотесты работают с фиктивными владельцами, marker store и mock dialer,
при отключённых provider credentials/DB в isolated config.
Проверены OAuth без resource/PKCE, обязательный secret и optional S256,
replay/refresh/revoke, owner allowlist, namespaces, scopes, чужие IDs,
web-CSRF, отрицание/истечение approval, повторы, один mock dispatch и task read.
Нативные тесты дополнительно проверяют существующую БД/idempotency.
Никаких реальных звонков или изменений production.

Итог текущего прогона: **92 isolated tests прошли (9 файлов)**,
**1360 tests прошли в полном наборе (108 файлов)**, TypeScript и diff check
успешны. Существующие development PostgreSQL tests используют синтетические
записи с cleanup, а не production. Мобильный viewport проверен только на
render-only fixture; это не реальный ChatGPT/iPhone OAuth тест.

Конкретный результат владельцу: локальная серверная подготовка готова;
внешнее HTTPS подключение, реальный editor import и iPhone ещё не проверены.
Для них нужны доступный отдельный GPT, согласованное test окружение,
callback и защищённая настройка нового client secret.

## Официальные источники, проверены 19.10.2026

- [Кто может создавать/редактировать GPT; web/mobile; retirement](https://help.openai.com/en/articles/8554397)
- [Actions editor, OAuth, модель, workspace/privacy ограничения](https://help.openai.com/en/articles/9442513)
- [Actions authentication: client secret, state и callback](https://developers.openai.com/api/docs/actions/authentication)
- [REST Actions и OpenAPI](https://developers.openai.com/api/docs/actions/introduction)
- [HTTPS, 45 секунд, размер и consequential flag](https://developers.openai.com/api/docs/actions/production)
- [Pro tiers, включая Pro 100](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers)
- [Custom MCP: Pro read/fetch и web-only](https://help.openai.com/en/articles/12584461)
