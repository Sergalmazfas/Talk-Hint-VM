# TalkHint Secretary — частное MCP-подключение

Проверено 20 октября 2026. Это подготовка следующей версии существующего TalkHint,
не отдельное приложение и не новая телефония. Публикация, изменения production
настроек, реальные звонки и входящие AI не выполнялись.

## Что найдено и подготовлено

- В исходниках адаптер уже был зарегистрирован до статического сайта.
  Локальный `dist/index.js` от 27 сентября не содержал MCP вообще.
- Повторная проверка публичного `https://talkhint.app` показала MCP HTTP 404
  и оба OAuth discovery HTTP 200 с `text/html`. Это не ответ нового отключённого
  адаптера: такой адаптер возвращает HTTP 503 JSON. Точный revision опубликованной
  VM не установлен; локальная старая сборка не доказывает её точный состав.
- Исправлена подготовка: следующий production build включает read-only профиль
  MCP на подтверждённом домене TalkHint. `CHATGPT_SECRETARY_ENABLED=false`
  остаётся аварийным выключателем. Development автоматически не включается.
- Исходящие через этот production-профиль жёстко выключены независимо от старого
  `CHATGPT_SECRETARY_OUTBOUND_ENABLED`. Обычный Secretary, Twilio и текущие
  входящие маршруты не изменялись. Actions остаётся отдельным адаптером того же backend.
- Build gate проверяет, что MCP, OAuth, browser consent и существующий backend
  действительно включены в выходной серверный bundle. Отсутствующий discovery
  больше не подменяется HTML главной страницы.
- `npm run build:prepare` создаёт кандидат в
  `generated-artifacts/talkhint-release-candidate/dist`, не заменяет рабочий
  `dist`, не запускает сервер, не обращается к Tutor Engine и не публикует.
  Обычный Publish build сохраняет существующую обязательную live Tutor-проверку.
  Кандидат не был запущен как production runtime.

## Параметры подключения после отдельной публикации

| Параметр | Значение |
|---|---|
| Имя | TalkHint Secretary |
| MCP endpoint и `resource` | `https://talkhint.app/api/chatgpt/mcp` |
| Transport | Stateless Streamable HTTP, POST JSON-RPC → JSON |
| GET MCP | HTTP 405, `Allow: POST`; SSE не предоставляется |
| Protected resource discovery | `https://talkhint.app/.well-known/oauth-protected-resource` |
| RFC 9728 path discovery, тот же JSON | `https://talkhint.app/.well-known/oauth-protected-resource/api/chatgpt/mcp` |
| Authorization server discovery / issuer | `https://talkhint.app/.well-known/oauth-authorization-server` / `https://talkhint.app` |
| Authorization URL | `https://talkhint.app/api/chatgpt/oauth/authorize` |
| Token URL | `https://talkhint.app/api/chatgpt/oauth/token` |
| Revocation URL | `https://talkhint.app/api/chatgpt/oauth/revoke` |
| Регистрация клиента | **provided**, статически преднастроенный клиент; DCR и CIMD не реализованы и не рекламируются |
| Client ID | `talkhint-chatgpt` — не секрет |
| Client authentication | `none` — public client, client secret не нужен |
| Flow | Authorization code + обязательный PKCE **S256**, refresh token rotation |
| Базовые scopes | `calls:read offline_access` |
| Отдельное разрешение | `calls:transcript`, не входит в scopes подключения по умолчанию |
| Readiness | `https://talkhint.app/api/chatgpt/readiness` |
| Метаданные | `/api/chatgpt/plugin.json`, `/api/chatgpt/mcp.json` на том же домене |

**Сейчас опубликованный endpoint по-прежнему 404.** Эти параметры описывают
подготовленный следующий release, а не завершённое live-подключение.

Пять инструментов: `get_profile`, `list_calls`, `get_call`, `list_tasks`,
`get_task`. Точные JSON Schemas возвращает `tools/list`.
Профиль/списки принимают `{}`; детали — `id` и необязательный
`includeTranscript` (по умолчанию false). Подмена account/user ID в аргументах
запрещена. `prepare_call`, `start_call`, `get_incoming` недоступны через MCP.

## Необходимое значение из ChatGPT: точный callback

`CHATGPT_SECRETARY_REDIRECT_URI` пока **не задан**. Его нельзя получить из домена
TalkHint, ID Custom GPT или примера ROADLEDGER.

OpenAI документирует два режима MCP callback:
`https://chatgpt.com/connector_platform_oauth_redirect` при поддержке issuer
identification и `https://chatgpt.com/connector/oauth/{callback_id}` в другом
режиме. Это описание форматов, **не выбор callback вашего подключения**.
Копировать надо точное значение из management page именно созданного MCP
подключения. Входящий redirect проверяется на точное совпадение с настройкой;
шаблоны и callback GPT Actions `/aip/g-…/oauth/callback` не принимаются.

Сервер публикует `authorization_response_iss_parameter_supported: true`,
возвращает точный `iss` в успешных и отказных OAuth redirect, требует `resource`
на authorization/token и проверяет audience при чтении access token.

