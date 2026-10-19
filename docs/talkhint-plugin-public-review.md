# TalkHint: подготовка отдельного плагина для каталога ChatGPT

**Проверка: 19.10.2026. Статус: локальная подготовка, НЕ подано и НЕ опубликовано.**

Цель продукта — отдельный **TalkHint** в каталоге и среди подключений
официального ChatGPT, для владельца на **Plus**, прежде всего на **iPhone**.
Route Leader — только пример UX. Его проект, подключения и данные не используются.
Новый чат, нативное приложение и встроенный ChatGPT-виджет не нужны.

## 1. Что подтверждают официальные источники

| Вопрос | Подтверждено | Чего это не доказывает |
|---|---|---|
| Каталог на iPhone | Plugins доступны на web, desktop и mobile; функции зависят от клиента, тарифа, региона и workspace [1,2] | Что ещё не опубликованный TalkHint и каждый его инструмент уже доступны на Plus/iPhone |
| Plus | Официальная справка описывает connected apps и для Free/Plus/Go/Pro [2] | Наличие одинаковых функций у всех приложений, моделей и регионов |
| Custom MCP | Создание собственного подключения и full MCP документированы для Business/Enterprise/Edu; Pro — read/fetch; custom MCP — web-only [3] | Это не требование покупать Pro для установки одобренного публичного плагина |
| Публикуемый remote plugin | ZIP, один remote MCP, стабильный публичный HTTPS endpoint, domain verification, проверка и отдельное действие Publish [4,5] | Локальный ZIP, временный preview или mock-тесты не заменяют review |
| OAuth | Provided public client + PKCE разрешён; `tokenEndpointAuthMethod: none` не требует client secret; scopes должны соответствовать инструментам [4,6,7] | Наличие metadata не доказывает пройденный OAuth в реальном ChatGPT |
| Подтверждение действий | Annotations и клиентские разрешения не заменяют серверную авторизацию; необратимым действиям нужны safeguards [6,8] | Allow all actions не считается разрешением владельца на конкретный звонок |
| Мобильная проверка | Guidelines требуют надёжной работы на desktop и mobile [6] | Нельзя заявить iPhone compatibility по одному скриншоту web-страницы |

**Вывод:** основной путь — одобряемый remote-плагин в публичном каталоге.
Не рассчитываем на ручной custom MCP у Plus и не требуем смены тарифа.
Фактическую доступность именно TalkHint подтверждаем только реальной установкой
на Plus/iPhone после разрешённых этапов распространения.

## 2. Что подготовлено

- Используются прежние OAuth, marker store, owner-scoped backend и native
  Secretary idempotency/lease, без новой БД и миграций.
- Отдельные имя/manifest и **существующий значок TalkHint**. Не используются
  app IDs другого проекта, lifecycle hooks или локальный stdio.
- Сборщик `npm run chatgpt:package` создаёт ZIP только из `plugin.json`,
  `mcp.json`, `assets/icon.png`, `assets/logo.png`. Исходники, БД, `.env`,
  токены и reviewer credentials туда не попадают.
- Ровно один remote `streamable-http` сервер — TalkHint.
- Готовы пять positive и три negative review-сценария с инструментами и
  ожидаемыми результатами; это не утверждение, что их уже выполнил OpenAI.
- Существующие web-login/consent, подтверждение конкретного номера и задания,
  revoke и Secretary history остаются изолированными от нативного интерфейса.

### Инструменты и минимальные разрешения

| Инструмент | Scope | Эффект |
|---|---|---|
| get_profile | calls:read | Постоянный профиль из credentials; ID не меняется при refresh/reconnect |
| list_calls, get_call | calls:read | Собственная история, статус и доступный сохранённый итог |
| list_tasks, get_task | calls:read | Собственные поручения, сохранённый отчёт и task_id |
| get_call/get_task с includeTranscript | дополнительно calls:transcript | Текст только по запросу и после дополнительного согласия |
| prepare_call | secretary:start | Только подписанное предложение; никаких queued jobs или набора |
| start_call | secretary:start | Запуск только ранее отдельно одобренного владельцем поручения |

Начальная OAuth-связка: **calls:read + offline_access**.
`defaultScopes: []` предотвращает неявный запрос всех server scopes.
Транскрипции и право запуска добавляются отдельно через reauthorization.
`secretary:start` сам по себе не заменяет подтверждение каждого звонка.
`get_profile` — обязательная документированная привязка профиля, а не
способ выбирать чужой аккаунт. Он не возвращает email и лишние профильные поля.

`start_call`: readOnly=false, destructive=true, openWorld=true,
idempotent=true. Телефонный вызов — необратимое действие во внешнем мире.
`prepare_call`: readOnly=true, destructive=false, openWorld=true,
idempotent=false: это неперсистентный preview с новым короткоживущим ticket.
Чтение ограничено собственным аккаунтом: readOnly=true, destructive=false,
openWorld=false. Security schemes продублированы в `_meta` для совместимости.
В публичном MCP нет SMS, покупки номеров, входящего AI, переадресации или
инструмента-глобального исполнителя. Legacy owner REST остаётся отдельно.

