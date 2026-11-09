# Claude на Mac: собрать полное TalkHint с Chat в Dev

## Решение владельца

Владелец выбрал «Всё приложение с Chat» и уточнил: «Xcode собираем через Claude».
Подготовить полное существующее приложение в Simulator, не отдельный ChatPreview.
Не редизайнить экраны. Никаких платных звонков/репетиций, AI/STT-запросов,
production-деплоя, Archive и TestFlight. На iPhone пока не устанавливать без
согласования устройства/подписи. Существующий рабочий iPhone-клиент не заменять.

Репозиторий: https://github.com/Sergalmazfas/Talk-Hint-VM
Ветка доставки: `xcode-app-chat-dev-2026-11-09`.
База: `15a58210834efe7efa7b8a1609230e535782cca7`.
Точный HEAD новой дельты получить через `git ls-remote`.

## Не потерять Mac-исправления

На Mac есть локальный fb97108 и успешная проверка Google-входа поверх 15a5821.
Точный текущий Mac HEAD Replit из последнего отчёта неизвестен.
Поэтому НЕ заменять Mac checkout новой remote-веткой целиком.

1. Покажи ветку, HEAD, git status, текущий worktree и свободное место.
2. При незакоммиченных изменениях STOP. Без stash/reset/rebase/force.
3. Сохрани текущую Mac-ветку. Проверь, что 15a5821 и fb97108 входят в её историю.
   Если нет — STOP с причиной, не восстанавливать неизвестное «по описанию».
4. Fetch штатного remote. Проверь новый remote HEAD и что его parent = 15a5821.
5. Создай новую локальную ветку от ТЕКУЩЕГО успешного Mac HEAD и cherry-pick
   ТОЛЬКО новый коммит после 15a5821. Если появились дополнительные remote
   коммиты или конфликт — STOP. Не затирать принятые тесты/исправления.
6. Сохрани patch fb97108 и последующие Mac-only исправления для возврата Replit.

## Реализация в дельте

- Новая конфигурация AppDev / схема **TalkHintAppDev**.
- Использует тот же bundle `app.talkhint.chatdev` и `talkhint-chatdev://`:
  обновляет ранее проверенную Dev-установку с сохранением её входа и черновиков.
  Рабочую установку `app.talkhint` не заменяет.
- Явный HTTPS Dev-origin из схемы, без fallback на production.
- После Google/Replit-входа открывается обычный номеронабиратель с пятью
  вкладками: Hint / Translator / Chat / Secretary / History.
- Центр Chat — вход в retained full-screen navigation; нижней панели внутри
  чата нет. Назад возвращает на прежнюю вкладку, не на Login.
- Чат использует тот же проверенный реальный API, owner/origin-scoped outbox,
  approvedReference appearance, диктовку и вложения. Сервер не переписан.
- Старые ChatPreview и TalkHintChatLiveDev сохранены. Для этой проверки
  НЕ запускать их и НЕ запускать обычную TalkHint, где историческая Mac-база
  по-прежнему имеет Copilot.
- Узкая защита incoming-mode: Chat-shell не считается Copilot по индексу 2.
  Старые аудио/телефонные обработчики и настройки не заменены.
- Автоматический старт PushKit/APNs/CallKit остаётся исключён для Dev-схемы,
  как в LiveDev. Наличие всех экранов НЕ является проверкой живой телефонии.
  Не включать push/живые звонки, не менять Team/certificates/production.

## Полный Xcode gate — обязателен

