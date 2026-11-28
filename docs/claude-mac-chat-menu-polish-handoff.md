# Claude на Mac: три исправления перед календарём

## Актуальное задание

Репозиторий: https://github.com/Sergalmazfas/Talk-Hint-VM.
Постоянная ветка: `xcode-chat-voice-sarah-2026-11-11`.
Существующая копия: `~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency`.
Базовый commit: `1a724d1d1072229c2f56935f9e37c371976ca874`.
Целевой commit кода: `c278e9f7c7926d0d0aaf96aed384995f52b61be6`.
После него в этом пакете только документация.

Это задание заменяет прежнее docs/claude-mac-chat-menu-handoff.md.
Владелец принял меню на iPhone, затем попросил три конкретные правки,
тесты, light/dark снимки и установку поверх без потери данных.
Не запускать старое и новое задания параллельно. Если уже идёт сборка,
сохранить её состояние и результаты, не убивать процессы и не устанавливать
старый binary поверх нового.

## Только текущий этап

1. Все недоступные пункты собраны в одну группу. Над ней короткая локализованная
   подпись `Not connected yet`. `Recent chats` — отдельный блок только с чатами.
   My card / Plan / Help / About находятся в недоступной группе, не среди чатов.
   Settings остаются закреплены внизу.
2. Placeholder перенесён из editable text в отдельный декоративный UILabel
   внутри ChatComposerTextView. В текст, черновики и новые отправки он больше
   не вставляется. Диктовка получает только реальный черновик.
   Старые названия с ведущим placeholder очищаются только при отображении.
   Сохранённые сообщения и серверные названия НЕ переписываются.
3. Три строки Translator Settings используют полноширинную подпись с переносом,
   а сегментированный переключатель ниже неё. Действия и сохранённые значения
   прежние. Таблица self-sizing.

Новые Swift-файлы включаются штатным glob XcodeGen:
ChatComposerTextView.swift, ChatConversationTitle.swift. Не редактировать
pbxproj вручную.

Календарь, задачи и новый пункт входа в Агату ЭТИМ пакетом ещё НЕ подключены.
Это намеренно отдельный следующий этап: владелец потребовал сначала исправить
эти ошибки. Для будущего календаря выбран EventKit на iPhone без сервера;
Google Calendar позже отдельно. Задачи должны включать личные и поручения.
Не добавлять эти функции в Mac-задание самостоятельно.

## Что Replit действительно проверил

- 98 source-contract tests из ios/tests — passed.
- 68 helper/source tests из ios/scripts/tests — passed.
- git diff --check — passed.
- Backend, параметры модели/голоса, действующие звонки и серверное хранилище
  не менялись. Никакого Publish для этой native-only дельты не нужно.
- XCTest, компиляция Swift и новые UIKit-снимки на Linux НЕ выполнялись.
  Не выдавать исходниковые проверки за их успешный результат.

## Чистота копии и получение кода

```bash
cd ~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency
git status --short
git branch --show-current
git rev-parse HEAD
# Только правильная чистая копия; иначе остановиться без stash/reset.
git fetch --no-tags origin refs/heads/xcode-chat-voice-sarah-2026-11-11
git merge --ff-only FETCH_HEAD
git merge-base --is-ancestor 1a724d1d1072229c2f56935f9e37c371976ca874 HEAD
git merge-base --is-ancestor c278e9f7c7926d0d0aaf96aed384995f52b61be6 HEAD
git diff --exit-code c278e9f7c7926d0d0aaf96aed384995f52b61be6 HEAD -- ios
```

Не делать reset/rebase/force, не создавать ветку/worktree, не очищать кэши,
не менять Xcode/SDK/Team/сертификаты/зависимости. Сохранить чужие изменения.
Если удалённая ветка ушла вперёд и diff ios не пуст, сначала вернуть состав
новой дельты Replit, не перетирать её.

## Целевые проверки, без полного gate

46 обязательных XCTest: 14 ChatNavigationTests, 12 ChatApprovedScreenTests,
16 ChatDictationTests и 4 ChatOutboxTests. Они изолированы от сети,
платной генерации, микрофона и реальных звонков. Не добавлять живые пробы
Агаты. Не повторять прежние неизменённые AgataTests без новой причины.

Использовать существующий Xcode, доступный runtime, один симулятор и тёплый
DerivedData. Если симулятора нет, допустимо одно временное устройство
из установленного runtime без скачивания SDK и удаления чужих устройств.
ROOT, DD, SIM_ID, OUT — фактические локальные значения. OUT новый под
generated-artifacts/, не перезаписывать прежние результаты.

```bash
set -euo pipefail
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
  -only-testing:TalkHintTests/ChatApprovedScreenTests \
  -only-testing:TalkHintTests/ChatDictationTests \
  -only-testing:TalkHintTests/ChatOutboxTests \
  -resultBundlePath "$OUT/chat-menu-polish.xcresult" 2>&1 | tee "$OUT/tests.log"
```

Ни один обязательный тест нельзя принять со skipped/ожидаемым падением.
Сбой — остановиться и вернуть конкретную ошибку; не ослаблять assertions.
Новые тесты зарегистрированы в verify-xcresult.py. Для проверки полного
инвентаря ниже учитывать все 46 тестов, не только старый минимальный gate.

