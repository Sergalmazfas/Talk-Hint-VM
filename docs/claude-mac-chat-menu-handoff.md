# Claude на Mac: боковое меню чата и единые настройки

## Одна актуальная передача

Репозиторий https://github.com/Sergalmazfas/Talk-Hint-VM.
Постоянная ветка `xcode-chat-voice-sarah-2026-11-11`.
Существующая копия `~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency`.
База: `0f768e9d5248ab13f7748f2c6c3a2572225bc596`.
Целевой commit iOS-кода: `0312553006f9182b91bec661afe8fb282db7a906`.
После него — только документация.

Это задание заменяет прежнюю передачу Агаты, чтобы не делать две установки.
Если прежний прогон уже выполняется, не запускать второй параллельно.
Сначала сообщить его состояние и сохранить результаты; не убивать процессы
и не устанавливать старый binary поверх более нового. Успешные 15 AgataTests
можно повторно не запускать, если есть отчёт на d6f1557/0f768e9d и соответствующие
Agata-исходники/тесты не изменились. Иначе они входят в этот пакет.

## Что согласовал владелец

- Меню открывается только из Chat, слева кнопкой «две короткие линии с точкой»
  по присланному образцу IMG_4834. Синяя точка декоративная, не индикатор сообщений.
- Прежний полноэкранный Chat сохраняется. Для выхода справа отдельный крестик
  с прежним действием возврата; нижние вкладки не появляются внутри чата.
- Общие Settings открываются только из бокового меню. Шестерёнка убрана из
  общего HomeViewController (Hint/Translator/Secretary), другого входа там нет.
- SettingsViewController, SessionStore, параметры и их сохранение НЕ менялись.
- Панель слева, затемнение справа; закрытие по фону, кнопкой и свайпом влево.
  Новый чат и история работают прежними средствами. Таблицы — по прежней capability.
  Calendar/Mail/прочие будущие разделы недоступны, с общим пояснением.
  Само наличие пункта не разрешает OAuth, Calendar, Gmail или другое действие.
- Настройки закреплены внизу, список прокручивается, минимум hit target 44 pt,
  ширина адаптивна, поддержаны семантические цвета, VoiceOver и Reduce Motion.
- Запись, диктовка, звонки, аудио, Агата и backend этой дельтой не изменялись.
  Новая реализация меню доступна также в approvedReference, где прежде было
  специально отключённое многоточие. Поэтому соответствующая проверка обновлена:
  она теперь требует рабочее меню, а не отсутствие действия.

## Что действительно проверил Replit

- 92 source-contract tests из ios/tests — passed.
- 68 helper/source tests из ios/scripts/tests — passed.
- git diff --check — passed.
- Единственный SettingsViewController(...) в app-коде — переход из Chat.
- Swift, UIKit, XCTest и вид на устройстве здесь НЕ проверены: Linux без Xcode.
  Прямой вызов verify-project-sources.py без аргументов не является проверкой
  включения Swift-файлов; это проверяется после XcodeGen на Mac.

Новый ChatMenuButton.swift должен автоматически включиться через существующий
source glob project.yml. Не править pbxproj вручную.

## Получение кода

```bash
cd ~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency
git status --short
git branch --show-current
git rev-parse HEAD
# Только чистая правильная копия, иначе остановиться без stash/reset.
git fetch --no-tags origin refs/heads/xcode-chat-voice-sarah-2026-11-11
git merge --ff-only FETCH_HEAD
git merge-base --is-ancestor 0f768e9d5248ab13f7748f2c6c3a2572225bc596 HEAD
git merge-base --is-ancestor 0312553006f9182b91bec661afe8fb282db7a906 HEAD
git diff --exit-code 0312553006f9182b91bec661afe8fb282db7a906 HEAD -- ios
python3 -m unittest discover -s ios/tests -p 'test_*source_contract.py'
python3 -m unittest discover -s ios/scripts/tests -p 'test_*.py'
```

Никаких reset/rebase/force, удаления данных/Keychain, новой ветки/worktree,
смены Team/cертификатов/SDK, обновления зависимостей, очистки DerivedData.
Не создавать AppDev, Archive или TestFlight.

## Сервер

Эта дельта меню — native-only, нового Publish не требует.
Входящая в binary прежняя дельта Агаты зависит от 51fa3de0. Владелец уже
сделал Publish; Replit подтвердил production
`d03c42659e308c04343aa826f2394611a93ee651`, dbConnected=true, dirty=false,
и включение 51fa3de0 по истории Git.
Перед устройством допустим только GET https://talkhint.app/api/build.
Если версия иная и включение исправления не подтверждено — запросить сверку
у Replit, не публиковать native-ветку и не угадывать по дате.

Нельзя вызывать production recovery или открывать Агату ради проверки сервера.

