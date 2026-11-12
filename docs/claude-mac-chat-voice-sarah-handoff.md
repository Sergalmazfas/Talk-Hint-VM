# Claude на Mac: Sarah, ограниченная дельта поверх принятой базы

## Что разрешено

Владелец разрешил подготовить следующую дельту и передать её для проверки.
Разрешены: сверка Git/исходников, отдельный worktree, **полный неплатный native gate**
и сборка **TalkHintAppDev для Simulator без установки/Run**.
При нехватке места, несовпадении базы, ошибке инструментов или тестов —
остановиться и вернуть точный отчёт. Не повторять gate до зелёного без разбора.

Запрещены: Publish/deploy, Archive/TestFlight, настоящий набор номера,
платные STT/AI/TTS-пробы, отправка писем, старт микрофона владельца,
изменения Кати/Retell/моделей/таймеров, Apple Team/APNs/сертификатов/ключей.
Не запускать backend из этой ветки; он сохранён из старой Mac-базы.
Не чистить диск, кэши, Корзину, приложения, Keychain или чужие симуляторы.
Нет разрешения на новые установки/обновления инструментов или изменения Git-авторизации.

## Точная передача

- Repo: `Sergalmazfas/Talk-Hint-VM`, не TalkHint-Clean.
- Новая ветка: `xcode-chat-voice-sarah-2026-11-11`.
- Принятая Mac-база: `c997a2d794099b0c1c5805cf18b49eaf233eb1a6`.
- Первый слой зависимостей: `649ff8a4f84c314f5d0fef2948de276627c9c357`.
- Коммит нативного кода: `2c3ff980da15550b5eef5b1b20f99ba532d350d7`.
- Последний HEAD ветки добавляет только документы и read-only валидатор;
  именно на нём запускать полный gate. Не тестировать вместо него один старый слой.
- Точный hash дерева `ios/`: `1b496171f71be714901224ac457bca8f0058e755`.
- JSON: `docs/chat-voice-native-delta.json`.
- Разбор состава: `docs/chat-voice-native-delta-audit.md`.

Ветка — потомок оригинального c997a2d, не merge всего Replit Dev.
Исходные Mac SHA/авторство сохранены. Не cherry-pick поверх неизвестного checkout,
не копировать весь ios из ZIP, не удалять или переписывать существующие ветки.

## 1. Preflight на существующем Mac checkout

Ранее принятый checkout: `~/Talk-Hint-VM-worktrees/iphone-ready`.
Сначала проверить фактическое существование, repo, branch, полный HEAD,
`git status --short`, Xcode/SDK/XcodeGen/Python, свободное место и состояние swap.
Текущий HEAD должен остаться c997a2d; если появились более поздние правки —
сообщить и остановиться, не терять их.

Места на Mac было мало. До gate оценить место по доступным размерам прежнего
DerivedData/xcresult и запасу под новый build. Если достаточность не подтверждается,
вернуть конкретный блокер вместо запуска сборки/самовольной очистки.
Не печатать конфиги с секретами, токены или их значения.

## 2. Получить ветку, не меняя принятую рабочую копию

Из проверенного существующего repo:

```bash
git fetch origin refs/heads/xcode-chat-voice-sarah-2026-11-11
TARGET=$(git rev-parse FETCH_HEAD)
git merge-base --is-ancestor c997a2d794099b0c1c5805cf18b49eaf233eb1a6 "$TARGET"
git rev-parse "${TARGET}:ios"
git diff --stat c997a2d794099b0c1c5805cf18b49eaf233eb1a6 "$TARGET"
```

Записать полный TARGET. Проверить совпадение native tree с указанным выше.
Изменения вне ios допускаются только в четырёх support-путях из JSON.
GitHub Actions workflow не менялся и не включает push этой ветки
(в исходном Mac workflow автоматический push — только main).
Не создавать PR или вручную запускать Actions. Внешние webhooks не проверены.

Для сборки — **новый отдельный worktree**, например
`~/Talk-Hint-VM-worktrees/chat-voice-sarah-2026-11-11`.
Если путь существует, не перезаписывать: проверить HEAD/чистоту, при несовпадении стоп.

```bash
git worktree add --detach "$HOME/Talk-Hint-VM-worktrees/chat-voice-sarah-2026-11-11" "$TARGET"
cd "$HOME/Talk-Hint-VM-worktrees/chat-voice-sarah-2026-11-11"
python3 scripts/verify-chat-voice-native-delta.py
python3 -m unittest discover -s ios/tests -p 'test_*source_contract.py'
python3 -m unittest discover -s ios/scripts/tests
```