### Исходящий и асинхронный результат

Команда → точный +1 номер и brief → `prepare_call` → защищённая
`approval_url` → отдельный вход владельца → проверка номера/задания →
Approve → возврат в ChatGPT → `start_call` → `task_id` → `get_task`.

GET ссылки не подтверждает и не набирает номер. Нельзя передать `confirmed:true`,
подменить номер/задание или заменить согласие настройкой клиента.
Повторы используют тот же clientRequestId и сохранённую задачу.
При неопределённом ответе провайдера автоматического повторного набора нет:
абсолютное exactly-once внешнего эффекта при сетевом сбое не обещается.
Голос и действующий сценарий Secretary не изменены.

Задачи, текущие статусы, реплики и отчёты остаются в существующей БД TalkHint.
`events` — сохранённые checkpoint-поля, не полный неизменяемый аудит.
Нет автоматической отправки результата в исходный чат; чтение по запросу.
Запись и согласие на запись не включаются инструментами плагина.

### Защищённый login

OAuth authorization code + S256, exact issuer/resource/client/callback,
short-lived code, rotation refresh, отзыв grant и отдельная owner-session.
Web-cookie Secure/HttpOnly/SameSite и browser binding; POST требует Origin/CSRF.
Секреты и пароль не спрашиваются инструментами или в чате.
Существующий Google/Apple web-login и session bridge требуют отдельной
проверки на реальном устройстве. Reviewer должен иметь специальный sample-data
аккаунт с доступным password-login, без MFA/OTP и доступа к данным владельца.

## 3. Локальная сборка

```
npm run chatgpt:package -- --draft
```

Создаёт **talkhint-NOT-FOR-UPLOAD.zip** и `readiness.json` в
`generated-artifacts/talkhint-plugin/draft/`. Все `.invalid` URL — заведомые
заглушки. Этот ZIP не нужно загружать ни в ChatGPT, ни в портал.
Папка исключена из Git и deployment. В сборщике нет сети, БД, телефонии
или операции отправки в OpenAI.

Для candidate скопировать `docs/chatgpt-plugin-submission.example.json`
в локальный non-secret файл, заменить значения и выполнить:

```
npm run chatgpt:package -- --config /path/to/non-secret-settings.json
```

Placeholder/IP/local URL, секретные query-параметры и неизвестные поля
отклоняются. `mode` меняет только состав пакета, **не включает backend**.
Оба режима всегда отмечают `readyToSubmit: false`: удалённая проверка ещё
не состоялась. Сборщик ничего не отправляет и не меняет настройки.

Backend по умолчанию read-only. Отдельный флаг
`CHATGPT_SECRETARY_OUTBOUND_ENABLED=true` предусмотрен для будущей явно
разрешённой активации; здесь он не устанавливался. Состав пакета и инструменты
реального endpoint должны совпадать перед scan/review.

### Обнаруженное расхождение схем

По состоянию на 19.10.2026 опубликованный Agent Plugins 1.0.0
`mcp.schema.json` запрещает дополнительные поля у streamable-http сервера
и не объявляет `extensions`. При этом OpenAI прямо документирует
`mcpServers.<name>.extensions.com.openai.auth` для OAuth.

Пакет сохраняет OAuth по документации OpenAI: **не удаляет авторизацию ради
валидатора и не заменяет её на noauth**. Локальные проверки подтверждают
формат нашего пакета и constraints, но не объявляют полный portable schema
validation успешным. Противоречие внесено в readiness blockers: нужна
проверка importer/portal или официальное уточнение до подачи.
Источники схем: [plugin schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json),
[MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json).

## 4. Материалы и действия владельца перед подачей

1. Выбрать отдельные OpenAI Platform organization/project и verified
   Developer identity. Нужны права api.apps.read/api.apps.write либо Owner.
   Для MCP review документация сейчас исключает EU data-residency project [5].
   Это издательские права Platform, не требование поменять Plus.
2. Утвердить права на имя/значок TalkHint и фактическое имя издателя.
3. Согласовать стабильный универсальный публичный HTTPS hostname.
   OpenAI не принимает local/testing endpoint вместо submission endpoint [5].
   Production в этом этапе не меняется и не размещается новый публичный сервер.
4. Предоставить точные публичные company/product, privacy, terms, support URL,
   страны и video walkthrough URL. Шаблон config — не готовая юридическая политика.
5. В privacy определить реальные сроки хранения/удаления, категории данных
   (телефоны, задания, статусы, транскрипции, отчёты), получателей и цели,
   обработчиков телефонии/AI/голоса, контроль доступа и отзыв разрешений.
   Нельзя выдумывать сроки или обещать удаление, которое не проверено.
