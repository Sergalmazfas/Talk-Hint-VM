# Claude на Mac: одна обычная сборка TalkHint для talkhint.app

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