Последний известный Mac: Xcode 26.5 (17F42), XcodeGen 2.45.4,
SDK/Simulator 26.5. Сверь актуальные версии; не переименовывай Xcode и
не создавай подменяющие symlink. Кэши без необходимости не удалять.

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  bash ios/scripts/validate-native.sh
```

Полный TalkHintTests без фильтрации, verify-xcresult.py обязателен.
Все прежние тесты/регрессии сохранить. Поимённый обязательный список:
`docs/chat-1a/MAC_REQUIRED_TESTS.md` плюс:

- `ChatAppShellTests.testFullAppUsesChatInTheExistingFiveTabShell`
- `ChatAppShellTests.testBuildingShellDoesNotStartChatRequests`

Старые 259 результатов не заменяют новый gate; добавлены ещё два XCTest.
Существующие ChatNavigationTests проверяют fullscreen, back/reopen, draft/scroll,
Settings return и внешний call-overlay. Не ослаблять assertions/тайм-ауты.
Unbalanced calls и другие предупреждения сохранить и доложить.

## Затем отдельная сборка полного Dev-приложения

```sh
cd ios
xcodegen generate --spec project.yml
open TalkHint.xcodeproj
```

Выбрать **TalkHintAppDev**, arm64 iPhone Simulator, Run.
Gate NativeValidation не компилирует AppDev: отдельный BUILD SUCCEEDED обязателен.
Проверить resolved settings и готовый .app:

- конфигурация AppDev;
- bundle `app.talkhint.chatdev`, продукт `TalkHintAppDev`;
- флаги DEBUG, TALKHINT_CHAT_LIVE_DEV, TALKHINT_APP_DEV;
- URL scheme ТОЛЬКО talkhint-chatdev;
- Dev-origin из Run Environment (не production).

Не удалять старую Dev-установку/данные для установки новой.
Не ориентироваться только на одинаковую иконку TalkHint: подтвердить реально
запущенный bundle/конфигурацию. Показать владельцу правильное окно Simulator.

## Неплатная ручная проверка

1. После входа — номеронабиратель и пять прежних вкладок, центр Chat.
2. Hint/Translator/Secretary/History открываются как раньше, звонки не запускать.
3. Chat — принятый крупный экран, без нижней панели. Google-вход остаётся рабочим.
4. Набрать черновик, не отправлять. Назад → прежняя вкладка → Chat:
   тот же черновик/экземпляр, позиция чтения не сбрасывается.
5. Перезапуск: авторизация сохраняется, после входа/старта полный shell,
   после открытия Chat черновик на месте.
6. Клавиатура на маленьком Simulator: ввод над клавиатурой, Back работает;
   закрытие не запускает отправку/STT. Orb неактивен.
7. Навигация не назначает Chat аудиорежимом Copilot; offline-тесты и код
   маршрутизации проверить, но не выдавать это за реальный звонок.

История Dev отдельно от production. Не копировать личные production-данные.
Обычное чтение API разрешено; сообщения, STT и звонки не отправлять автоматически.

## Что вернуть

Mac HEAD/ветку, Xcode/XcodeGen/SDK/runtime, gate passed/failed/skipped,
verify-xcresult, отдельный AppDev build, resolved bundle/config/scheme.
КРУПНЫЕ снимки: весь номеронабиратель с Chat в центре; открытый Chat без
вкладок; возврат; клавиатура на маленьком экране. Без личной переписки/токенов.
Результат каждого ручного пункта, предупреждения, непроверенные возможности.
Patch fb97108 и любых новых исправлений, без самостоятельного push в main.
Если gate/сборка не прошли — причина/логи, не говорить «готово».

## Проверено Replit / что НЕ проверено

Пройдены 37 прежних и 4 новых source checks основного Dev; 28 прежних и
4 новых source checks тонкой Mac-ветки. diff --check чистый.
PreparedHintPlansTests и SecretaryPersonalityUITests в Mac-базе сохранили
ранее принятые SHA256; код утверждённого ChatViewController не менялся.
Два новых XCTest только добавлены — они должны быть выполнены на Mac.

Replit проверяет source contracts и неизменность принятых файлов, но не имеет
Xcode/iOS runtime. XCTest и настоящий вид новой AppDev-сборки ещё не проверены.
Успешные Google-вход, черновик и relaunch были проверены владельцем/Claude
на предыдущей отдельной TalkHintChatLiveDev, не доказывают новую AppDev-сборку.

## Proposed-урок проверяющему

Было: владелец видел старую навигацию, хотя отдельный Dev-чат был работоспособен.
Узнали: отдельный preview/live-chat и полное приложение — разные сборки.
Действовать: перед показом подтвердить configuration/bundle и сфотографировать
как главный экран, так и открытый чат. Статус proposed, без автоматической приёмки.
