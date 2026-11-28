# Claude на Mac: контраст Settings и Tables

## Одна актуальная передача

Репозиторий: https://github.com/Sergalmazfas/Talk-Hint-VM.
Постоянная ветка: `xcode-chat-voice-sarah-2026-11-11`.
Рабочая копия: `~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency`.
База последнего Mac-отчёта: `58d92422d4c5af6af9dede0852acf8a01306c05d`.
Сохранение точной Mac-правки снимков: `779ded06cc34101cf54b43d4efed4b1a5b99cc28`.
Целевой код: `c0953323181f869a5aec5f07048f72a8b5c4cdee`.
После целевого кода в этом пакете только документация.
Заменяет docs/claude-mac-chat-menu-polish-handoff.md. Не запускать параллельно.

## Что уже известно и что изменено

Из предыдущего отчёта Mac: 46 XCTest passed, 0 failed, 0 skipped, обычный
TalkHint собран, но НЕ установлен из-за недоступности iPhone. Это прежний
результат, не проверка новой дельты.

1. Незакоммиченная Mac-правка drawHierarchy для Settings сохранена отдельным
   коммитом. Blob ChatNavigationTests.swift после её импорта:
   `0d05877c1b68344479e2c49aa928d14f6a9445e0` — совпадает с переданным diff.
   Assertions этого импорта не менялись. Не терять локальный diff.
2. В отдельной навигации чата явно заданы semantic title/largeTitle/back tint
   .label и background .systemBackground, для standard/scrollEdge/compact/
   compactScrollEdge. Никакого global UIAppearance и принудительной темы.
   Отчёт Mac о белом заголовке — основание для исправления; точный внутренний
   механизм выбора прежнего цвета UIKit не доказан.
3. При выключенной capability Tables переносится под Not connected yet в общую
   недоступную группу. При включённой capability остаётся рабочим вне группы.
   Capability не включается искусственно. Добавлен отдельный тест этого случая.
4. В существующем тесте Settings добавлены проверки semantic foreground/background
   для обеих тем во всех четырёх состояниях navigation bar.

Replit: 101 source-contract tests + 68 helper/source tests passed;
git diff --check passed. Новые XCTest, UIKit-снимки и сборка здесь НЕ выполнялись.
Прошлые снимки остались на Mac: переданные SHA без самих файлов не позволяют
Replit проверить изображение. Новые реальные снимки всё ещё нужны.

## Сохранить точную локальную правку перед fast-forward

Ниже разрешено убрать из рабочего файла ТОЛЬКО точную уже сохранённую Mac-правку,
после проверки полного blob и резервной копии. Это не разрешение откатывать
другие изменения. При несовпадении остановиться, ничего не перезаписывать.

```bash
set -euo pipefail
cd ~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency
ROOT="$PWD"
git branch --show-current
# Продолжать только на xcode-chat-voice-sarah-2026-11-11.
test "$(git branch --show-current)" = xcode-chat-voice-sarah-2026-11-11
git rev-parse HEAD
git status --short
git fetch --no-tags origin refs/heads/xcode-chat-voice-sarah-2026-11-11
git merge-base --is-ancestor 58d92422d4c5af6af9dede0852acf8a01306c05d FETCH_HEAD
git merge-base --is-ancestor 779ded06cc34101cf54b43d4efed4b1a5b99cc28 FETCH_HEAD

# Новый каталог для результатов; не затирать предыдущий xcresult.
OUT="$ROOT/generated-artifacts/menu-contrast-c0953323-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
TEST=ios/TalkHintTests/ChatNavigationTests.swift
STATUS="$(git status --porcelain)"
if [ -n "$STATUS" ]; then
  # Только известный unstaged файл; любые другие изменения — остановка.
  test "$STATUS" = " M $TEST"
  git diff --cached --quiet
  EXPECTED=0d05877c1b68344479e2c49aa928d14f6a9445e0
  test "$(git hash-object "$TEST")" = "$EXPECTED"
  test "$(git rev-parse "779ded06cc34101cf54b43d4efed4b1a5b99cc28:$TEST")" = "$EXPECTED"
  git diff --binary HEAD -- "$TEST" > "$OUT/snapshot-fix-before-update.diff"
  cp "$TEST" "$OUT/ChatNavigationTests-before-update.swift"
  test "$(git hash-object "$OUT/ChatNavigationTests-before-update.swift")" = "$EXPECTED"
  # Убирается только проверенная и дважды сохранённая локальная копия правки.
  # Входящий commit содержит ту же правку; другие файлы не затрагивать.
  git restore --source=HEAD -- "$TEST"
fi
git merge --ff-only FETCH_HEAD
git merge-base --is-ancestor c0953323181f869a5aec5f07048f72a8b5c4cdee HEAD
git diff --exit-code c0953323181f869a5aec5f07048f72a8b5c4cdee HEAD -- ios
git status --short
```

Не использовать stash/reset/rebase/force, не создавать ветку или worktree.
Если status не чистый после обновления или входящая iOS-дельта иная —
вернуть блокер. Не коммитить и не пушить от Mac для обхода несовпадения.
Не менять подпись/Team/SDK/Xcode/зависимости, не чистить DerivedData.

## Повторить 17 затронутых XCTest

15 ChatNavigationTests и два указанных ChatApprovedScreenTests.
Остальные 30 ранее успешных тестов этого пакета не менялись; их результат
не выдавать за новый прогон. Dictation/Outbox/Agata заново не запускать
без отдельной причины. Не запускать полный gate.

Использовать установленный runtime, один доступный симулятор и тёплый DD.
Если устройства нет, допустимо одно временное из уже установленного runtime,
без скачивания SDK. Не трогать чужие симуляторы.
SIM_ID и DD — фактические значения из существующего окружения.

