> Следующий проход — только [единое задание: чат + Агата + звук Кати](claude-mac-chat-agata-secretary-handoff.md).
> Ниже история реализации, не отдельная сборка/платный запуск Агаты.

# Клавдию: Агата — Retell в существующем Orb

> Это историческая передача первоначального подключения. Для текущего
> исправления ICE выполнять только [новое единое задание](claude-mac-agata-trickle-handoff.md).
> Инструкции ниже повторно не запускать.

## Одно задание, без AppDev и полного gate

- Репозиторий: https://github.com/Sergalmazfas/Talk-Hint-VM
- Постоянная ветка: `xcode-chat-voice-sarah-2026-11-11`.
- База Mac: `7822bea6a6d4f11879bf6eb744af349a29b48951`.
- Коммит iOS-кода: `1b4fbc079d1f3f9ef7c5433e0f9663902ce8db19`.
- Следующий коммит в этой же ветке содержит только это задание. Серверную ветку НЕ merge/cherry-pick.
- Рабочая копия: `~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency`.
- Нужен обычный TalkHint: bundle `app.talkhint`, production `https://talkhint.app`, НЕ AppDev.

**Серверная зависимость: сначала владелец делает Publish Агаты.**
До подтверждения владельца не собирать/не устанавливать новый клиент.
После подтверждения прочитать https://talkhint.app/api/build и сверить `commit`
с серверным SHA из финального сообщения Replit (это НЕ iOS-SHA выше).
Если сервер ещё старый — остановиться; Publish самостоятельно не делать.

## Что сделано

Существующий вход шара открывает `ChatAgataViewController`, использующий тот же
`ChatVoiceOrbView`. Создаётся scoped web call через
`POST /api/chat-v1/conversations/:id/agata`, затем WebRTC offer/answer,
`joined`; при закрытии — немедленно локальный stop, удаление signaling-session,
серверный `stop` и ограниченное получение финальной квитанции (`reconcile`).
Новая аудиосессия не создаётся, если телефония уже владеет звуком.
Активацией аудио владеет WebRTC; приложение не дублирует `setActive`.
Смена Bluetooth-маршрута остаётся внутри WebRTC/AVAudioSession.
При длительном обрыве — остановка и понятная ошибка, НЕ автоматическое создание
нового платного сеанса. Возобновление — явное повторное открытие владельцем.

Уточнение владельца: обычные карточки Hint/Секретаря создаются сервером через
те же инструменты, что в текстовом чате, и доступны в этом же разговоре.
Подтверждение — кнопкой на карточке, затем Start для Секретаря. Голосовое «да»
не является авторизацией, не пересоздаёт карточку и не делает её устаревшей.
Правка этого поведения — серверная, нового iOS-кода не требует. Если код
`1b4fbc07` уже собран/проверен, из-за этого уточнения повторно не собирать.

Речь/ответы сохраняет сервер в тот же разговор. Новая кнопка с главного экрана
по-прежнему создаёт разговор, внутри чата — продолжает текущий.
Новый интерфейс карточек внутри Orb и голосовое подтверждение НЕ реализовывать.
Код старой связки STT/ElevenLabs оставлен без изменений для отката.

Добавлена ровно одна зависимость: stasel/WebRTC **156.0.0** (закреплена exact).
Проверен MinimumOSVersion device-бинарника: **12.0**. Минимум приложения **15.0**
не менять. Orb остаётся исходниками, iOS 17+ / прежний fallback на 15–16.
Twilio не обновлять. Повторно использовать текущие SourcePackages/DerivedData.

## Получение и точечные проверки

```sh
cd ~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency
git status --short
# Если есть чужие изменения — СТОП, без stash/reset/force/rebase.
git fetch origin xcode-chat-voice-sarah-2026-11-11
git merge --ff-only origin/xcode-chat-voice-sarah-2026-11-11
git merge-base --is-ancestor 1b4fbc079d1f3f9ef7c5433e0f9663902ce8db19 HEAD
xcodegen generate --spec ios/project.yml
plutil -convert json -o /tmp/talkhint-agata-project.json ios/TalkHint.xcodeproj/project.pbxproj
python3 ios/scripts/verify-project-sources.py /tmp/talkhint-agata-project.json ios
```

Проверить, что generation сохранила прежние настройки, Team и подпись.
Не обновлять прочие зависимости. Если недостаточно места — доложить, ничего
не удалять без разрешения.

Взять существующий Simulator UUID (`xcrun simctl list devices booted`), не
создавать новые симуляторы. Использовать актуальный установленный Xcode;
путь/название Xcode не менять.