Без stash/reset/clean/rebase/force. Оригинальный worktree должен остаться неизменным.
Ниже команды выполнять только после успешного preflight и этих проверок.

## 3. Полный native gate

Сверить настоящий путь Xcode и версию, не подставлять старый `Xcode_16.4.app`:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  bash ios/scripts/validate-native.sh
```

Скрипт генерирует проект XcodeGen, компилирует все app/test source и запускает
**весь** TalkHintTests в NativeValidation без фильтров. Реальный backend отключён.
Используется ad-hoc подпись Simulator, а не сертификаты владельца.
Удаление только собственного временного simulator — штатная часть этого gate;
другие симуляторы/данные не трогать. Сохранить логи и xcresult.

Особо показать результаты:

- SceneLaunchTests: `testLoggedInRootLoadsCallsScreen`,
  `testLoggedInFlagWithoutStoredSessionShowsLogin`.
- Все 3 ChatAPITests и все 4 ChatOutboxTests (точные имена в REQUIRED_TESTS).
- Все 4 ChatVoiceOrbTests, 6 ChatVoiceSessionTests и 6 ChatVoiceSpeechStateTests.
- Полные ChatApprovedScreenTests, ChatNavigationTests, ChatDictationTests,
  ChatCallPlanModelTests, ChatPhoneContextTests, ChatAppShellTests.
- CopilotFreezeNavigationTests, SessionCredentialsTests,
  SecretaryPersonalityUITests, CallAudioDeviceRouterTests.
- `python3 ios/scripts/verify-xcresult.py <путь-к-новому-xcresult>`.
  Gate требует 141 конкретный успех и не заменяет общий passed/failed/skipped.

Если есть падение — не отключать тест и не ослаблять login/ожидания ради зелёного.
Вернуть имя, файл/строку, фактическое условие, логи, предложение минимальной правки.
Изменения кода возвращаются Replit для проверки отдельной дельтой;
в этом задании самостоятельное «лечение»/push новых коммитов не разрешено.

## 4. AppDev build — без Run

После успешного gate, если места достаточно:

```bash
set -o pipefail
OUT=$(mktemp -d "$PWD/generated-artifacts/sarah-appdev.XXXXXX")
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project ios/TalkHint.xcodeproj -scheme TalkHintAppDev \
  -configuration AppDev -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$OUT/DerivedData" CODE_SIGNING_ALLOWED=NO build \
  2>&1 | tee "$OUT/build.log"
```

Проверить **собранный** AppDev Info.plist:
bundle `app.talkhint.chatdev`, единственная URL-схема `talkhint-chatdev`,
TalkHintDevOrigin совпадает с AppDev в неизменённом `ios/project.yml` и
является Dev `.replit.dev`, не production. Показать команды/результаты проверки.
Не создавать третий bundle ID, не менять подпись/параметры ради обхода ошибки.

## Что проверено Replit, а что ещё нет

На извлечённом **конечном** нативном дереве:
66 source-contract и 53 script-теста PASS. Проверен оригинальный родитель,
сохранены все 268 объявленных Mac test-методов (это не число выполненных XCTest).
Все 121 именованное требование старого gate сохранены; новый список — 141.
Исправлено устаревшее ожидание четырёх вкладок в Python-проверке на пять с Chat.

Xcode/XCTest, физический iPhone, акустика/AEC, три полных замера и настоящее
бюджетное письмо здесь **не проверены**. 251/138/140 мс из прежних MP3 —
не end-to-end замеры. Нет разрешения добирать их новыми платными запросами.
Автоматическое подтверждение звонка голосовым «да» остаётся закрытым,
пока нет фактического audible-readback. Не объявлять эту возможность готовой.

## Что вернуть и где остановиться

Полный HEAD, native tree, Xcode/XcodeGen/SDK/simulator/SPM версии; команды;
проверки bundle/URL/origin; build/test логи, xcresult;
passed/failed/skipped, обязательные тесты отдельно; старые/новые warnings
(включая Unbalanced calls, если повторятся); точное «готово к ручной проверке»
или блокер. Указать что не проверено на настоящем iPhone.
Скриншоты из fixture-тестов можно приложить крупно, но не выдавать их за
проверенный подключённый голосовой разговор на телефоне.

При успехе **остановиться перед установкой/Run и платными пробами**.
Владелец отдельно выберет запуск на своём iPhone; Replit проверит отчёт.
Publish сайта iPhone-приложение не обновляет.

Откат: открыть прежний checkout/проект c997a2d; он не изменён. Keychain, переписку
и приложение не удалять. Даже после BUILD SUCCEEDED не писать, что физический
голос проверен или production обновлён.
