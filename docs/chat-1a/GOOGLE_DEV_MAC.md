# Google/Replit-вход в отдельный Dev-чат

Владелец пользуется существующим Google/Replit-входом, а не паролем TalkHint.
Новый аккаунт, пароль, перенос credentials и обход авторизации не нужны.

## Изменение

- Только ChatLiveDev: кнопка Google доступна, вход `/api/login/ios?client=chatdev`,
  callback `talkhint-chatdev://auth`.
- Другие конфигурации: прежний `/api/login/ios`, callback `talkhint://auth`.
- Info.plist использует build setting `TALKHINT_OAUTH_SCHEME`; Dev не регистрирует
  рабочую схему `talkhint`. Обычные сборки продолжают регистрировать её.
- Dev-сервер разрешает только фиксированный client `chatdev` при
  NODE_ENV=development. Выбор сохраняется в серверной OIDC-сессии, захватывается
  до ротации Passport и потребляется на callback. Произвольных redirect URL нет.
- Ошибка/отмена не сохраняет токен; успешный callback проверяется по scheme/host,
  затем `/api/auth/me` проверяет сессию на том же Dev-origin.
- Production не публикуется; запрос Dev-входа в production отклоняется.

## Claude на Mac — аддитивный перенос, не потерять fb97108

1. Покажи git status/HEAD. Сохрани текущую чистую Mac-ветку с fb97108.
   Этот Mac-коммит ещё не получен Replit как патч; НЕ заменять его тест старым.
2. Fetch штатного remote `Sergalmazfas/Talk-Hint-VM`, ветка
   `xcode-chat-live-dev-2026-11-07`. Получи её новый HEAD через ls-remote.
3. Проверь: новый native-коммит — прямой потомок 444fbee и содержит ТОЛЬКО
   описанную OAuth-дельту/инструкцию/source check.
4. На НОВОЙ локальной ветке от текущего Mac fb97108 cherry-pick только этот
   новый native-коммит. Не reset/rebase/force и не синхронизация всего дерева.
   При конфликте STOP, не затирать принятые Mac-исправления.
5. Полный validate-native.sh + verify-xcresult.py, затем xcodegen и отдельная
   сборка TalkHintChatLiveDev. Старые 259 тестов не считать проверкой нового HEAD.
6. Проверь resolved Info.plist в готовом .app: URL scheme ТОЛЬКО
   `talkhint-chatdev` для LiveDev, bundle app.talkhint.chatdev. Обычная схема
   TalkHint сохраняет `talkhint`. Не менять provisioning рабочего приложения.
7. Run с уже заданным HTTPS Dev-origin из схемы. Нажать кнопку Google должен
   владелец; он сам выбирает свой привычный аккаунт. Вернуться должно именно
   Dev-приложение. Пароли, callback URL с токеном, cookies в отчёт не сохранять.
8. Проверить отмену входа, успешный вход, настоящую историю, черновик/возврат.
   Если провайдер не разрешает Dev-domain или нет нужного пользователя —
   STOP с безопасным кодом ошибки; не создавать аккаунт/админа и не менять
   настройки production.
9. Вернуть HEAD, gate, сборку, resolved scheme и результат реального входа.
   Сам patch fb97108 также сохранить для переноса Replit.

AI/STT, платные звонки, Publish, Archive и TestFlight НЕ запускать.
Отдельная Dev-база может не содержать production-переписку; пустая история
сама по себе не означает неисправный вход. Не копировать production-данные.

## Границы проверки

Проверено в Replit: 10 unit/HTTP OAuth-тестов (провайдер замокан),
1 тест изоляции ChatGPT auth; 37 Python Chat source checks в основном Dev,
28 в тонкой Mac-ветке. Настоящий HTTPS Dev: неподдерживаемый client — 400,
chatdev — 302 на replit.com, API чата без авторизации — 401.
Dev workflow перезапущен, сервер поднялся. Никаких AI/STT-вызовов не было.
Общий полный серверный набор в этой задаче не перезапускался.

Replit проверяет серверную логику и Dev HTTP-маршрут без Google-аккаунта владельца.
Успешный вход в ASWebAuthenticationSession и разрешения macOS/iOS проверяются
только на Mac с участием владельца. Здесь нельзя объявить их пройденными.

## Proposed-урок проверяющему

Было: отдельный клиент проверили password-auth, но владелец входит через Google.
Узнали: работоспособность API не доказывает доступность привычного входа.
В следующий раз: до передачи проверять способ входа владельца и изоляцию
OAuth callback при совместной установке Dev/рабочего приложения.
Статус proposed; не принят автоматически, в production-книжки не записан.