```sh
xcodebuild -project ios/TalkHint.xcodeproj -scheme TalkHintValidation \
  -destination "platform=iOS Simulator,id=<EXISTING_SIMULATOR_UDID>" \
  -only-testing:TalkHintTests/ChatAgataTests \
  -only-testing:TalkHintTests/ChatVoiceOrbTests \
  -only-testing:TalkHintTests/ChatVoiceScreenTests \
  -only-testing:TalkHintTests/ChatVoiceCaptureHealthTests \
  -only-testing:TalkHintTests/CallAudioDeviceRouterTests \
  -only-testing:TalkHintTests/ChatAPITests \
  test
```

Обязательные 12 новых XCTest:

1. `testCreateUsesSameConversationOwnerAndStableRequestID`
2. `testUnsupportedLocaleFallsBackToSupportedLanguage`
3. `testMismatchedConversationAndInvalidTicketsAreRejected`
4. `testJoinedAndStopAreAuthenticatedAndNeverDial`
5. `testInvalidOperationOrPathCannotReachTransport`
6. `testReconcileReadsExistingReceiptWithoutCreatingAnotherCall`
7. `testMissingOwnerStopsBeforeNetwork`
8. `testSignalingUsesOnlyEphemeralRetellTokenAndFixedHost`
9. `testIceUrlsSupportBothProviderFormats`
10. `testAudioStateUsesActualReceivedAudioNotGeneratedText`
11. `testAudioStateClampsInvalidStatistics`
12. `testScreenReusesOrbAndDoesNotStartNetworkOrAudioWhenLoaded`

Это неплатные тесты с моками; они не дают права запускать web call/звонок.
При несовпадении сигнатуры нового SDK допустима минимальная правка только
новых `ChatAgata*.swift`/их тестов, без удаления или ослабления проверок.
Вернуть её отдельным коммитом и diff для проверки Replit. При проблеме
линковки с Twilio, аудиоповедении или необходимости менять другие компоненты —
СТОП, точная ошибка, без самостоятельной замены зависимостей/телефонии.

## Одна конечная сборка и установка поверх

После успешных целевых тестов — одна incremental-сборка обычного TalkHint.
Взять UUID уже подключённого iPhone (`xcrun devicectl list devices`) и прежний
device DerivedData path из текущей рабочей копии/предыдущего успешного отчёта.
Не создавать новую рабочую копию и не очищать кэши.

```sh
xcodebuild -project ios/TalkHint.xcodeproj -scheme TalkHint -configuration Debug \
  -destination "id=<CONNECTED_IPHONE_UDID>" \
  -derivedDataPath "<EXISTING_DEVICE_DERIVED_DATA>" build
plutil -extract CFBundleIdentifier raw \
  "<EXISTING_DEVICE_DERIVED_DATA>/Build/Products/Debug-iphoneos/TalkHint.app/Info.plist"
# Должно быть app.talkhint. Схема TalkHint использует https://talkhint.app.
xcrun devicectl device install app --device "<CONNECTED_IPHONE_UDID>" \
  "<EXISTING_DEVICE_DERIVED_DATA>/Build/Products/Debug-iphoneos/TalkHint.app"
xcrun devicectl device process launch --device "<CONNECTED_IPHONE_UDID>" app.talkhint
```

Не удалять приложение/данные; не делать Archive, TestFlight, Publish, звонки
Кати/Hint, самостоятельные платные web-тесты или изменения Secrets/сертификатов.
Голосовую кнопку после установки нажимает сам владелец.

## Что уже проверил Replit / что вернуть

- 59/59 целевых серверных/Dev-PG/source-contract проверок; TypeScript PASS.
- После последней аудиоправки повторно прошли 9 source-contract проверок.
- Эти проверки НЕ являются XCTest, iOS-сборкой или проверкой звука.
- Настройки Кати `agent_610e002220ebc2393cc95791be`, SHA-256 полного
  канонизированного Get Agent JSON, до и после отключения анализа Агаты:
  `3bfed0c83224198f74b78e35930a8aeaf88cc7320146e4f9a1c8a36e7f6ebe78` — совпали.
- У двух агентов Агаты модель post-call analysis очищена (`null`); новых
  платных сеансов Replit не запускал. Отсутствие соответствующего списания
  отдельно сверить по квитанции первой ручной сессии, не выдавать readback
  настроек за проверенный счёт.

Вернуть кратко: ветка/HEAD; passed/failed/skipped именно целевых XCTest;
время тестов/сборки; установлен ли `app.talkhint` поверх; новые предупреждения;
ссылки/пути логов; что не проверено. ZIP и полный gate не нужны.

## Владельцу на телефоне — 3 проверки

1. Открыть имеющийся чат → шар → сказать короткую фразу. Должен ответить
   голос Merritt; «Слушаю / Говорю» и Orb реагируют, текст остаётся в том же чате.
2. Во время ответа сказать следующую фразу; затем нажать стоп. Проверить
   перебивание, прекращение звука и микрофона; заново открыть шар и получить ответ.
3. Повторить коротко с Bluetooth/наушниками, затем выйти в обычное приложение.
   Чат/черновик сохраняются; штатные разделы и телефонный экран не изменены.
