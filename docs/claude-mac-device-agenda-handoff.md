# Claude на Mac: календарь, задачи и вход в Агату

## Код и существующая копия

Репозиторий: https://github.com/Sergalmazfas/Talk-Hint-VM.
Удалённая постоянная ветка: `xcode-chat-voice-sarah-2026-11-11`.
Существующая копия: `~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency`.
База принятой на iPhone версии: `ba6393a89ad2be215d4764ce312f30f5b274edf6`.
Целевой код: `d407c7cc64d43f6caa0d248010fdb579030f5a42`.
После него в пакете только документация.

По последнему Mac-отчёту локальная ветка называется
`mac-agata-trickle-e537741`. Имя НЕ менять; проверять HEAD, ancestry,
чистоту копии и fast-forward, а не совпадение локального имени с remote.
Заменяет предыдущую передачу menu-contrast. Параллельные задания не запускать.

## Что выбрал владелец

- Calendar — календарь iPhone через EventKit, без сервера.
- Личные задачи — «Напоминания iPhone», не отдельное хранилище TalkHint.
- Задачи включают личные и существующие поручения Секретарю.
- Вход в существующую Агату из меню, без второго помощника.
- Обычный TalkHint, сохранение аккаунта/истории/Keychain/настроек,
  одна сборка и установка поверх после зелёных целевых проверок.

## Что добавлено

1. Calendar и Tasks — рабочие пункты меню. Прежде были недоступны; обновлены
   соответствующие тесты ожидаемых состояний, остальные будущие пункты серые.
2. Calendar: выбор дня, чтение событий этого дня, системный редактор EventKit
   для добавления/изменения/удаления, системный просмотр read-only событий.
   Новый event до нажатия Save НЕ сохраняется. Используется календарь,
   выбранный системой по умолчанию; пользователь видит/меняет его в редакторе.
3. Tasks: список напоминаний, незавершённые прежде завершённых; редактор названия,
   срока и completed. Создание/изменение только по Save, удаление с подтверждением.
   Повторный tap Save не создаёт второй reminder. Cancel ничего не пишет.
   Изменение названия не меняет точность старого all-day срока, его timezone
   или completed date без явного изменения этих полей.
4. Calendar/Reminders разрешаются ОТДЕЛЬНО. Открытие экрана само не вызывает
   системный prompt. Кнопка Allow access вызывает нужный запрос. Denied:
   явный переход в настройки; restricted: честное сообщение.
   iOS 17+ использует full-access API, iOS 15–16 — legacy. Write-only Calendar
   недостаточно для списка, поэтому запрашивается full access.
5. Device entries не сериализуются/не посылаются API, модели или в чат.
   Системная синхронизация Apple/подключённых к iPhone аккаунтов остаётся
   настройкой устройства. Google server connector не используется.
6. Существующие поручения загружаются прежним GET /api/secretary/tasks
   с прежним пользовательским APIClient. Это отдельная секция, доступная
   даже при отказе Reminders. Ошибка GET не выдаётся за пустой успех.
   Тап открывает прежний SecretaryTaskDetailViewController — у него только
   снят file-private, логика отчёта/звонков НЕ изменена.
   Hint-подготовка остаётся в чате, это не новая система поручений.
7. Agata использует старые capability/owner/audio/admission/budget guards.
   При недоступности пункт в серой группе. При доступности tap показывает
   подтверждение с Cancel/Start; только явный Start ведёт в старый voice flow.
   Открыть меню/подтверждение не значит начать платную сессию.
8. Добавлены owner/revision/cancellation guards; данные скрываются при смене
   пользователя/отзыве доступа. Экраны не читают EventKit в фоне/после выхода.
9. Четыре usage-description ключа для Calendar/Reminders и их modern-вариантов
   добавлены в Info.plist и локализованы во всех пяти InfoPlist.strings.
   UI keys также во всех пяти Localizable.strings.
10. Исправлен сценарий Settings screenshot: light устанавливается ДО push,
    после изменения темы выдерживается подтверждённый Mac-диагностикой интервал,
    а Settings по-прежнему снимается drawHierarchy.

