# Claude на Mac: одна обычная сборка TalkHint для talkhint.app

## ЕДИНСТВЕННОЕ АКТУАЛЬНОЕ ЗАДАНИЕ: восстановление микрофона + UI

### Продолжение после ошибки компиляции теста

На bafc845f build-for-testing завершился exit 65: circular reference в
CaptureSupervisorFixture.supervisor. **37 XCTest НЕ запускались**, device build
и установка НЕ выполнялись; на телефоне осталась прежняя сборка.

Минимальная дельта от bafc845f: код **f65ba85d6a6875638ae6245daf6b491c4a3a339e**,
ios-tree **cb6a749f455a49fa4e58b918d5e170f24e7b54a1**. В Swift изменена ровно
одна строка теста: явный тип `lazy var supervisor: ChatVoiceCaptureSupervisor`.
Добавлен Python guard этой аннотации; 15 относящихся к фикстуре source-проверок
PASS. Файлы приложения, остальные тесты и compiler settings не менялись.
Эта проверка не доказывает успешную компиляцию в Xcode.

Получить новую вершину той же ветки fast-forward без удаления/clean/worktree.
**Продолжить ровно шаги 2–5 ниже**: тёплый incremental build-for-testing,
те же 37 scoped XCTest, обычная TalkHint/Debug/iphoneos сборка и установка
без удаления данных. Не повторять старые полные gate и Python-проверки
неизменённых файлов. Прежний неуспешный build.log сохранить, новым попыткам
дать отдельные имена; успешный xcresult предыдущая попытка не создала.
Если обнаружится следующая ошибка — точный текст и отдельный патч, без
установки не прошедшей проверки сборки. Publish/платные пробы/микрофон — нет.

**Выполнить только этот раздел. ВСЁ ниже раздела «ИСТОРИЯ ПАТЧА ЭКРАНА» —
архив прежних заданий, не запускать их последовательно.**

База этой дельты: **7da52ecfcc1e3b73e573207cce3e804d6b883b55**.
Код исправления: **829b16d7b63466e37033d6069f109c2d3b0e3f9b**,
ios-tree **9f531e7746758291e0cec0a2a386900e6e16e0e9**.
Новые точные code commit / ios-tree указаны в docs/chat-voice-native-delta.json.
Получить ту же ветку **xcode-chat-voice-sarah-2026-11-11**; не переносить
сервер из этой native-ветки в production.

### Что исправлено и что пока не доказано

- Собственный AVAudioEngineConfigurationChange и смена маршрута идут через
  один supervisor: максимум один restart на период владения движком.
- Незавершённая запись удаляется; новый tap/converter/recording ID не принимают
  старые буферы. После restart UI просит повторить фразу. Playback при смене
  маршрута не проигрывается заново: безопасная остановка с ошибкой.
- Watchdog на отдельном main-run-loop таймере, не на audio callback: 2 с без
  первого/следующего буфера — ошибка вместо вечного Listening. При restart
  время ожидания сбрасывается один раз. После закрытия/потери доступа/звонка
  recovery не стартует. Старые timer/notification tasks защищены epoch.
- Session category/mode, activation и voice processing настраиваются до tap
  и prepare/start. Формат tap читается после настройки и повторно после
  смены конфигурации; нулевые/невалидные форматы отклоняются. Порядок был
  правильным и раньше: первичный hardware/AEC-триггер не объявлять доказанным.
- HFP input разрешён для AirPods/автомобильного Bluetooth. Не форсируется
  speaker поверх внешнего маршрута; CarPlay остаётся выбором iOS. Реальный
  HFP/CarPlay/microphone пока НЕ проверен; не писать, что все машины поддержаны.
- Пять UI-правок: переводы по языку приложения (RU: «Слушаю»), убрать TTS/Dev
  названия, шапка TalkHint / локализованный голосовой чат, статус + последняя
  реплика вместо истории, живой listening pulse и реальные уровни отдельно.
  UIKit foreground передаётся Orb явно, системный Reduce Motion соблюдается.
- История, разговор, backend, Sarah, Flash, модели, voice consent, VAD 1.2,
  телефония/Катя/Retell, минимум iOS 15 и подпись не меняются.
- Replit: **77 source-contract + 53 script-теста PASS**; это не Swift/XCTest
  и не hardware test. Новых XCTest 14, будущий required gate 166.

