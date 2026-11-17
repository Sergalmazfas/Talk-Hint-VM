# Клавдию: Агата — одна iOS-дельта trickle ICE

## База и границы

- Репозиторий: https://github.com/Sergalmazfas/Talk-Hint-VM
- Постоянная ветка: `xcode-chat-voice-sarah-2026-11-11`.
- База: `5c94ef9b43f7065fa6c57bed368014b5f3641acf`.
- Коммит кода: `718f30c1ab443d1102280562501b7047c1cd6504`.
- Следующий коммит содержит это задание; из-за документа отдельная сборка не нужна.
- Существующая рабочая копия: `~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency`.
- Только обычный TalkHint, `app.talkhint`, `https://talkhint.app`. Не AppDev.
- **Новый Publish не требуется.** Сервер `31c3c02b` уже опубликован владельцем.
  Можно прочитать https://talkhint.app/api/build, ничего там не менять.
- Не merge/cherry-pick серверную ветку. В ней есть отдельные, не относящиеся
  к этой сборке iOS-изменения карточек; в эту дельту они не включены.

Владелец разрешил узкое исправление, целевые неплатные тесты, одну сборку и
установку поверх без удаления данных. Нет разрешения на самостоятельные web call,
звонки Кати/Hint, платные модели, Archive, TestFlight, Publish, изменения агентов,
Secrets, сертификатов, Apple Team или зависимостей. Если идёт звонок — СТОП,
не прерывать его установкой/перезапуском.

## Причина и что изменено

В двух production-попытках 16.11 около 22:02 CST ticket/callId/agent/web_call
прошли проверку, WS открыт; в повторе Retell прислал call_details.
Оба сеанса iPhone остановил до joined примерно через 8,43 с после допуска WS.
Таймаут ICE в старом iOS вероятен, но исходное исключение iPhone не сохранено:
не выдавать временное совпадение за доказанную причину.

Сверено с установленным Retell JS SDK 3.0.3, gateway-transport:
POST SDP после setLocalDescription; затем PATCH кандидатов на signaling-session.

Изменены только:
1. `ChatAgataPeer.swift`: нет ожидания полного gathering в течение 8 с;
   кандидаты выходят из RTC delegate как Sendable-значения. Применение answer
   отделено от ограниченного ожидания ICE connected (прежние 12 с).
2. `ChatAgataSession.swift`: POST offer → answer → очередь PATCH → ICE connected
   → authenticated joined → включение микрофона. Stop отменяет очередь и
   отбрасывает поздние кандидаты. Нет повторов платного создания сеанса.
3. `ChatAgataAPI.swift`: PATCH на фиксированный Retell host, тот же ephemeral token;
   body `{candidate:{candidate,sdpMid,sdpMLineIndex}}`, таймаут запроса 5 с.
4. `ChatAgataTrickle.swift`: bounded/dedup очередь (128), отмена и typed-диагностика
   `subsystem=app.talkhint`, `category=AgataRTC`. Только session/call ID, этап,
   состояние, HTTP/error code; без токенов, SDP, IP-кандидатов и текста разговора.
   Отказ одного кандидата не отбрасывает остальные; исход решает ICE connection.
5. `ChatAgataTrickleTests.swift`: 9 новых XCTest с моками.
6. `ios/scripts/tests/test_agata_trickle_contract.py`: 7 исходниковых проверок.

Аудиокатегория/режим и владение аудио не менялись; setActive не добавлялся.
iOS 15, WebRTC 156.0.0, Orb, голоса, модели, интерфейс и телефония прежние.
Не переносить joined перед реальным соединением и не включать микрофон раньше.

## Получение: без новой рабочей копии и очистки кэшей

```sh
cd ~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency
git status --short
# Если есть чужие изменения — СТОП. Без stash/reset/force/rebase.
git fetch origin xcode-chat-voice-sarah-2026-11-11
git merge --ff-only origin/xcode-chat-voice-sarah-2026-11-11
git merge-base --is-ancestor 718f30c1ab443d1102280562501b7047c1cd6504 HEAD
python3 ios/scripts/tests/test_agata_trickle_contract.py -v
xcodegen generate --spec ios/project.yml
plutil -convert json -o /tmp/talkhint-agata-trickle-project.json ios/TalkHint.xcodeproj/project.pbxproj
python3 ios/scripts/verify-project-sources.py /tmp/talkhint-agata-trickle-project.json ios
```