### ChatNavigationTests — 14

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

### ChatApprovedScreenTests — 12

- testComposerFullWidthAndControlsBelowAt320
- testStreamingWidthIsStableAndProgressIsNotDuplicated
- testEmptyFailedReplyHasNoEmptyBubble
- testPlanStartsCompactAndReplacementDisablesOldCard
- testReadingAnchorSurvivesGrowthAboveIt
- testApprovedTypographyIsOptInAndReadable
- testUnavailableReadAloudKeepsDisabledButtonAndVisibleReason
- testFullscreenHasLeadingMenuAndExitWithoutTabs
- testSeparateOrbAndLargeControlsFitSmallScreen
- testNativeLightAndDarkScreenshots
- testRecordingAndRecognitionUseExistingBarWithoutAudio
- testKeyboardEditingScreenshotAndDraftRemainEditable

### ChatDictationTests — 16

- testFallbackWavIsMono16kAndContainsAllCaptureBuffersWithoutMicrophone
- testPartialHypothesisReplacesOnlyCapturedSelectionWithoutSending
- testPartialDoesNotChangeOriginalDraftOrAcceptFinalWithoutStop
- testPermissionAndRecordingAreSingleFlight
- testDeniedOrCancelledPermissionCannotStartLate
- testStopAndRetryCannotDuplicateActiveRecognition
- testRecognitionOnlyProducesEditableTextNotSend
- testExistingDraftIsNotOverwritten
- testSelectedTextAndUTF16AreHandled
- testSilencePreservesCaptureAndRequiresExplicitRetry
- testErrorDoesNotAutomaticallyRetry
- testCancelMakesLateNetworkResultInert
- testDifferentOwnerConversationOrDraftRevisionCannotReceiveResult
- testDraftAndAttachmentRestoreIsOwnerAndOriginScoped
- testBarCancelStopAndRetryAreSeparateWithoutAudio
- testOrbStaysDisabledAndComposerHasSeparateMicrophone

### ChatOutboxTests — 4

- testSessionScopeNeverAuthorizesAnotherOrMissingOwner
- testOutboxIsOwnerAndOriginScopedAndKeepsIdempotencyKey
- testMergeUpdatesExistingAndOrdersBySequence
- testMergeReconcilesCanonicalLowercaseClientRequestId

## Настоящие light/dark снимки

Извлечь вложения XCTest: Menu-grouping-1 (light), Menu-grouping-2 (dark),
Settings-full-labels-1 (light), Settings-full-labels-2 (dark).
Также проверить Chat-menu-light-native / Chat-menu-dark-native и редактор
на компактном экране 320 pt. Это UIKit fixtures, не production-скриншоты.
Если снимок не показывает нужные строки из-за прокрутки/анимации, исправить
сценарий снимка и вернуть честный результат, а не выдавать старое изображение.
Проверить большие системные шрифты вручную в симуляторе без входа в аккаунт
и без внешней сети; старые значения настроек тестами не сбрасывать.

## Одна обычная сборка и установка поверх

После зелёных тестов собрать обычный TalkHint Debug для имеющегося iPhone,
с прежней подписью и сервером https://talkhint.app, app.talkhint.
Не AppDev, Archive или TestFlight.

```bash
xcodebuild -project "$ROOT/ios/TalkHint.xcodeproj" -scheme TalkHint \
  -configuration Debug -sdk iphoneos \
  -destination "platform=iOS,id=$DEVICE_ID" -derivedDataPath "$DEVICE_DD" \
  build 2>&1 | tee "$OUT/device-build.log"
```

Владелец в текущем сообщении явно запросил установку поверх с сохранением данных.
Проверить отсутствие активного звонка; не завершать его ради установки.
Сохранить bundle ID, Team, контейнер приложения, Keychain и сессию пользователя.
Никакого uninstall, logout, удаления приложения/контейнера/истории, сброса
настроек или переустановки под другой подписью. Если без этого нельзя —
сообщить блокер. APP_PATH — из фактического build output.

```bash
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"
xcrun devicectl device process launch --device "$DEVICE_ID" app.talkhint
```

Не отправлять сообщения от владельца. Не нажимать Orb/Start/Play,
не вызывать recovery, не делать звонки, бронирования, письма или Publish.

## Что вернуть и что проверить владельцу

Коротко: HEAD, passed/failed/skipped 46 тестов, длительность тестов/сборки,
ссылки на логи и четыре новых снимка, новые предупреждения, установка/запуск
или конкретный блокер. Отдельно: реальная диктовка и аудио на iPhone тестами
не проверялись; календарь/задачи/новый вход в Агату ещё не подключены.

После установки владельцу проверить:
1. `Not connected yet` над всей серой группой; Recent chats содержит только
   чаты. Settings по-прежнему закреплены внизу.
2. Старое название `Write a message… прикк век но` показано без подсказки;
   в пустом поле подсказка видна, но при редактировании не становится текстом.
3. В Settings подписи Translation Playback и Voice provider полностью видны
   над переключателями в light/dark. Аккаунт, история и настройки сохранились.