### Один последовательный запуск на Mac

1. В прежнем чистом chat-voice-sarah-concurrency проверить HEAD/status,
   fast-forward до новой вершины ветки. Если есть локальные изменения или
   непереданные Mac-коммиты — остановиться и сообщить; не reset/stash/clean.
   Проверить diff от базы 7da52ecf и Git-аудит manifest. Включить новые Swift
   файлы штатным неизменённым XcodeGen. Не делать новый worktree, не удалять
   DerivedData/SPM/симуляторы, не менять signing, URL, bundle или AppConfig.
2. Переиспользовать успешные NativeValidation/ad-hoc/.invalid параметры и
   тёплый DerivedData. Один build-for-testing нового дерева, затем один
   test-without-building с семью ограничениями:
   ```
   -only-testing:TalkHintTests/ChatVoiceCaptureHealthTests
   -only-testing:TalkHintTests/ChatVoicePresentationTests
   -only-testing:TalkHintTests/ChatVoiceScreenTests
   -only-testing:TalkHintTests/ChatVoiceOrbTests
   -only-testing:TalkHintTests/ChatVoiceClientPolicyTests
   -only-testing:TalkHintTests/ChatVoiceSessionTests
   -only-testing:TalkHintTests/ChatVoiceSpeechStateTests
   ```
   Ожидается **37 = 12+2+2+4+5+6+6**, 0 failed, 0 skipped. Новый xcresult,
   старые результаты сохранить. Новый fixture действительно доставляет
   AVAudioEngineConfigurationChange своему NSObject через NotificationCenter,
   но restart/clock/engine-state — fake. Не выдавать это за работу AVAudioEngine
   на железе. Ни один тест не должен просить микрофон/сеть/TTS/модель.
   Для scoped receipt использовать ниже приведённую отдельную проверку.
   Полный gate не повторять и общую verify-xcresult.py не ослаблять.
   ```bash
   python3 - "$BUNDLE" <<'PY'
   import runpy, sys
   m = runpy.run_path("ios/scripts/verify-xcresult.py")
   root = m["read_result"](sys.argv[1])
   passed = set()
   for action in root["actions"]["_values"]:
       result = action["actionResult"]
       assert result.get("status", {}).get("_value") == "succeeded"
       ref = result.get("testsRef", {}).get("id", {}).get("_value")
       if ref:
           passed.update(m["successful_tests"](m["read_result"](sys.argv[1], ref)))
   suites = ("ChatVoiceCaptureHealthTests", "ChatVoicePresentationTests",
             "ChatVoiceScreenTests", "ChatVoiceOrbTests", "ChatVoiceClientPolicyTests",
             "ChatVoiceSessionTests", "ChatVoiceSpeechStateTests")
   for suite in suites:
       for method in m["REQUIRED_TESTS"][suite]:
           assert any(suite in p and method + "()" in p for p in passed), (suite, method)
   assert len(passed) == 37, len(passed)
   print("SCOPED PASS: 37/37; not a full native gate or microphone test")
   PY
   ```
3. Только при PASS — одна incremental **TalkHint / Debug / iphoneos** сборка.
   Сохранить **app.talkhint**, callback **talkhint**, backend **talkhint.app**,
   прежнюю Apple Team/signing/APNs. Не делать AppDev, Archive/TestFlight,
   dependency update, серверный build/Publish. Новые compiler warnings от
   дельты перечислить отдельно (в частности SDK deprecation allowBluetooth);
   не скрывать их аннотациями или сменой Swift mode.
4. Владелец разрешил установку: убедиться, что нет активного звонка, обновить
   существующее приложение, НЕ удаляя данные/Keychain/само приложение, открыть
   обычный Chat. Не отправлять сообщения/не нажимать микрофон и не запускать
   платные пробы. Экран шара можно открыть/закрыть только если это не возобновит
   старую pending-озвучку; иначе оставить проверку владельцу. На безопасном
   открытом экране сделать крупный реальный скриншот, не HTML/коллаж.