НЕ добавлены: голосовое управление Calendar/Reminders, импорт записей в модель,
автоматическое создание события из результата Кати, Google OAuth/Calendar,
изменение Retell/голоса/лимитов/серверов. Никаких новых платных проб.

## Что Replit действительно проверил

- 112 source-contract tests — passed.
- 68 helper/source tests — passed.
- Проверка всех пяти UI-локализаций входит в существующие source tests.
- Новые статические guards проверяют раздельные разрешения, описания,
  отсутствие server/model transport у device store, владельца/поздние ответы,
  отсутствие автоматических записей/повторных звонков и регистрацию XCTest.
- git diff --check — passed.
- Swift/EventKit SDK, UIKit runtime, XCTest и физический iPhone здесь
  НЕ проверены. Прямые EventKit CRUD ещё не проверены на реальном устройстве.

Новые файлы автоматически входят через штатный XcodeGen glob. Проверить
компиляцией, не править pbxproj вручную. Зависимости и минимум iOS 15 не менять.

## Получение кода без смены локальной ветки

```bash
set -euo pipefail
cd ~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency
ROOT="$PWD"
git branch --show-current
git rev-parse HEAD
git status --short
test -z "$(git status --porcelain)"
git merge-base --is-ancestor ba6393a89ad2be215d4764ce312f30f5b274edf6 HEAD
git fetch --no-tags origin refs/heads/xcode-chat-voice-sarah-2026-11-11
git merge --ff-only FETCH_HEAD
git merge-base --is-ancestor d407c7cc64d43f6caa0d248010fdb579030f5a42 HEAD
git diff --exit-code d407c7cc64d43f6caa0d248010fdb579030f5a42 HEAD -- ios
```

Dirty/расхождение/новая непроверенная iOS-дельта — остановиться и вернуть diff,
не теряя изменений. Без stash/reset/rebase/force, переименования локальной
ветки, нового worktree, смены SDK/Xcode/Team/сертификатов/зависимостей
и очистки DerivedData. Предыдущие Mac-исправления уже сохранены.

## 29 целевых XCTest, не полный gate

12 новых ChatDeviceAgendaTests, 15 ChatNavigationTests, 2 указанных
ChatApprovedScreenTests. Все новые tests используют fake store/transport:
никаких OS prompts, реальных записей/чтения личного календаря, сети или оплаты.
Никаких реальных Secretary/Agata/Retell проб. Остальные неизменённые успешные
tests не повторять без конкретной причины и не считать новым прогоном.

ROOT/DD/SIM_ID — реальные значения существующей копии/тёплого DerivedData/
одного доступного симулятора. OUT — новый каталог под generated-artifacts,
предыдущие xcresult не затирать. Использовать установленный runtime.
Если нужен временный симулятор — один, без скачивания SDK и удаления чужих.

```bash
OUT="$ROOT/generated-artifacts/device-agenda-d407c7cc-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
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
  -only-testing:TalkHintTests/ChatDeviceAgendaTests \
  -only-testing:TalkHintTests/ChatNavigationTests \
  -only-testing:TalkHintTests/ChatApprovedScreenTests/testFullscreenHasLeadingMenuAndExitWithoutTabs \
  -only-testing:TalkHintTests/ChatApprovedScreenTests/testNativeLightAndDarkScreenshots \
  -resultBundlePath "$OUT/device-agenda.xcresult" 2>&1 | tee "$OUT/tests.log"
```

Если новая Swift/API ошибка — вернуть точный diagnostic. Не менять доступы,
минимальную iOS/SDK/проверки или код приложения на Mac самостоятельно.
Не принимать skipped/expected failures.

### ChatDeviceAgendaTests — 12

- testOpeningCalendarDoesNotPromptReadWriteOrUseServer
- testCalendarPermissionDoesNotGrantRemindersAndGrantDoesNotWrite
- testDeniedRemindersStillShowExistingAssignmentsWithoutCallingAnyone
- testServerFailureIsNotAnEmptySuccessfulAssignmentsList
- testDeviceReadFailureIsAnExplicitRetry
- testDifferentOwnerCannotReadOrRequestPermission
- testRevokedPermissionAndChangedOwnerHidePreviouslyLoadedRows
- testReminderEditorDoesNotSaveUntilExplicitSaveAndRejectsChangedOwner
- testReminderEditorCancelDoesNotWriteOrDelete
- testDueDateWithoutEmbeddedCalendarIsStillRecognized
- testAgataMenuConfirmationDoesNotCreateSessionOrSendMessages
- testCalendarAndTasksLightDarkSnapshotsUseOnlyFakes