6. Утвердить региональные правила исходящих, AI disclosure, права на голос,
   согласие участников и recording policy. Не обещать бесплатные звонки:
   Plus не заменяет условия сервиса и расходы телефонии/AI API.
7. Подготовить dedicated reviewer account с sample data; пароль вводится
   владельцем отдельно в Review details, **не в ZIP, чате или репозитории**.
   Аккаунт и сценарии должны быть доступны и на последующих проверках.
8. После отдельного разрешения на действия в портале: upload draft ZIP,
   **With MCP**, domain challenge, точный callback, OAuth, connect/scan и
   устранение schema/tool findings. Challenge возвращается plain text по
   URL, указанному OpenAI; нельзя перезаписывать token другого плагина.
9. Выполнить пять positive / три negative сценария, проверить Plus/iPhone,
   записать доступное видео, проверить tool snapshot и legal URL.
10. Только по **новому явному разрешению** — Submit for review.
    Approval не означает автоматический Publish: публикация — ещё отдельное
    согласованное действие. Для реальных звонков тоже требуется отдельное разрешение.

**Сейчас пункты 1–10 не выполнялись внешними действиями.**
Не создавались реальные reviewer users, не менялись схема или пользовательские данные, не размещался challenge,
не было upload/scan/review/publish или настоящего звонка.

## 5. Будущий пользовательский путь Plus/iPhone

После одобрения и разрешённой публикации:

1. В актуальном официальном ChatGPT на iPhone открыть
   [каталог Plugins](https://chatgpt.com/plugins) и найти **TalkHint**.
   Если показывается Apps, обновить приложение; названия интерфейса могут отличаться.
2. Проверить карточку и издателя → Install plugin → Connect.
3. На first-party странице TalkHint войти в **свой** аккаунт и явно выдать
   минимальные OAuth permissions. Существующие данные не импортируются в чужой проект.
4. Выбрать `@TalkHint` и запросить свои поручения/итоги.
5. Для звонка — дополнительный scope и отдельная web-approval каждого номера/задания.
   Проверить, что ссылка открывается, cookie/session работают и есть возврат
   именно в официальный ChatGPT. Web-страница сама ничего не набирает.
6. После start сохранить task_id и читать результат по запросу, включая после
   закрытия/открытия приложения. Проверить отзыв подключения и отказ старых токенов.

Тестировать с **реальным Plus аккаунтом на реальном iPhone**: видимость в
каталоге/значок, Install/Connect, Safari/auth session, incremental scopes,
foreign IDs, approve/deny/expiry, duplicate start, revoke и повторное чтение.
Пока нет одобренного плагина и этих результатов, все пункты —
**план приёмки, не обещание совместимости**.

## 6. Результаты локальной проверки

- **74 изолированных теста прошли**, восемь файлов; БД и provider credentials
  в этом наборе отключены. Включены browser OAuth, concurrent consent,
  изоляция аккаунтов, revoke/refresh, transcript scopes, per-call approval,
  запрет unlisted incoming tool, annotations и состав ZIP.
- **1342 теста прошли в полном наборе, 107 файлов.**
  Существующие development PostgreSQL integration tests используют
  синтетические записи и cleanup, не production и не звонки.
- TypeScript и `git diff --check` прошли. Отдельный render-only fixture
  проверен в мобильной ширине; это не OAuth/ChatGPT/iPhone end-to-end тест.
- Mock native launch и сохранённый task_id проверены существующими тестами.
  Сетевые вызовы телефонии, portal scan и установка в реальном ChatGPT не выполнялись.

При чтении через плагин выбранные данные передаются ChatGPT. Для Plus обработка
этих данных также зависит от настроек OpenAI (включая Improve the model for
everyone); это отдельный пункт пользовательского privacy disclosure [2].
Отзыв OAuth прекращает последующий доступ, но не обещает удалить уже показанный
текст из истории ChatGPT.

## 7. Первичные источники

Все проверены **19.10.2026**:

1. [Plugins: каталог, установка и мобильные клиенты](https://help.openai.com/en/articles/20001256)
2. [Connected apps, ограничения планов/клиентов и permissions](https://help.openai.com/en/articles/11487775)
3. [Custom MCP: отдельные ограничения](https://help.openai.com/en/articles/12584461)
4. [Submit plugins: ZIP, OAuth, domain verification, пять/три теста, видео](https://developers.openai.com/plugins/deploy/submission)
5. [Remote MCP review: identity, permissions, stable endpoint, mobile tests](https://developers.openai.com/plugins/deploy/app-review)
6. [Plugin guidelines: privacy, minimal data, annotations, safeguards](https://developers.openai.com/plugins/plugin-guidelines)
7. [Package format и OAuth configuration](https://developers.openai.com/plugins/build/plugins)
8. [OAuth и стабильная привязка профиля](https://developers.openai.com/plugins/build/auth)
