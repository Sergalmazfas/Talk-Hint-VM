# Клавдию: громкость Агаты — одна iOS-сборка

## База и цель

- Репозиторий: https://github.com/Sergalmazfas/Talk-Hint-VM
- Постоянная ветка: `xcode-chat-voice-sarah-2026-11-11`.
- База, включая возвращённую Mac-правку типов: `f09ace7f4200fde198808e4f6e8611031eb81408`.
- Целевой коммит кода: `572f1c72c981f17940313dd12a7895669ac7322d`.
- Существующая рабочая копия: `~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency`.
- Только обычный TalkHint: `app.talkhint`, production `https://talkhint.app`.
- **Сервер не менялся; новый Publish не требуется.** Серверную ветку не переносить.

Разрешены адресные неплатные тесты, одна incremental-сборка и установка поверх
без удаления данных. Никаких AppDev, полного gate, ZIP, новых симуляторов,
очистки кэшей, обновления зависимостей, изменения подписи, Archive/TestFlight.
Не открывать шар и не запускать звонки/AI самостоятельно. При активном звонке
не устанавливать и не перезапускать приложение.

## Доказанная ошибка / что пока неизвестно

В прежнем коде `.defaultToSpeaker` устанавливался на текущей аудиосессии
перед созданием factory. Но WebRTC при старте устройства применяет свою
`webRTCConfiguration`: playAndRecord / voiceChat / Bluetooth **без defaultToSpeaker**.
Подтверждено для закреплённого M156, upstream
`2a990ce0ccd00a3ad449f2201a8e5c2dad53177d`:

- [Исходные настройки M156](https://webrtc.googlesource.com/src/+/2a990ce0ccd00a3ad449f2201a8e5c2dad53177d/sdk/objc/components/audio/RTCAudioSessionConfiguration.m#55)
- [Повторное применение конфигурации при старте](https://webrtc.googlesource.com/src/+/2a990ce0ccd00a3ad449f2201a8e5c2dad53177d/sdk/objc/components/audio/RTCAudioSession.mm#739)
- [Релиз закреплённой библиотеки](https://github.com/stasel/WebRTC/releases/tag/156.0.0)

Это доказанный дефект настройки, но **не запись фактического маршрута iPhone
в жалобе владельца**. Не объявлять слышимость исправленной до его проверки.
Если уже speaker + volume=1, а тихо осталось — сохранить диагностику,
не усиливать произвольно и не менять агента/голос.

Новый helper перед factory устанавливает отдельную копию RTC-template
с defaultToSpeaker + Bluetooth, сохраняя sample rate/buffer/channels.
После закрытия локального media восстанавливает прежний template, только если
его не заменил новый владелец. Не меняет активную сессию CallKit, не вызывает
setActive, overrideOutputAudioPort, setPreferredInput и не усиливает сигнал.
Маршрутами наушников/Bluetooth управляет система, не принудительный speaker.

Диагностика `subsystem=app.talkhint`, `category=AgataAudio`: speaker/receiver/
Bluetooth/headphones, системная громкость, category/mode/defaultSpeaker,
признак телефонного аудио, входящий RMS (не физическая слышимость).
До старта audio device — `before_device`; затем `received_audio` раз в 5 с
и `route_changed` с числовой причиной; при закрытии — `stop`.
Без имён устройств, UID, текста разговора, токенов, SDP и IP.

## Получение и только адресные проверки

```sh
cd ~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency
git status --short
# При чужих изменениях или расхождении истории — СТОП, без stash/reset/force.
git fetch origin xcode-chat-voice-sarah-2026-11-11
git merge --ff-only origin/xcode-chat-voice-sarah-2026-11-11
git merge-base --is-ancestor 572f1c72c981f17940313dd12a7895669ac7322d HEAD
python3 ios/scripts/tests/test_agata_audio_contract.py -v
python3 ios/scripts/tests/test_agata_trickle_contract.py -v
xcodegen generate --spec ios/project.yml
plutil -convert json -o /tmp/talkhint-agata-speaker-project.json ios/TalkHint.xcodeproj/project.pbxproj
python3 ios/scripts/verify-project-sources.py /tmp/talkhint-agata-speaker-project.json ios
```

Использовать существующие Simulator UUID, Xcode и кэши. Не подменять действующий
способ подписи симулятора: он уже проверялся на этом Mac.

```sh
xcodebuild -project ios/TalkHint.xcodeproj -scheme TalkHintValidation \
  -destination "platform=iOS Simulator,id=<EXISTING_SIMULATOR_UDID>" \
  -only-testing:TalkHintTests/ChatAgataAudioRoutingTests \
  -only-testing:TalkHintTests/ChatAgataTrickleTests \
  -only-testing:TalkHintTests/ChatAgataTests \
  -only-testing:TalkHintTests/CallAudioDeviceRouterTests \
  test
```

Обязательны все 8 новых `ChatAgataAudioRoutingTests`: настройки RTC-template,
копирование без изменения прежнего объекта, сохранность аппаратных параметров,
восстановление/повторное закрытие, закрытие после нового владельца, повторное
использование, различение маршрутов, маскирование неизвестных портов и bounds.
Тесты используют фальшивый store template и не активируют аудио/Retell.
Они не доказывают физическую громкость, переключение Bluetooth на iPhone
или работу реального микрофона.

Новая ошибка/предупреждение — вернуть точный текст. Допустим минимальный фикс
только дельты Агаты отдельным коммитом, без ослабления тестов; отправить обратно
в эту же GitHub-ветку для проверки Replit. Не тратить часы на полный gate.

## Одна сборка, установка поверх, краткий результат

После целевых тестов использовать прежний device DerivedData и подключённый
iPhone. Сохранить bundle, сервер, signing Team, iOS 15 и все данные.

```sh
xcodebuild -project ios/TalkHint.xcodeproj -scheme TalkHint -configuration Debug \
  -destination "id=<CONNECTED_IPHONE_UDID>" \
  -derivedDataPath "<EXISTING_DEVICE_DERIVED_DATA>" build
plutil -extract CFBundleIdentifier raw \
  "<EXISTING_DEVICE_DERIVED_DATA>/Build/Products/Debug-iphoneos/TalkHint.app/Info.plist"
# Должно быть app.talkhint, НЕ app.talkhint.chatdev.
xcrun devicectl device install app --device "<CONNECTED_IPHONE_UDID>" \
  "<EXISTING_DEVICE_DERIVED_DATA>/Build/Products/Debug-iphoneos/TalkHint.app"
xcrun devicectl device process launch --device "<CONNECTED_IPHONE_UDID>" app.talkhint
```

Replit: 13/13 source-contract проверок прошли; Swift/XCTest/сборка и физический
звук здесь не проверены — Mac/Xcode недоступны. Клавдий возвращает коротко:
точный установленный SHA, результаты XCTest passed/failed/skipped, время,
установлено ли поверх, новые предупреждения и что осталось не проверено.
Платную кнопку шара нажимает только владелец; сам не делать пробных сессий.
При его ручной проверке сохранить только AgataAudio/AgataRTC, без речи и ключей.

## Владельцу на телефоне — ровно 3 проверки

1. Без наушников открыть Агату. Ответ должен идти через громкий динамик
   и быть разборчивым без максимальной громкости. Если тихо — записать время;
   Клавдий сопоставит `received_audio` (не `before_device`), outputs/volume/RMS.
2. Подключить и отключить имеющиеся наушники/Bluetooth: звук следует выбранному
   устройству, после отключения возвращается на динамик; нет самоперебивания.
3. Нажать стоп и вернуться в приложение: звук и микрофон прекращаются, история
   остаётся. Работу следующего обычного звонка проверяет владелец при своём
   разрешённом использовании; Клавдий телефонный звонок не запускает.