### ChatNavigationTests — 15

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

### ChatApprovedScreenTests — 2

- testFullscreenHasLeadingMenuAndExitWithoutTabs
- testNativeLightAndDarkScreenshots

## Снимки и разрешения

Просмотреть реальные вложения Agenda-calendar-1/2 и Agenda-reminders-1/2
(1 light, 2 dark), Settings-full-labels-1/2, Menu-grouping-1/2.
Проверить читаемость, новый порядок меню, отдельные device/assignment секции,
отсутствие пустых кадров. Это исключительно offline fixtures.

Проверить 320pt и крупный системный шрифт AX5 в симуляторе на fixtures.
Не выдавать проходящий layout assertion за просмотр картинки или испытание
реального EventKit. Минимум iOS 15 сохранён кодом/настройками; если такого
runtime нет, отдельно сказать, что runtime на iOS 15 не проверен.
Не загружать SDK ради этого задания.

На физическом iPhone НЕ выдавать Calendar/Reminders разрешения от лица
владельца, не читать и не менять его записи ради проверки. Это остаётся
его отдельным явным действием после установки.

## Одна обычная сборка и установка поверх

Сервер не менялся, Publish не нужен. Прежний GET Secretary tasks уже существует.
Сборка не включает новую серверную зависимость. Native-ветку не публиковать.

После зелёных tests — одна TalkHint Debug, app.talkhint, https://talkhint.app,
прежняя подпись/Team, тёплый DEVICE_DD:

```bash
xcodebuild -project "$ROOT/ios/TalkHint.xcodeproj" -scheme TalkHint \
  -configuration Debug -sdk iphoneos \
  -destination "platform=iOS,id=$DEVICE_ID" -derivedDataPath "$DEVICE_DD" \
  build 2>&1 | tee "$OUT/device-build.log"
```

Если iPhone unavailable — допустима одна generic/platform=iOS сборка с той же
подписью и честный отчёт «не установлено», без бесконечного опроса/пересборок.
Обычное приложение, не AppDev/Archive/TestFlight.

Установка поверх по согласованному владельцем порядку: тот же bundle ID,
та же Team/подпись, доступный разблокированный телефон, нет активного звонка.
Отсутствие видимого экрана звонка САМО ПО СЕБЕ не доказывает отсутствие звонка:
учесть доступное состояние приложения/системного звонка; при сомнении
спросить владельца, не останавливать звонок и не принудительно перезапускать.
Нельзя uninstall/logout/удалять контейнер, историю, Keychain, настройки,
переустанавливать под другой подписью. APP_PATH — из новой сборки.

```bash
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"
xcrun devicectl device process launch --device "$DEVICE_ID" app.talkhint
```

После установки только запуск. Не нажимать Orb/Agata Start/Play/Secretary Start,
не делать recovery, не отправлять сообщения, письма или звонки.

## Что вернуть

HEAD, поимённые 29 passed/failed/skipped, длительности tests/сборки,
новые warnings и точные diagnostics при ошибке, ссылки на логи/настоящие
снимки, результат 320pt/AX5, установлен/запущен или точный блокер.
Отдельно: реальный EventKit CRUD/разрешения на iPhone и голос Агаты НЕ проверены.

Владельцу после установки:
1. Calendar и Tasks открываются из меню, назад возвращает тот же чат.
   В Calendar и Reminders доступ запрашивается раздельно только по Allow access.
2. По своему выбору разрешить доступ: проверить события/напоминания и отдельные
   существующие поручения. Save/Cancel на тестовой записи проверить самому;
   отказ Reminders не должен скрыть поручения. Системная синхронизация — как в iPhone.
3. Пункт Agata открывает подтверждение. Нажать Cancel: разговор не начинается.
   Аккаунт/чаты/настройки на месте. Платный Start не входит в эту проверку.
