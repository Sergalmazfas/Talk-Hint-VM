# TalkHint: проверка Actions через HTTPS и подключение владельцем

**Статус:** локальный HTTPS protocol probe пройден; 97 изолированных проверок
включены в прошедший общий набор из 1365 тестов. Подключение из настоящего
ChatGPT ещё не выполнено: отдельный публичный test origin и callback TalkHint
GPT не предоставлены. Основной телефонный процесс не перезапускался.
Мобильный login-экран осмотрен только в тестовом браузере 390×844,
не в авторизованном ChatGPT на iPhone.

## Что подготовлено

Отдельный **тестовый процесс**, а не второй Secretary:
он использует существующие OAuth, Actions и web approval маршруты TalkHint,
но вместо native backend получает только синтетические fixtures.
Модули native auth/DB не загружаются, Twilio, workers и модель не запускаются.
Основной процесс приложения перезапускать для локальной проверки не нужно.

Команды:

```sh
npm run test:chatgpt-secretary
npm run test:chatgpt-https
```

Вторая команда поднимает временный HTTPS сервер на loopback, проверяет
TLS-сертификат и hostname через отдельный test CA, выполняет реальный HTTP
OAuth/browser/token/API обмен и закрывает сервер. Не отключает TLS validation.
Ни ChatGPT, ни опубликованный TalkHint в этой проверке не участвуют.
Ключ и сертификат удаляются; credentials, cookies, коды и токены не логируются.
Отчёт: `generated-artifacts/talkhint-actions/https-test/report.json`.

Проверяются: вход тестового владельца, state/CSRF, client secret,
одноразовый code, чтение, запрет чужих IDs, отдельное право транскрипции,
отказ read-only в создании поручения, запрет `confirmed:true`,
самостоятельное web-подтверждение номера/задания, параллельный запуск,
один mock dispatch и общий task_id, чтение результата и отзыв grant.

Разрешён **только вымышленный номер +12025550123**.
Результаты помечены `mock: true`. История, grant и задания тестового процесса
живут только в памяти: перезапуск аннулирует их. Это не история реальных звонков
и не проверка входа реального TalkHint-аккаунта.

## Что требуется до реального подключения ChatGPT

1. **Отдельный TalkHint GPT** с доступной настройкой Actions/OAuth. Не использовать
   ROADLEDGER/Road Ranger/Route Leader. По скриншотам владельца подтверждено наличие
   Actions у существующего ROADLEDGER на iPhone; это не доказывает возможность
   создания нового GPT или успешный TalkHint API-вызов.
2. **Согласованный отдельный HTTPS test origin на порту 443**. Существующий
   HTTPS origin основного телефонного сервера не переключать, не заменять и не
   перезапускать ради теста. Дополнительный нестандартный порт и локальный `.test`
   адрес не выдавать за совместимый ChatGPT endpoint.
3. **Точный callback URL**, который показывает редактор именно TalkHint GPT.
   Он не секрет. Не придумывать GPT ID и не подставлять callback другого GPT.
4. Два независимых test-only секрета: OAuth client secret и пароль синтетического
   владельца. Настраивать только через защищённое управление секретами тестового
   окружения; не присылать в чат и не использовать пароль/ключи рабочего TalkHint.

В изолированном окружении процесс можно запустить командой:

```sh
npm run chatgpt:actions:test-server
```

Он слушает **127.0.0.1:8000**, за согласованным TLS reverse proxy. Не создаёт
публичную ссылку и не настраивает DNS/TLS автоматически.
Для отдельного согласованного Replit test host с HTTPS ingress разрешён
явный флаг `--public-test`: bind на `0.0.0.0:8000`, с внешним root HTTPS на 443.
Это не разрешение менять порты или ingress основного телефонного сервера.

| Test-only настройка | Назначение |
|---|---|
| `CHATGPT_ACTIONS_TEST_ORIGIN` | Согласованный HTTPS origin без пути/порта |
| `CHATGPT_ACTIONS_TEST_CALLBACK` | Можно не задавать для schema bootstrap; точный callback обязателен до авторизации |
| `CHATGPT_ACTIONS_TEST_CLIENT_SECRET` | Отдельный секрет ≥32 символов |
| `CHATGPT_ACTIONS_TEST_OWNER_PASSWORD` | Другой test-only пароль ≥32 символов |
| `CHATGPT_ACTIONS_TEST_OUTBOUND_ENABLED` | Не задано/false: только чтение; true: только mock |
| `CHATGPT_ACTIONS_TEST_PORT` | Опционально 8000; 5000 запрещён |

Не включать эти настройки в production или общем телефонном процессе.
Client ID: `talkhint-secretary-test-actions`.
Тестовый login: `owner@talkhint.test`, пароль — только test-only настройка выше.

## Последовательность подключения в ChatGPT web и проверки iPhone

1. Подготовить отдельный согласованный mock origin и открыть его `/test/health`.
   Должны быть `mock: true`, `realDialerAvailable: false`.
2. Импортировать в Actions схему из
   `https://TEST-ORIGIN/api/chatgpt-actions/openapi.json`.
   По умолчанию она содержит только пять read операций.
3. Настроить OAuth: client ID выше, отдельный client secret, authorization URL
   `https://TEST-ORIGIN/api/chatgpt-actions/oauth/authorize`,
   token URL `https://TEST-ORIGIN/api/chatgpt-actions/oauth/token`,
   scope `calls:read offline_access`. Скопировать точный callback обратно в test
   configuration; до его настройки авторизация закрыта.
4. Подключиться и выполнить `get_profile`, `list_calls`, `list_tasks` в ChatGPT web,
   затем в официальном iPhone приложении. Ожидаются **синтетические** данные.
   Не включать `calls:transcript` без отдельной проверки согласия.
5. Проверить отзыв разрешения: старый access token перестаёт работать.
6. Только затем включить mock outbound в **тестовом** процессе, обновить Actions
   schema и OAuth scope (`secretary:start`), повторно выдать consent.
7. Поручить звонок **+12025550123** с вымышленным заданием. Открыть approval_url,
   проверить номер и текст, подтвердить. Вернуться в GPT и запросить запуск.
8. Должен вернуться один task_id; повторный запрос того же запуска возвращает
   тот же ID. Запросить результат: `mock: true`, `mockDispatches: 1`.

Прохождение локального TLS probe не отмечает эти шаги в ChatGPT выполненными.
Проверка настоящего владельца и реальной истории — отдельный последующий этап
на согласованном native-backed read-only окружении. Реальные звонки,
публикация и production по-прежнему требуют отдельного разрешения.