Сохранить текущие настройки подписи, кэши и Xcode. Не создавать Simulator.
Если HEAD разошёлся, мало места или нужна правка вне Агаты — СТОП, точный блокер.

## Только целевые неплатные тесты

Выбрать существующий Simulator UUID (`xcrun simctl list devices booted`).

```sh
xcodebuild -project ios/TalkHint.xcodeproj -scheme TalkHintValidation \
  -destination "platform=iOS Simulator,id=<EXISTING_SIMULATOR_UDID>" \
  -only-testing:TalkHintTests/ChatAgataTrickleTests \
  -only-testing:TalkHintTests/ChatAgataTests \
  -only-testing:TalkHintTests/ChatVoiceOrbTests \
  -only-testing:TalkHintTests/ChatVoiceScreenTests \
  -only-testing:TalkHintTests/ChatVoiceCaptureHealthTests \
  -only-testing:TalkHintTests/CallAudioDeviceRouterTests \
  test
```

Обязательны все 9 новых тестов:
- `testCandidatesWaitForSessionAndFlushInOrder`
- `testLateCandidatesAreSentWithoutWaitingForGatheringComplete`
- `testDuplicateCandidatesAreSentOnce`
- `testStopDiscardsQueuedAndLateCandidates`
- `testStopDuringPatchNeverSendsNextCandidate`
- `testFailedCandidateDoesNotDiscardLaterRoutes`
- `testQueueIsBoundedAndInvalidCandidatesNeverReachNetwork`
- `testCandidatePatchUsesFixedHostEphemeralTokenAndNativeEnvelope`
- `testDiagnosticsContainOnlyIdentifiersStatesAndCodes`

Эти XCTest не устанавливают реальное соединение с Retell: это очередь, HTTP
контракт, отмена и privacy. Не выдавать их за успешный звук/сотовую связь.
При новом compiler warning/error допустима минимальная правка только дельты
Агаты/её тестов отдельным коммитом; проверки не удалять/не ослаблять. Вернуть diff
Replit. Полный gate, validate-native.sh и AppDev не запускать.

## Одна сборка и установка

После успешных тестов — существующий device DerivedData, подключённый iPhone,
тот же Xcode. Сначала убедиться, что нет активного звонка.

```sh
xcodebuild -project ios/TalkHint.xcodeproj -scheme TalkHint -configuration Debug \
  -destination "id=<CONNECTED_IPHONE_UDID>" \
  -derivedDataPath "<EXISTING_DEVICE_DERIVED_DATA>" build
plutil -extract CFBundleIdentifier raw \
  "<EXISTING_DEVICE_DERIVED_DATA>/Build/Products/Debug-iphoneos/TalkHint.app/Info.plist"
# Только app.talkhint, сервер https://talkhint.app; не Dev и не AppDev.
xcrun devicectl device install app --device "<CONNECTED_IPHONE_UDID>" \
  "<EXISTING_DEVICE_DERIVED_DATA>/Build/Products/Debug-iphoneos/TalkHint.app"
xcrun devicectl device process launch --device "<CONNECTED_IPHONE_UDID>" app.talkhint
```

Установка поверх, не uninstall. Платную кнопку шара нажимает только владелец.
При ручной попытке сохранить фильтрованные `AgataRTC`-события: offer/local SDP,
HTTP status SDP POST, remote SDP, PATCH statuses, ICE states, joined/error/stop.
Не сохранять токены, SDP, candidate IPs, текст речи. Не делать новую попытку
автоматически при ошибке.

## Результат

Replit выполнил 7/7 Python source contracts и diff check. Swift/XCTest, сборка,
звук и Bluetooth на Replit не проверены: Mac/Xcode недоступны.
Вернуть коротко: ветка/HEAD, passed/failed/skipped целевых тестов, время тестов
и сборки, установка, новые предупреждения, ссылки на логи; что ещё не проверено.
ZIP не нужен. Для отката — последняя рабочая сборка; не удалять данные,
не менять сервер и не откатывать Git силой.

## Владельцу на телефоне — ровно 3 проверки

1. Сотовая связь: имеющийся чат → шар → короткая фраза. Нет обрыва около 8 с;
   появляются ответ/состояния Orb, текст сохраняется в этом же чате. Записать время.
2. Открыть шар и сразу нажать стоп; затем открыть ещё раз. Нет зависания,
   продолжающегося звука или действий от прежнего сеанса.
3. Коротко повторить с Bluetooth/наушниками; выйти обратно в приложение.
   Звук/микрофон прекращаются, история сохранена, обычные разделы не изменены.