5. Вернуть коротко: commit/tree, **фактический** результат 37 тестов и xcresult,
   длительность test/build, новые warnings, identity/origin signed app,
   установлено ли без потери данных, что проверено визуально. Явно оставить
   микрофон/AirPods/Bluetooth/CarPlay непроверенными до ручного теста владельца.
   Если тест/build не проходит — остановиться с точной ошибкой, не устанавливать
   и не начинать второй полный gate. Исправления Claude вернуть отдельным
   commit/patch, не смешивать с чужими файлами. Откат — предыдущая 7da52ecf
   через ту же обычную сборку с сохранением данных; её голосовой capture сломан,
   поэтому voice до этого отката не рекомендовать.

## ИСТОРИЯ ПАТЧА ЭКРАНА — не выполнять повторно

## АКТУАЛЬНО: точечное исправление падения голосового экрана

**Выполнять только этот раздел. Ниже — прежнее задание, уже выполненное
на 79545ad4 (299/299, device build 15 с). Не повторять старый полный gate.**

На iPhone зафиксировано NSGenericException: height constraint orb/root
активировался до общего ancestor. Это ошибка сборки иерархии экрана,
не Retell, не модель и не Twilio vendor warning.

Новый код **8ba36d6d**, ios-tree **a01be2ed756653b1150b315798d757e934ab5912**,
поверх 79545ad4. Только четыре native-пути:
- ChatVoiceViewController.swift: активировать cross-view constraint после
  добавления stack в root; завершить containment didMove после вставки.
- ChatVoiceScreenTests.swift: два полных load/layout теста без сети, появления
  в окне, аудиосессии и микрофона, два размера/две темы.
- verify-xcresult.py: добавить оба теста в будущие обязательные полные gate.
- test_mac_voice_delivery_source_contract.py: проверить порядок вставки/constraint.

Сервер, подпись, существующие голос/модель/таймеры и API не менялись.
Replit: 71 source-contract + 53 script-теста PASS. Это не нативный запуск.

1. В прежнем чистом chat-voice-sarah-concurrency получить ту же GitHub-ветку,
   проверить прямой diff от 79545ad4: ровно четыре native-пути и документы.
   Fast-forward, без stash/reset/clean/нового worktree. Git-аудит по manifest.
2. Переиспользовать прежний DerivedData/SPM. XcodeGen должен включить новый
   ChatVoiceScreenTests.swift в target. Применить прежние NativeValidation/
   ad-hoc/isolated .invalid параметры из успешного gate; build-for-testing
   нового дерева, затем test-without-building **только**:
   ```
   -only-testing:TalkHintTests/ChatVoiceScreenTests
   -only-testing:TalkHintTests/ChatVoiceOrbTests
   -only-testing:TalkHintTests/ChatVoiceClientPolicyTests
   ```
   Всего ожидается **11** тестов (2+4+5), все успешны, 0 skipped.
   Новый xcresult, старый не перезаписывать. Не вызывать viewDidAppear
   вручную в fixture, не выдавать capture permission, не обращаться к API.
   Общий verify-xcresult требует теперь 152 обязательных успеха и закономерно
   не пройдёт на focused run; его не ослаблять/не изменять.
   Для точной проверки scoped evidence разрешён такой отдельный read-only
   вызов (BUNDLE — реальный новый xcresult):
   ```bash
   python3 - "$BUNDLE" <<'PY'
   import runpy, sys
   m = runpy.run_path("ios/scripts/verify-xcresult.py")
   root = m["read_result"](sys.argv[1])
   passed = set()
   for action in root["actions"]["_values"]:
       result = action["actionResult"]
       assert result.get("status", {}).get("_value") == "succeeded"
       ref = result.get("testsRef", {}).get("id", {}).get("_value")
       if ref:
           passed.update(m["successful_tests"](m["read_result"](sys.argv[1], ref)))
   suites = ("ChatVoiceScreenTests", "ChatVoiceOrbTests", "ChatVoiceClientPolicyTests")
   for suite in suites:
       for method in m["REQUIRED_TESTS"][suite]:
           assert any(suite in p and method + "()" in p for p in passed), (suite, method)
   assert len(passed) == 11, len(passed)
   print("SCOPED PASS: 11/11 voice-screen/orb/policy tests; not a full native gate")
   PY
   ```
3. Если хотя бы один новый тест падает — остановиться с точным текстом,
   без установки. Если всё проходит — одна incremental TalkHint/Debug/
   iphoneos сборка с прежней подписью, app.talkhint/callback talkhint/
   backend talkhint.app; без AppDev, clean, обновления SPM и Publish.