## Целевые XCTest и одна сборка

Использовать действующие Xcode, runtime, симулятор и тёплые DerivedData.
Если доступного симулятора нет — одно временное устройство из установленного
runtime, без скачивания SDK и удаления чужих устройств.
ROOT/DD/SIM_ID/OUT — фактические локальные значения; OUT новый под
generated-artifacts/, не перезаписывать прежние xcresult.

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
  -only-testing:TalkHintTests/ChatAgataTests \
  -resultBundlePath "$OUT/ChatMenu.xcresult" 2>&1 | tee "$OUT/tests.log"
```

Если прежние 15 AgataTests доказанно passed на неизменённых исходниках, убрать
только их -only-testing и сообщить, что здесь прогнаны 22, а 15 переиспользованы.
Не выдавать прежний результат за новый.

Обязательные 10 ChatNavigationTests:

1. testEntryInterceptsWithoutChangingPhoneTab
2. testFullscreenChatIsRetainedAcrossExitAndReopen
3. testBackAndDrawerUseDifferentActions
4. testDrawerOpensExistingSettingsAndNativeBackReturns
5. testDraftAndReadingPositionSurviveExitAndReopen
6. testReadingAnchorSurvivesGrowthDuringReopen
7. testExternalTabSelectionDoesNotDismissCallOverlay
8. testCompactDrawerScrollsAndFutureDestinationsAreDisabled
9. testPhoneScreensDoNotDuplicateSettingsOrChatMenu
10. testDrawerDismissKeepsDraftAndSameChat

Обязательные 12 ChatApprovedScreenTests:

1. testComposerFullWidthAndControlsBelowAt320
2. testStreamingWidthIsStableAndProgressIsNotDuplicated
3. testEmptyFailedReplyHasNoEmptyBubble
4. testPlanStartsCompactAndReplacementDisablesOldCard
5. testReadingAnchorSurvivesGrowthAboveIt
6. testApprovedTypographyIsOptInAndReadable
7. testUnavailableReadAloudKeepsDisabledButtonAndVisibleReason
8. testFullscreenHasLeadingMenuAndExitWithoutTabs
9. testSeparateOrbAndLargeControlsFitSmallScreen
10. testNativeLightAndDarkScreenshots
11. testRecordingAndRecognitionUseExistingBarWithoutAudio
12. testKeyboardEditingScreenshotAndDraftRemainEditable

При необходимости все 15 ChatAgataTests — поимённый список в прежнем
docs/claude-mac-agata-recovery-handoff.md; его запрет на этап Mac не отменяет
явного разрешения владельца в сопровождающем сообщении, но никаких реальных
Agata/Retell запросов не разрешает.

Итого 37 методов либо 22 новых + отдельно подтверждённые прежние 15.
Все используют offline fixtures. Failed/missing/skipped или ошибка компиляции —
остановка до установки, без ослабления assertions. Частичный xcresult не
проверять как полный gate. Остальные неизменённые тесты не повторять.
Приложить реальные UIKit-снимки Chat-menu-light-native и Chat-menu-dark-native
из xcresult. Проверить, что настройки видны на маленьком экране, а меню не
перекрывает кнопку выхода без доступного способа закрыть панель.

После зелёных тестов — одна обычная сборка:

```bash
xcodebuild -project "$ROOT/ios/TalkHint.xcodeproj" -scheme TalkHint \
  -configuration Debug -sdk iphoneos \
  -destination "platform=iOS,id=$DEVICE_ID" -derivedDataPath "$DEVICE_DD" \
  build 2>&1 | tee "$OUT/device-build.log"
```

Проверить app.talkhint, https://talkhint.app, прежнюю подпись/Team/callback,
не AppDev/NativeValidation. APP_PATH взять из фактического build output.
Установка только с разрешения владельца и при отсутствии активного звонка:

```bash
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"
xcrun devicectl device process launch --device "$DEVICE_ID" app.talkhint
```

Не открывать Orb/Play/Start и не отправлять сообщения.

## Короткий отчёт и проверка владельца

Вернуть HEAD, поимённые passed/failed/skipped, длительности, ссылки на логи и
снимки, факт установки либо блокер, новые предупреждения. Не объявлять
реальные аудио/микрофон/Bluetooth проверенными по этим fixtures.

Владельцу после разрешённой установки:
1. В Hint нет шестерёнки. В Chat слева круглая кнопка с двумя линиями и точкой;
   справа крестик возвращает в прежний раздел.
2. Меню открывается слева; фон/свайп/закрытие работают. Settings открывает
   прежний экран; назад возвращает тот же чат с черновиком и местом чтения.
3. Calendar/Mail и другие неподключённые пункты не обещают выполненных действий.
   Меню проверить в светлой/тёмной теме без запуска Агаты или звонков.