Без callback работают discovery, initialize, tools/list и публичная readiness.
Любой вызов инструмента возвращает OAuth challenge, **без чтения данных даже
с ранее выданным токеном**. Login/consent/token/grant операции остаются
закрыты HTTP 503 до настройки. Некорректный callback блокирует только интеграцию,
не запуск телефонного сервера.

Новые секреты для public client не нужны. Не вводить в ChatGPT `SESSION_SECRET`,
Twilio/OpenAI ключи, пароль TalkHint или обычный токен приложения. Пароль вводится
только на защищённой странице входа **TalkHint** при OAuth.

## Порядок действий владельца

1. Отдельно согласовать публикацию обновлённого **существующего** TalkHint.
   Production env сейчас не изменялись. Origin задан в release-профиле;
   исходящие остаются выключены. Схема БД не меняется.
2. После публикации проверить JSON discovery и
   [readiness](https://talkhint.app/api/chatgpt/readiness), MCP initialize/tools/list.
   Отсутствующий callback на этой стадии — ожидаемый явный блокер, не HTML.
3. В **ChatGPT web** открыть [Plugins](https://chatgpt.com/plugins) →
   **Add custom MCP server** → имя TalkHint Secretary → указанный MCP URL →
   OAuth с provided client ID и методом `none`. Начать настройку
   **Create as a plugin**, не считать её завершённой до успешной авторизации.
   Доступность формы зависит от аккаунта и workspace policies. Если форма не
   позволяет provided/public client, не обходить это noauth, чужим secret,
   GPT Actions callback или Allow all tools: требуется проверить доступный flow.
4. Скопировать exact redirect URI из management page данного подключения.
   Это не секрет; его нужно отдельно задать как
   `CHATGPT_SECRETARY_REDIRECT_URI` в конфигурации следующего согласованного
   production запуска. До этого закончить авторизацию нельзя. Если интерфейс
   требует OAuth уже при scan/создании, сначала получить показанный в настройке
   callback; не обходить эту зависимость и не обещать создание без него.
5. Выполнить OAuth: войти в свой TalkHint и подтвердить только базовые права.
   Проверить профиль и историю. Транскрипции разрешать отдельно только при
   необходимости. Разрешения можно отозвать через защищённую
   [страницу подключений TalkHint](https://talkhint.app/api/chatgpt/connections/manage)
   после активации release.
6. Повторить проверку прав/отзыва уже через реальный ChatGPT. Пока этого не было:
   нет подтверждённого scan, авторизации владельца, plugin ID и теста на iPhone.

Частный custom MCP не требует публичного каталога/review для этого сценария.
Локальный marketplace/package и публикация в публичный каталог — другие пути;
они сейчас не выполнялись.

## Проверки и их границы

- Mock/integration tests: production profile, JSON discovery (включая scoped URL),
  initialize/notification/tools/list, GET 405, OAuth challenge, provided client,
  PKCE/resource/redirect/issuer, code replay, отзыв, аккаунты A/B, отдельное
  разрешение на транскрипции, блокировка исходящих/входящих.
- Existing tests проверяют native legacy `/start-call`: анонимный 401,
  авторизованный 410, без provider call.
- Offline build проверяет включение модулей в реальный production bundle.
  Это **не** запуск production, реальный TLS OAuth round trip с ChatGPT,
  работа с настоящим аккаунтом/БД или одобрение OpenAI.
- Public HTTPS проверен только в текущей, ещё не обновлённой версии:
  MCP 404 / discovery HTML. HTTPS edge доступен, но MCP ещё не опубликован.
- В этой сессии: TypeScript check прошёл; полный набор — **1373 теста в 110
  файлах**, все прошли; offline build и MCP inclusion gate прошли.
  Основной процесс не перезапускался. Его публичная страница входа открывается;
  она не является проверкой новой сборки или интерфейса после авторизации.

## Подтверждённые официальные ограничения

Проверено **20 октября 2026**, источники:

- [OpenAI: authentication](https://developers.openai.com/plugins/build/auth):
  discovery, PKCE S256, resource/audience, issuer identification, точные MCP
  redirect URI; CIMD рекомендован, DCR и predefined OAuth clients поддерживаются.
- [OpenAI: package/auth configuration](https://developers.openai.com/plugins/build/plugins):
  `client.mode: provided`, `tokenEndpointAuthMethod: none` допустимы.
  Это подтверждает документированную конфигурацию, не прохождение scan.
- [OpenAI: connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt):
  публичный HTTPS endpoint/transport, Add custom MCP server, Create as a plugin;
  account/workspace policies применяются.
- [OpenAI Help: developer mode and MCP](https://help.openai.com/en/articles/12584461-developer-mode-and-custom-apps-in-chatgpt):
  **“Can I connect custom MCP servers on mobile? No — web only.”**
  Это прямое ограничение подключения с мобильного клиента, а не доказательство
  работы уже подключённого сервера в iPhone. Последнее также не проверено;
  работоспособность частного MCP в официальном iPhone-приложении не обещается.
  Safari/web — отдельная поверхность, также требует проверки на аккаунте.
  Работа ROADLEDGER Actions в iPhone не доказывает доступность MCP.
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports):
  JSON-only POST response и GET 405 без SSE допустимы.

Автоматическая отправка результата в исходный чат, новые поручения/звонки,
SMS, запись, переадресация и AI-входящие в этот этап не входят.