4. Владелец уже разрешил установку/открытие обычного TalkHint. При отсутствии
   активного звонка обновить то же приложение без удаления данных/Keychain
   и без смены подписи; открыть обычный Chat. Только после успешных тестов
   можно проверить открытие и закрытие экрана шара **без нажатия микрофона**.
   Если открытие может восстановить старую pending voice-generation/озвучку,
   не открывать автоматически: сообщить и дождаться решения владельца.
   Отдельных платных STT/LLM/TTS, сообщений, звонков не запускать.
5. Вернуть **фактический** scoped результат 11 тестов, exit code/xcresult,
   длительность, device build и runtime opening если проверен. Не писать,
   что прежние 299 доказали новое дерево. Для будущего полного gate ожидается
   301 XCTest/152 required, но сейчас полный прогон не назначен.

## ИСТОРИЯ: выполненное задание 79545ad4 (не запускать повторно)

## Разрешение и точная цель

Владелец опубликовал сервер и выбрал «Обновить обычное TalkHint».
Нужна **обычная схема TalkHint / Debug**, bundle **app.talkhint**, URL-схема
**talkhint**, backend **https://talkhint.app**. Это не AppDev/ChatLiveDev,
не новая копия приложения, не Archive/TestFlight и не смена APNs-окружения.
Debug-подпись Xcode может использовать sandbox push — рабочий backend не
означает, что нужно менять подпись или объявлять сборку Release.

Собрать и проверить; **установку и Run пока не выполнять автоматически**.
Микрофон, отправку сообщений, STT/LLM/TTS, письма, звонки и репетиции не запускать.
Не менять Apple Team, provisioning, entitlements, bundle, Keychain, сертификаты,
модели, голос, таймеры, Катю, Retell и сервер; не делать Publish.

## Уже сделано — не повторять на старом дереве

- Принятая Mac-база: `c997a2d794099b0c1c5805cf18b49eaf233eb1a6`.
- Предыдущие 294/294 XCTest и AppDev Simulator — на `8d42c9f8`.
- Родитель новой дельты `2071443fbc8c7ec6ab67d2996a9b36aeb2de52e3`
  отличается от принятого дерева только документами.
- Новый код: `ffdfca9df670c45ec9eaa0197db4bf0fcbba4527`.
- Новое ios-дерево: `6d7ffdb1f9c05c911145f137250eb62e4e1e1cb1`.
- Сервер проверен после Publish: `a2e4d3c`, production/БД OK;
  chat_voice_days, chat_voice_requests, chat_voice_latency и два индекса есть.
- Нативного запуска нового кода на Replit/Linux не было.

Новая дельта — только семь native-путей:
1. ChatVoiceClientPolicy.swift: обычное приложение допускает точный HTTPS
   talkhint.app; Dev-origin и изолированные тесты не переходят в production.
2. ChatViewController.swift: этот допуск вместо Dev-only, **вместе** с прежним
   owner capability сервера, проверкой текущей сессии и conversation ID.
   Дополнительная проверка capability также сохранена перед voice submit.
3. ChatVoiceClientPolicyTests.swift: пять новых тестов.
4. Три source contract: voice session, approved screen, dictation.
5. verify-xcresult.py: пять новых обязательных успехов, старые не удалены.

AppConfig, project.yml, подпись, OAuth, навигация и телефонные обработчики
не изменялись. Ветку собрали поверх принятой Mac-истории, не поверх серверного
HEAD. Backend из этой нативной ветки старый — **его нельзя публиковать**.

## Получение: существующий чистый worktree, без очередной копии

Работать в `~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency`,
где уже проходил принятый gate. Перед изменением прочитать status/HEAD,
сохранить прежние логи/xcresult/binary. Ничего не чистить.

```bash
cd "$HOME/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency"
git status --short
git rev-parse HEAD
git fetch origin refs/heads/xcode-chat-voice-sarah-2026-11-11
TARGET=$(git rev-parse FETCH_HEAD)
git diff --stat HEAD "$TARGET"
git show "$TARGET:docs/chat-voice-native-delta.json"
```

При грязном checkout, незнакомых новых коммитах или расхождении семи native
путей — остановиться, не применять stash/reset/clean/rebase/force.
Если чистый HEAD — предок TARGET из этой принятой цепочки:

```bash
git merge-base --is-ancestor HEAD "$TARGET" &&
git merge --ff-only "$TARGET"
python3 scripts/verify-chat-voice-native-delta.py
python3 -m unittest discover -s ios/tests -p 'test_*source_contract.py'
python3 -m unittest discover -s ios/scripts/tests
```

Не брать весь main/серверную ветку и не переносить повторно старые патчи.

## Одна связная проверка, затем одна рабочая device-сборка

1. Прочитать Xcode/SDK/SPM pin и свободное место. Использовать прежние
   версии и кэши; не обновлять пакеты, не удалять DerivedData/симуляторы.
   Если места недостаточно — сообщить до долгой сборки, ничего не удалять.
2. На новом дереве один раз выполнить полный изолированный алгоритм
   `ios/scripts/validate-native.sh`: источник Compile Sources, ad-hoc
   entitlements, все XCTest и verify-xcresult. Это **не пользовательская
   Dev-сборка**, а test-host с `.invalid` backend без платных операций.
   Для экономии допустимо выполнить те же команды алгоритма вручную с
   DerivedData ранее принятого NativeValidation из отчёта Mac: сохранить
   все параметры изоляции, не переиспользовать старый compiled test bundle,
   выполнить build-for-testing нового дерева и test-without-building,
   отдельный новый xcresult и обе проверки entitlements/xcresult.
   Сам protected validate-native.sh не изменять. Если запущен исходный
   скрипт, он создаёт/удаляет только собственный временный simulator.
   Не запускать одновременно ещё один gate и не повторять прошедший
   прогон, пока код не изменился.
3. Ожидаем 294 прежних + 5 новых = **299 тестов**, **150 обязательных
   успехов**. Это ожидание, не готовый результат: вернуть фактические
   passed/failed/skipped и verify-xcresult. Изолированный currentBuild
   обязан запрещать production voice. Ошибку не «лечить» отключением теста.
4. XcodeGen по неизменённому project.yml, затем **TalkHint / Debug / iphoneos**.
   Использовать существующий DerivedData/SPM cache этого проекта и
   существующую подпись без `-allowProvisioningUpdates`. Не собирать AppDev.
   Без подходящего уже установленного profile/identity — сообщить блокер;
   не создавать/скачивать/менять подпись самостоятельно.
   При необходимости unsigned build допустим только как диагностика:
   его нельзя объявлять устанавливаемым.
5. У фактического device .app проверить:
   - product TalkHint, CFBundleIdentifier app.talkhint;
   - единственная OAuth URL-схема talkhint;
   - в обычной Run-схеме HTTPS talkhint.app, нет Dev override;
   - Debug без TALKHINT_APP_DEV/TALKHINT_CHAT_LIVE_DEV/
     TALKHINT_NATIVE_VALIDATION/TALKHINT_CHAT_PREVIEW;
   - Mach-O platform iOS/arm64, minimum iOS 15;
   - существующие Team/entitlements/APNs не менялись.
   Runtime origin после запуска ещё **не проверен** — не путать с build settings.

Не делать дополнительную обычную Simulator-сборку после успешного полного
gate без конкретной причины. Старые 78 warning/39 “Unbalanced calls” —
не новые ошибки этой дельты; сравнить свежие, не подавлять и не исправлять
телефонию попутно. При новом падении/опасном предупреждении вернуть точное
место и минимальный патч Replit для проверки, не делать самостоятельный push.

## Отчёт и остановка

Вернуть коротко: HEAD/native tree, diff из семи native-путей, исходный
DerivedData (новый/переиспользован), время gate и сборки по отдельности,
actual tests + verify-xcresult, build result, product/bundle/callback/origin,
подпись готова или точная причина отсутствия. Не показывать UDID/секреты.

Если всё прошло — открыть владельцу правильный проект и указать схему
**TalkHint**, устройство **его iPhone**, но **Run не нажимать**.
Старое приложение/данные не удалять. Следующий шаг — согласованная установка
вместо текущего app.talkhint, вход владельца и сначала неплатная проверка UI.
Вторую app.talkhint.chatdev не запускать и не удалять автоматически.
Звук, AEC, перебивания и задержки не считать проверенными до отдельного
разрешённого испытания на реальном устройстве.
