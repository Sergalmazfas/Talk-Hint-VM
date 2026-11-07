# Claude на Mac: Google/Replit-вход в Dev-чат

Репозиторий https://github.com/Sergalmazfas/Talk-Hint-VM,
ветка `xcode-chat-live-dev-2026-11-07`. База новой дельты — `444fbee`.
Точный новый HEAD сверить через git ls-remote. Это только нативная OAuth-дельта,
не перенос всего Replit-сервера. Серверная часть запущена отдельно в Replit Dev.

## Обязательно сохранить Mac-исправление

Текущая Mac-ветка содержит `fb97108` — исправление последней проверки условия
в тестовом ожидании. Replit получил описание, но ещё не получил сам патч.
НЕ затирать этот тест и не заменять Mac-ветку remote-деревом.

1. Покажи git status/HEAD; при незакоммиченных изменениях STOP.
2. Сохрани прежнюю ветку. Fetch штатного remote, сверка remote HEAD.
3. На НОВОЙ локальной ветке от текущего Mac `fb97108` cherry-pick ТОЛЬКО
   новый OAuth-коммит после `444fbee`. Без stash/reset/rebase/force.
   При конфликте STOP, не разрешать его затиранием Mac-исправлений.
4. Сохрани исходный patch fb97108 для владельца/Replit.

## Что изменено

Google-кнопка доступна в LiveDev. Вход на том же Dev-origin:
`/api/login/ios?client=chatdev`, возврат `talkhint-chatdev://auth`.
ASWebAuthenticationSession и проверка callback используют именно эту схему.
Рабочие сборки сохраняют старый `/api/login/ios` и `talkhint://auth`.
Info.plist использует build setting `TALKHINT_OAUTH_SCHEME`.
Dev регистрирует только `talkhint-chatdev`, не конкурируя с рабочей TalkHint.

Сервер принимает только фиксированный client=chatdev и только в development,
связывает выбор с браузерной OIDC-сессией до Passport rotation.
Произвольных redirect нет. Production-деплоя нет; Dev-вход в production запрещён.
Тот же Google/Replit-аккаунт, НЕ создавать пароль/новый аккаунт/админа.
Отдельная Dev-база может не содержать production-переписку; её не копировать.

## Проверка на Mac

Сверь Xcode/SDK/runtime/XcodeGen (последний отчёт: Xcode 26.5 / 17F42,
XcodeGen 2.45.4, Simulator 26.5). Без смены Apple Team/сертификатов.
Полный gate без фильтрации:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  bash ios/scripts/validate-native.sh
```

Обязателен verify-xcresult.py. Поимённый список —
`docs/chat-1a/MAC_REQUIRED_TESTS.md`, включая все 33 Chat-теста и прежние
регрессии. Прошлые 259 не считать проверкой нового HEAD.
Предупреждения Unbalanced calls сохранить/доложить, не скрывать.

Затем:

```sh
cd ios
xcodegen generate --spec project.yml
open TalkHint.xcodeproj
```

Отдельно собрать/запустить **TalkHintChatLiveDev**, не ChatPreview/TalkHint.
Native gate не компилирует LIVE_DEV, поэтому отдельная сборка обязательна.
Проверить resolved .app Info.plist: bundle `app.talkhint.chatdev`,
URL scheme ТОЛЬКО `talkhint-chatdev`. Обычная конфигурация сохраняет `talkhint`.
В Run оставить уже заданный HTTPS `.replit.dev` origin; никакого production fallback.

Открыть Simulator владельцу. Он сам нажимает Google, выбирает привычный аккаунт.
Подтвердить, что возвращается именно Dev-приложение. Проверить отмену входа,
загрузку истории, черновик/назад/возврат и перезапуск. Если домен не разрешён
провайдером или вход не проходит — STOP с кодом, не обходить авторизацию.
Не писать в отчёт cookies, пароли, токены или полный callback URL с токеном.

Вернуть HEAD/окружение, passed/failed/skipped, verify-xcresult, LiveDev build,
resolved scheme, крупный экран, результат реального входа и непроверенное.
Патч fb97108 приложить. Без Publish, Archive, TestFlight, AI/STT-запросов,
платных разговоров или изменения дизайна/навигации/боевых звонков.

## Что уже проверено в Replit

10 unit/HTTP OAuth-тестов (провайдер замокан), 1 тест изоляции ChatGPT auth.
37 Python Chat source checks в основном Dev, 28 на этой нативной базе.
Настоящий HTTPS Dev: неизвестный client — 400; chatdev — 302 на replit.com;
API чата без входа — 401. Dev-сервер перезапущен и работает.
Это НЕ проверка Google-входа владельца или iOS-сборки: их выполнить на Mac.
AI/STT и платные звонки не запускались. Полный серверный набор не повторялся.
