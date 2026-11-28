# Claude на Mac: Агата — ошибки запуска и безопасная сверка

> Актуальная объединённая передача: `docs/claude-mac-chat-menu-handoff.md`.
> Она включает меню и непройденные проверки Агаты в один пакет. Этот документ
> сохранён как описание прежней дельты; не запускать два задания параллельно.

## Статус: подготовлено в Dev, выпуск НЕ разрешён

Репозиторий: https://github.com/Sergalmazfas/Talk-Hint-VM

Постоянная ветка: `xcode-chat-voice-sarah-2026-11-11`.
Существующая копия: `~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency`.

База: `85e3e9e236be4ef54afa79716bf8a2f8e3327cde`.
Целевой commit iOS-кода: `d6f155723514901844afbe5489782932e4438b0f`.
Последующие коммиты этого задания могут менять только документацию.

**Не выполнять сейчас сборку/установку или Publish.** Разрешены получение
ветки, чтение и бесплатные source checks. Новая ручная сверка зависит от
серверного commit `51fa3de0290bb8cabd13a0770d5b7cfe8d1ec21f`
в основной серверной ветке `xcode-chat-actions-2026-11-09`, не в этой native-ветке.
Сервер из native-ветки НЕ публиковать и основную ветку сюда НЕ вливать.
Сначала отдельное разрешение владельца на Publish сервера, подтверждение
нужной версии через https://talkhint.app/api/build; затем разрешение на этап
Mac/XCTest и установку. Пока их нет — вернуть «Dev подготовлен, выпуск ожидает».

Публикация сервера не обновляет iPhone. Не вызывать production recovery, Agata
или Retell ради проверки версии. Нельзя снимать резерв в БД вручную.

## Дельта и ограничения

Теперь HTTP 409 о старом незавершённом сеансе не выдаётся за сбой сети.
Различаются unknown usage, AUDIO_BUSY и повторный request ID. Переводы
Agata.strings согласованы en/ru/es/kk/uk. Для старого незавершённого сеанса
появляется кнопка «Проверить прошлый сеанс». Только нажатие вызывает
аутентифицированный POST `/api/chat-v1/agata/recovery` с пустым телом.

Ответ ready предлагает закрыть/открыть экран, но НЕ запускает голос.
blocked оставляет блокировку, review_required — резерв и ручную проверку.
Ошибка или старый сервер 404 не должны приводить к повторной admission.
Никакого автоматического start/microphone/LLM/Retell create/stop.
Транспорт, Session, Peer, CallKit, Катя, голос, модель, таймауты, бюджет,
навигация, карточки и диктовка не менялись.

Replit выполнил 84 серверных Vitest; 2 DB-теста revisionRace штатно skipped.
TypeScript: exit 0, диагностик 0. Native source contracts: 15/15.
Это НЕ XCTest, не сборка Swift и не доказательство звука на iPhone.
Полный параллельный test-workflow не считается проверкой этой дельты:
он мог читать файлы во время редактирования.

## Получить в прежнюю чистую копию

```bash
cd ~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency
git status --short
git branch --show-current
git rev-parse HEAD
# Только чистая правильная ветка; при расхождении остановиться.
git fetch --no-tags origin refs/heads/xcode-chat-voice-sarah-2026-11-11
git merge --ff-only FETCH_HEAD
git merge-base --is-ancestor 85e3e9e236be4ef54afa79716bf8a2f8e3327cde HEAD
git merge-base --is-ancestor d6f155723514901844afbe5489782932e4438b0f HEAD
git diff --exit-code d6f155723514901844afbe5489782932e4438b0f HEAD -- ios
python3 -m unittest discover -s ios/scripts/tests -p 'test_agata*contract.py' -v
```

Не stash/reset/rebase/force, не удалять приложение, данные или Keychain.
Не менять зависимости, Apple Team, сертификаты, Xcode/SDK, кэши, окружение
и signing. Не создавать новую ветку/worktree/Dev-приложение.

## После отдельного согласования выпуска и серверной версии

Использовать действующие Xcode, runtime, симулятор и тёплый DerivedData.
Если симулятора нет — одно временное устройство из установленного runtime,
без загрузки SDK или удаления чужих устройств. Указать фактические ROOT, DD,
SIM_ID, OUT. Логи под generated-artifacts/, без UDID и секретов в отчёте.

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
  -testLanguage en -testRegion US -only-testing:TalkHintTests/ChatAgataTests \
  -resultBundlePath "$OUT/AgataRecovery.xcresult" 2>&1 | tee "$OUT/tests.log"
```

В тестах используются transport fakes, никаких production API или микрофона.
Обязательны все 15 методов ChatAgataTests, без skip:

1. testAdmissionErrorsAreNotMisreportedAsNetworkFailures
2. testRecoveryUsesOwnerAuthenticationAndNeverCreatesVoice
3. testRecoveryRejectsUnknownStateAndDoesNotRetryOnOldServer
4. testCreateUsesSameConversationOwnerAndStableRequestID
5. testUnsupportedLocaleFallsBackToSupportedLanguage
6. testMismatchedConversationAndInvalidTicketsAreRejected
7. testJoinedAndStopAreAuthenticatedAndNeverDial
8. testInvalidOperationOrPathCannotReachTransport
9. testReconcileReadsExistingReceiptWithoutCreatingAnotherCall
10. testMissingOwnerStopsBeforeNetwork
11. testSignalingUsesOnlyEphemeralRetellTokenAndFixedHost
12. testIceUrlsSupportBothProviderFormats
13. testAudioStateUsesActualReceivedAudioNotGeneratedText
14. testAudioStateClampsInvalidStatistics
15. testScreenReusesOrbAndDoesNotStartNetworkOrAudioWhenLoaded

При ошибке компиляции, missing/skipped/failed — остановка до установки.
Не повторять навигационные/диктовочные тесты и полный gate без новой причины.
Не ослаблять проверки. Частичный прогон не выдавать за полный.

После 15/15 и отдельного разрешения владельца — одна обычная device-сборка:

```bash
xcodebuild -project "$ROOT/ios/TalkHint.xcodeproj" -scheme TalkHint \
  -configuration Debug -sdk iphoneos \
  -destination "platform=iOS,id=$DEVICE_ID" -derivedDataPath "$DEVICE_DD" \
  build 2>&1 | tee "$OUT/device-build.log"
```

По effective settings проверить app.talkhint, production https://talkhint.app,
прежние подпись/Team/callback, не AppDev/NativeValidation. APP_PATH взять из
реального build output. Только при отсутствии текущего звонка и с разрешения:

```bash
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"
xcrun devicectl device process launch --device "$DEVICE_ID" app.talkhint
```

Не открывать Orb автоматически: открытие само начинает платную admission.
Не нажимать кнопки голоса, Play, Start или отправку сообщений.

## Отчёт и ручные проверки

Вернуть HEAD, poимённые passed/failed/skipped, длительность тестов/сборки,
новые предупреждения, ссылки на логи, факт установки или точный блокер.
Отдельно указать: настоящий старый сеанс не сверялся; успех на заглушке не
доказывает, что провайдер сохранил его полную квитанцию.

Только после выпуска и отдельного решения владельца на работу с голосом:
1. При старой блокировке видна её причина, а не совет «проверьте интернет».
2. «Проверить прошлый сеанс» не начинает новый разговор; неполная квитанция
   оставляет резерв и сообщает необходимость проверки.
3. При готовности новый разговор начинается только отдельным действием.
   Неизвестные списания не объявляются нулевыми; оплачиваемые пробы не автоматические.
