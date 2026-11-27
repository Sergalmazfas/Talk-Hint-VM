# Claude на Mac: сначала восстановить прослушивание Кати

Это одно актуальное задание для исправления местного звука Secretary.
Не выполнять заново прежние задания чата из исторических разделов handoff.
Никаких новых звонков, серверного Publish, платных запросов или писем.

## Версия и границы

- Репозиторий: [Sergalmazfas/Talk-Hint-VM](https://github.com/Sergalmazfas/Talk-Hint-VM).
- Постоянная ветка: [xcode-chat-voice-sarah-2026-11-11](https://github.com/Sergalmazfas/Talk-Hint-VM/tree/xcode-chat-voice-sarah-2026-11-11).
- Существующая Mac-копия: `~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency`.
- **База: `8a4f7eebe61d9c05973140b0866aaea2eaf35c0a`.**
- **Целевой коммит кода: `09024abac21a429355ec50f619324250488b0051`.**
- Последующий коммит содержит только этот handoff. Указать фактический HEAD в отчёте.
- Источник подготовленной дельты Replit: `c09cc308026ae5135c8aee5b469378f4e485b280`.

Дельта перенесена поверх существующей iOS-ветки, не merge серверной ветки.
Её исходная версия затронутых файлов проверена на совпадение с базой Replit.
Все прочие файлы прежней Mac-ветки сохранены.
Сервер из этой ветки не публиковать.

**Новый сервер не требуется. Publish не нужен и не обновит iPhone-приложение.**
Текущий рабочий сервер при диагностике: `https://talkhint.app`, SHA
`7ec7572966a802ee1dba4297856b69fb36139c2f`.
Не менять AppConfig, bundle ID, Apple Team, сертификаты, entitlement устройства,
OAuth, APNs, голос/модель/таймауты Кати и настройки звонков.

## Симптом и честный статус

Владелец видит живой текст и получение сервером двух дорожек Twilio, но не
слышит разговор. Красная ошибка местного плеера не даёт точной причины.
Добавлены сохранение ошибки при reconnect, безопасные диагностические коды
на экране, проверка действительной готовности движка/двух узлов и ограниченное
местное восстановление. Принятые пакеты и успешный start не считаются
воспроизведением. Скрытый экран и чужая CallKit-сессия не должны управлять звуком.

В Replit выполнены 7 source-contract + 8 audio-boundary проверок исходников.
Ранее выполнены 6 серверных mocked-тестов retellMonitor/streamAuth.
**Swift ещё не скомпилирован, XCTest и слышимость iPhone не проверены.**
Это подготовленное исправление, не доказательство устранения старого сбоя.

Важное добавление: `testRealEngineRendersBothSyntheticTracksWithoutNetworkOrMicrophone`
использует настоящий AVAudioEngine и настройки аудиосессии монитора, а не fake.
Два коротких синтетических буфера должны дать два callback `.dataPlayedBack`.
Ни микрофона/input tap, ни сети/Retell/Twilio-звонка в этом тесте нет.
Если он упадёт — вернуть точную стадию/системный код, не маскировать mock-проверкой.
Доказательство callback не равно подтверждению человеком слышимого звука.

Последний разбор звонка не является основанием менять поведение Кати:
27.11.2026 21:18:19–21:19:34 UTC, в конце сохранены повторные `Hello?`
собеседника. Кто завершил звонок, по доступным данным не доказано.
Эта дельта не меняет завершение разговора и не добавляет владельцу микрофон:
монитор по-прежнему только для прослушивания.

## 1. Получить дельту, не теряя работу

В существующей Mac-копии сначала:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
```

Если есть изменения или непереданные Mac-коммиты — остановиться, перечислить
пути/коммиты. Не stash/reset/clean/rebase/force, не создавать новый worktree.
Проверить, что origin — именно указанный репозиторий; credentials не выводить.
В чистой копии на постоянной ветке:

```bash
git fetch --no-tags origin refs/heads/xcode-chat-voice-sarah-2026-11-11
git merge --ff-only FETCH_HEAD
git merge-base --is-ancestor 8a4f7eebe61d9c05973140b0866aaea2eaf35c0a HEAD
git merge-base --is-ancestor 09024abac21a429355ec50f619324250488b0051 HEAD
git diff --exit-code 09024abac21a429355ec50f619324250488b0051 HEAD -- ios
git diff --name-only 8a4f7eebe61d9c05973140b0866aaea2eaf35c0a HEAD
```

Между целевым кодом и HEAD ожидается только handoff; изменения iOS запрещены.
От базы изменены только три исходника монитора, два XCTest-файла,
`ios/scripts/verify-xcresult.py`, новый source-contract и два документа.
Серверные файлы не должны меняться. Non-fast-forward — блокер, не обходить.

## 2. Целевые тесты, без полного gate

Использовать существующие Xcode, Simulator и DerivedData/SPM-кэши. Не переименовывать
Xcode, не создавать symlink, не удалять кэши и не обновлять зависимости.
Сначала проверить актуальный `xcodebuild -version` и существующие пути;
не подставлять старый Xcode_16.4, если Mac использует другой подтверждённый Xcode.

Тестовый host — **TalkHintValidation / NativeValidation** с `.invalid` backend.
Не перенаправлять его на production. Не устанавливать отдельное AppDev.
После `xcodegen generate --spec ios/project.yml` убедиться в ожидаемых схемах.
Если XcodeGen требует запуск из каталога ios — использовать существующий порядок
`cd ios && xcodegen generate --spec project.yml`, не менять spec.

Ниже `DD` и `SIM_ID` — существующие локальные значения с Mac, не примеры для
буквального копирования. `ROOT` — текущий корень репозитория; `OUT` — новый
каталог логов внутри игнорируемого `generated-artifacts/`. Проверить эти переменные
перед командой; не создавать новый simulator и не удалять старый.

```bash
COMMON=(-project "$ROOT/ios/TalkHint.xcodeproj" -scheme TalkHintValidation
  -configuration NativeValidation -sdk iphonesimulator
  -destination "platform=iOS Simulator,id=$SIM_ID"
  -derivedDataPath "$DD"
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual
  DEVELOPMENT_TEAM= PROVISIONING_PROFILE= PROVISIONING_PROFILE_SPECIFIER=
  "CODE_SIGN_ENTITLEMENTS=$ROOT/ios/scripts/native-validation.entitlements")
set -o pipefail
xcodebuild "${COMMON[@]}" build-for-testing 2>&1 | tee "$OUT/build-for-testing.log"
```

Проверить настоящий Keychain runtime entitlement главного Mach-O тестового host,
не debug dylib и не промежуточного plist:

```bash
SIM_APP="$DD/Build/Products/NativeValidation-iphonesimulator/TalkHint.app"
codesign --verify "$SIM_APP"
xcrun segedit "$SIM_APP/TalkHint" -extract __TEXT __entitlements "$OUT/simulator-entitlements.plist"
python3 "$ROOT/ios/scripts/verify-native-entitlements.py" "$OUT/simulator-entitlements.plist"
xcodebuild "${COMMON[@]}" test-without-building -parallel-testing-enabled NO \
  -testLanguage en -testRegion US \
  -only-testing:TalkHintTests/SecretaryMonitorAudioTests \
  -only-testing:TalkHintTests/SecretaryTranscriptRenderingTests \
  -only-testing:TalkHintTests/CallAudioDeviceRouterTests \
  -only-testing:TalkHintTests/NativeSessionStorageTests \
  -resultBundlePath "$OUT/SecretaryMonitor.xcresult" 2>&1 | tee "$OUT/tests.log"
```

Ожидается **30 тестов, все PASS, failed=0, skipped=0**. Реальные Keychain и
движок обязательны; missing entitlement, отсутствие звукового устройства,
ошибка сессии/движка или missing callback — блокер, не skip/fallback.
`verify-xcresult.py` рассчитан на полный gate: не объявлять его PASS для этих
четырёх выбранных suites. Сверить поимённые результаты в `.xcresult`.

Обязательные тесты:

**SecretaryMonitorAudioTests (10):**
- `testTranscriptConnectionDoesNotClaimAudioIsPlaying`
- `testAudioRequiresPacketsThenPlaybackEvidence`
- `testReconnectCannotReuseOldPlaybackEvidence`
- `testPartyNodesUseDifferentMixerInputsWithoutStartingAudio`
- `testMuLawDecodeSilenceAndBothPolarities`
- `testRecoveryIsThrottledAndStopsAfterThreeAttempts`
- `testOnlyPlaybackEvidenceResetsAutomaticRecoveryBudget`
- `testOwnerRetryDoesNotClaimFailureWasRepaired`
- `testDiagnosticErrorCodeDoesNotExposeDescriptionsOrUnknownDomains`
- `testRealEngineRendersBothSyntheticTracksWithoutNetworkOrMicrophone`

**SecretaryTranscriptRenderingTests (15):**
- `testFirstLiveSecretaryAndGuestTurnsHaveAttachedConstraints`
- `testRecoveredSnapshotAndReplayDoNotCrashOrDuplicateTurns`
- `testLegacyTranscriptSnapshotRestoresWithoutDuplicates`
- `testLiveUpdateAfterRecoveryReusesTheExistingCard`
- `testEmptyTurnsDoNotCreateCards`
- `testUnavailableTwilioSourceDoesNotOfferRecreationOrDisableEnd`
- `testSourceTrackReceiptIsNotPresentedAsAudibleProof`
- `testLegacyServerWithoutMonitoringCapabilityKeepsExistingFeedBehavior`
- `testReappearingFeedDiscoversSourceThatStartedWhileMonitorWasHidden`
- `testFeedResetKeepsLocalAudioFailureAndDiagnosticVisible`
- `testSourceLossDoesNotEraseLocalFailureOrDisableHangup`
- `testPacketsAndFeedResetCannotClearFailureBeforePlayback`
- `testBadPacketsNeverEnqueueAndHiddenScreenCannotRecoverOrRender`
- `testNotReadyPlayerRetriesLocallyWithoutAnotherFeedSubscription`
- `testInterruptionWithoutResumePermissionCannotRestartOnPackets`

**CallAudioDeviceRouterTests (4):**
- `testOrdinaryCallsUseOnlyStandardDeviceAndWaitForCallKit`
- `testCopilotKeepsItsCustomDeviceAndPrivatePreparation`
- `testNeverSwapsDuringActiveOrDisconnectingCalls`
- `testNextOrdinaryCallDoesNotInheritCopilotDevice`

**NativeSessionStorageTests (1):**
- `testRealKeychainCanStoreReadAndDeleteSessionToken`

## 3. Одна обычная сборка и обновление приложения

Только после 30 PASS: одна incremental device-сборка **TalkHint / Debug**,
рабочий сервер `https://talkhint.app`, прежний bundle `app.talkhint`,
те же Apple Team/подпись/данные. Не AppDev, не Archive/TestFlight.
Использовать существующие реальные `DEVICE_ID` и `DEVICE_DD` на Mac:

```bash
xcodebuild -project "$ROOT/ios/TalkHint.xcodeproj" -scheme TalkHint \
  -configuration Debug -sdk iphoneos \
  -destination "platform=iOS,id=$DEVICE_ID" \
  -derivedDataPath "$DEVICE_DD" build 2>&1 | tee "$OUT/device-build.log"
```

Не добавлять production-run сервер, provision/profile download, смену Team,
unsigned обход или очистку DerivedData. Убедиться, что сейчас нет активного
звонка. Обновить поверх существующего TalkHint штатным прежним способом;
если используется devicectl, сначала сверить его доступную команду в этом Xcode:

```bash
xcrun devicectl device install app --device "$DEVICE_ID" \
  "$DEVICE_DD/Build/Products/Debug-iphoneos/TalkHint.app"
```

Не удалять приложение/Keychain/данные и не выводить UDID в отчёт.
Нет устройства/права установки/чистого checkout — остановиться с конкретным
блокером. Установка не доказывает слышимость; новый звонок не запускать.

## 4. Что вернуть Replit

- Ветка, полный HEAD и код 09024aba; какие файлы фактически изменились.
- 30 поимённых результатов: passed/failed/skipped, длительность тестов и сборки.
- Для настоящего движка: stage/code, callback обоих буферов и маршрут.
  Не писать «владелец слышит», если человек этого не подтвердил.
- Где сохранены `.xcresult`/логи; новые предупреждения, установка выполнена или нет.
- Был ли получен старый реальный код AVAudioSession/engine с телефона.
  Если нет — так и сказать, не реконструировать его из скриншота.
- Итог: «готово к ручной проверке» либо конкретный блокер.
  Не исправлять самостоятельно проваленные проверки, не ослаблять их и не повторять
  платные операции. Вернуть ошибку Replit для точечной правки.

## 5. Что проверить владельцу на телефоне — только после установки

1. В разрешённом владельцем разговоре слышны **и Катя, и собеседник**,
   не только виден текст. Этот пакет сам новый звонок не разрешает/не запускает.
2. При переключении громкой связи/разговорного динамика звук сохраняется;
   при отказе снять скриншот с новой строкой stage/code, не делать повторные звонки.
3. Уход/возврат на экран не набирает номер заново и не завершает разговор;
   кнопка завершения остаётся доступна. Микрофон владельца монитор не передаёт.
