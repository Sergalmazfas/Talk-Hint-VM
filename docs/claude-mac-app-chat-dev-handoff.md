# Claude на Mac: полное TalkHint с Chat в Dev

Владелец выбрал «Всё приложение с Chat» и «Xcode собираем через Claude».
Репозиторий https://github.com/Sergalmazfas/Talk-Hint-VM,
ветка `xcode-app-chat-dev-2026-11-09`, parent новой дельты —
`15a58210834efe7efa7b8a1609230e535782cca7`. Новый HEAD сверить через ls-remote.

## Сохранить Mac, перенести только новую дельту

1. Показать worktree/ветку/HEAD, git status, свободное место. При dirty STOP.
2. Сохранить успешную Mac-ветку после Google-проверки. На ней должны быть
   15a5821 и локальный fb97108. Если нет — STOP, неизвестные фиксы не воссоздавать.
3. Fetch штатного remote. У новой ветки ровно один коммит после 15a5821;
   если история другая — STOP.
4. Создать НОВУЮ локальную ветку от ТЕКУЩЕГО успешного Mac HEAD.
   Cherry-pick только новую дельту после 15a5821. НЕ заменять Mac checkout
   remote-деревом, не терять fb97108. Без stash/reset/rebase/force.
   Конфликт — STOP, не затирать утверждённые исправления.
5. Сохранить patch fb97108 и последующих Mac-only изменений для Replit.

## Что поменялось

Новая схема **TalkHintAppDev**, конфигурация AppDev: полный существующий shell
Hint / Translator / Chat / Secretary / History, без Copilot в центральном входе.
После Google-входа — номеронабиратель, не отдельный чат.
Chat открывает принятый approvedReference в retained full-screen navigation,
без нижних вкладок внутри. Back возвращает на прежнюю вкладку.
Реальные API/outbox/диктовка/вложения и дизайн не переписаны.

Тот же изолированный bundle `app.talkhint.chatdev` и callback `talkhint-chatdev`:
новая сборка обновляет Dev-приложение, сохраняя его вход и черновики;
не заменяет рабочую `app.talkhint`. Не удалять Dev-данные.
Старые TalkHintChatLiveDev/ChatPreview и обычная TalkHint сохранены —
НЕ запускать их для этой проверки: у них другие начальные экраны.
Обычный Mac TalkHint всё ещё имеет историческую панель Copilot.

Узкий guard не позволяет считать Chat-shell аудиорежимом Copilot по индексу 2.
Телефонные обработчики/настройки не заменены. Автоматический старт PushKit/
APNs/CallKit остаётся выключенным в Dev как в LiveDev. Это полная навигация,
не утверждение о работоспособности живой телефонии. Звонки не запускать,
push не активировать, Team/certificates/production не менять.

## Gate и сборка — выполняет Claude на Mac

Сверить Xcode/SDK/runtime/XcodeGen. Последний отчёт: Xcode 26.5 (17F42),
XcodeGen 2.45.4, SDK/Simulator 26.5. Не менять Xcode/symlink и не чистить
кэши без необходимости.

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  bash ios/scripts/validate-native.sh
```

Полный TalkHintTests без фильтрации, verify-xcresult.py обязателен.
Сохранить поимённые регрессии `docs/chat-1a/MAC_REQUIRED_TESTS.md`, все
33 прежних Chat-теста плюс два новых:

- ChatAppShellTests.testFullAppUsesChatInTheExistingFiveTabShell
- ChatAppShellTests.testBuildingShellDoesNotStartChatRequests

Старые 259 не заменяют новый gate. Не ослаблять проверки/таймеры.
Unbalanced calls и другие предупреждения сохранить/доложить.

Затем:

```sh
cd ios
xcodegen generate --spec project.yml
open TalkHint.xcodeproj
```

Выбрать **TalkHintAppDev**, arm64 iPhone Simulator, Run.
ОТДЕЛЬНЫЙ BUILD SUCCEEDED обязателен: gate NativeValidation не компилирует AppDev.
Проверить resolved настройки и .app: AppDev, `app.talkhint.chatdev`,
продукт `TalkHintAppDev`, DEBUG + TALKHINT_CHAT_LIVE_DEV + TALKHINT_APP_DEV,
URL scheme ТОЛЬКО `talkhint-chatdev`. HTTPS `.replit.dev` origin из схемы;
production URL и auth bypass запрещены.

## Показать владельцу и проверить без платных запросов

- После входа — номеронабиратель, пять вкладок и Chat в центре.
- Остальные вкладки/настройки открываются как раньше, звонки не начинать.
- Chat — принятый крупный экран, без нижней панели, Google-вход сохранён.
- Черновик без отправки → Back → прежняя вкладка → Chat: тот же текст,
  экземпляр/позиция чтения. Перезапуск сохраняет вход и черновик.
- Клавиатура маленького Simulator: ввод виден над ней, Back не отправляет
  сообщение/STT; Orb остаётся неактивным.
- Проверить offline nav/call-overlay тесты, но не выдавать их за звонок.
- Если Google-домен не разрешён/вход не проходит — STOP, не создавать аккаунт.
- Подтвердить реально запущенные bundle/config, не только похожую иконку.

Без AI/STT/платных звонков/репетиций, Publish, Archive, TestFlight.
На iPhone пока не устанавливать без отдельного согласования устройства/подписи.
Dev-история не обязана содержать production-чаты; личные данные не копировать.

## Вернуть

HEAD/ветку, Xcode/XcodeGen/SDK/runtime, passed/failed/skipped, verify-xcresult,
AppDev build/resolved settings, warnings, результаты ручных пунктов и блокеры.
КРУПНЫЕ снимки: главный экран с Chat, полноэкранный чат, возврат, клавиатура
на маленьком экране. Без токенов/паролей/личной переписки.
Patch fb97108 и новых фиксов приложить. Никакого push/merge в main.

Replit не имеет Xcode и не объявляет эту новую сборку проверенной на iPhone.
Прежний успешный Google-login/relaunch относился к отдельному LiveDev.
Пройдены source checks: основной Dev 37+4; эта Mac-база 28+4.
diff --check чистый; SHA256 PreparedHintPlansTests/SecretaryPersonalityUITests
совпадают с ранее принятыми; утверждённый ChatViewController не менялся.
Два новых XCTest только добавлены, их выполнение — на Mac.

Proposed-урок проверяющему: перед показом подтверждать bundle/configuration
и проверять и главный экран, и чат. Успех отдельного чата не доказывает его
интеграцию в полное приложение. Не принимать урок автоматически.