```bash
(cd "$ROOT/ios" && xcodegen generate --spec project.yml)
COMMON=(-project "$ROOT/ios/TalkHint.xcodeproj" -scheme TalkHintValidation
  -configuration NativeValidation -sdk iphonesimulator
  -destination "platform=iOS Simulator,id=$SIM_ID" -derivedDataPath "$DD"
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual
  DEVELOPMENT_TEAM= PROVISIONING_PROFILE= PROVISIONING_PROFILE_SPECIFIER=
  "CODE_SIGN_ENTITLEMENTS=$ROOT/ios/scripts/native-validation.entitlements")
xcodebuild "${COMMON[@]}" build-for-testing 2>&1 | tee "$OUT/build-for-testing.log"
xcodebuild "${COMMON[@]}" test-without-building -parallel-testing-enabled NO \
  -testLanguage en -testRegion US \
  -only-testing:TalkHintTests/ChatNavigationTests \
  -only-testing:TalkHintTests/ChatApprovedScreenTests/testFullscreenHasLeadingMenuAndExitWithoutTabs \
  -only-testing:TalkHintTests/ChatApprovedScreenTests/testNativeLightAndDarkScreenshots \
  -resultBundlePath "$OUT/menu-contrast.xcresult" 2>&1 | tee "$OUT/tests.log"
```

Обязательные тесты, без skipped/expected failures:

ChatNavigationTests:
- testEntryInterceptsWithoutChangingPhoneTab
- testFullscreenChatIsRetainedAcrossExitAndReopen
- testBackAndDrawerUseDifferentActions
- testDrawerOpensExistingSettingsAndNativeBackReturns
- testDraftAndReadingPositionSurviveExitAndReopen
- testReadingAnchorSurvivesGrowthDuringReopen
- testExternalTabSelectionDoesNotDismissCallOverlay
- testCompactDrawerScrollsAndFutureDestinationsAreDisabled
- testPhoneScreensDoNotDuplicateSettingsOrChatMenu
- testDrawerDismissKeepsDraftAndSameChat
- testDrawerSeparatesUnavailableGroupAndRecentChats
- testComposerPlaceholderIsNotEditableTextOrDraft
- testOldConversationTitlesLoseOnlyLeadingHint
- testSettingsFullWidthLabelsAndLightDarkSnapshots
- testEnabledTablesStayOutsideUnavailableGroup

ChatApprovedScreenTests:
- testFullscreenHasLeadingMenuAndExitWithoutTabs
- testNativeLightAndDarkScreenshots

Сбой — остановиться и вернуть причину, не ослаблять тест.

## Проверить настоящие снимки

Извлечь и открыть Menu-grouping-1/2, Settings-full-labels-1/2.
Убедиться, что Settings действительно отрисован, темы различимы, заголовок
читается на светлом и тёмном фоне, отключённый Tables ниже подписи.
Меню длинное: Recent chats и My card/Plan/Help/About не объявлять проверенными
снимком, если они за пределами кадра. Положение также проверяет XCTest.
Не подменять новые изображения старыми; SHA-256 не заменяет просмотр.

Выполнить пропущенную в прошлом отчёте проверку больших системных шрифтов
на симуляторе: Settings labels/control и доступность прокрутки.
Если обнаружится дефект — вернуть его, не устанавливать плохую сборку.
Без production-логина, микрофона и внешних операций.

## Одна новая обычная сборка, установка и запуск

Дельта native-only; Publish не нужен, backend не менялся. Не использовать
собранный прежде binary — в нём нет этих двух app-исправлений.
После зелёных тестов — одна обычная TalkHint Debug, app.talkhint,
https://talkhint.app, прежние Team/cертификаты/entitlements, тёплый DEVICE_DD.

```bash
xcodebuild -project "$ROOT/ios/TalkHint.xcodeproj" -scheme TalkHint \
  -configuration Debug -sdk iphoneos \
  -destination "platform=iOS,id=$DEVICE_ID" -derivedDataPath "$DEVICE_DD" \
  build 2>&1 | tee "$OUT/device-build.log"
```

Если iPhone unavailable, допустима одна сборка под generic/platform=iOS
с той же обычной схемой и подписью. Затем сообщить, что установка не выполнена.
Не повторять сборку/опрос подключения бесконечно.

Установка поверх разрешена владельцем в текущем цикле, только при доступном
разблокированном iPhone и отсутствии активного звонка. Не завершать звонок
ради установки. Не удалять приложение, контейнер, историю, Keychain,
учётную запись или настройки, не выполнять logout. Смена подписи/Team —
блокер, а не повод переустановить с удалением. APP_PATH взять из новой сборки.

```bash
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"
xcrun devicectl device process launch --device "$DEVICE_ID" app.talkhint
```

Только обычный TalkHint, не AppDev/Archive/TestFlight.
Без сообщений, звонков, Play/Orb/Start/recovery, бронирований, Google OAuth
или Publish. EventKit/задачи/новый пункт Агаты в этом пакете не подключаются.

## Короткий результат

Вернуть HEAD, 17 passed/failed/skipped по именам, длительности тестов/сборки,
новые предупреждения, ссылки на новые снимки/логи, результат крупных шрифтов,
установка и запуск либо точный блокер. Отдельно отметить переиспользованный
предыдущий результат 30 тестов и то, что аудио/диктовка на iPhone не проверены.

На телефоне владельцу:
1. В светлой и тёмной теме Settings заголовок и полные подписи читаемы.
2. Отключённый Tables под Not connected yet; история чатов отдельно.
3. После установки аккаунт, чаты и настройки остались на месте.
