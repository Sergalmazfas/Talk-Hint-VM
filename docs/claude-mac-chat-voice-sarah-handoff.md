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
Очистка разрешена **только в пределах отдельного разрешения 1а ниже**.
Остальной диск, Корзину, приложения, macOS Keychain и другие симуляторы не трогать.
Нет разрешения на новые установки/обновления инструментов или изменения Git-авторизации.

## Точная передача

- Repo: `Sergalmazfas/Talk-Hint-VM`, не TalkHint-Clean.
- Новая ветка: `xcode-chat-voice-sarah-2026-11-11`.
- Принятая Mac-база: `c997a2d794099b0c1c5805cf18b49eaf233eb1a6`.
- Первый слой зависимостей: `649ff8a4f84c314f5d0fef2948de276627c9c357`.
- Коммит нативного кода: `9a2b020ce5e0eb7098a87e6bd5c2696103056487`.
- Последний HEAD ветки добавляет только документы и read-only валидатор;
  именно на нём запускать полный gate. Не тестировать вместо него один старый слой.
- Точный hash дерева `ios/`: `62c0863d7618c4b4fc784e3f879c263c5d9f3dc4`.
- JSON: `docs/chat-voice-native-delta.json`.
- Разбор состава: `docs/chat-voice-native-delta-audit.md`.

Ветка — потомок оригинального c997a2d, не merge всего Replit Dev.
Исходные Mac SHA/авторство сохранены. Не cherry-pick поверх неизвестного checkout,
не копировать весь ios из ZIP, не удалять или переписывать существующие ветки.

## 1. Preflight на существующем Mac checkout

### Исправление по отчёту gate c9804f5

Второй Mac gate скомпилирован и выполнен: **293 теста, 291 passed,
2 failed, 0 skipped**. Упали только два render-теста ChatVoiceOrbTests:
они требовали непустой `UIHostingController.view.subviews`.
Диагностика Claude показала реальное изображение во всех 20 комбинациях,
но UIKit subviews отсутствуют: это не публичный контракт SwiftUI.
Общий verify-xcresult правильно отказал; 141 обязательный успех как полный
набор не подтверждён. AppDev не собирался.

Новая дельта `9a2b020c` меняет **только native-тест и его source-проверку**:
- сохраняет 4 Orb-теста и все 141 required-success;
- вместо UIKit subviews проверяет изображение из прозрачного UIWindow
  с layout/flush и `drawHierarchy(afterScreenUpdates: true)`;
- прозрачный контроль обязан дать 0 видимых пикселей, Orb — более 1000
  в снимке 320×320. По диагностике Claude Orb давал около 50–61 тыс.;
  порог не является точным эталоном внешнего вида;
- RGBA преобразуется в явный формат, учитывается alpha > 16;
- сохраняет снимки в xcresult, закрывает только своё окно, восстанавливает
  прежнее ключевое окно. Аудио/API не запускаются.

Код приложения, включая Reduce Motion override, не изменён этой дельтой.
Это гипотеза исправленного теста до повторной проверки на Mac,
не объявлять gate пройденным по Python.

Сохранить `gate-c9804f5.log`, `TalkHintTests.xcresult` и orb-diag/orb-diag2.
По последнему отчёту 12 GiB свободно; снова измерить, очистку не повторять.
В полном gate было **15 “Unbalanced calls”**, происхождение не установлено.
В отчёте нового gate указать полный текст предупреждений, соседние строки
и активные тесты/время. Сравнивать только с уже имеющимися старыми логами:
не объявлять их безвредными или вызванными Orb без доказательств.
Если доступно — приложить эту же разметку из `gate-c9804f5.log`.
Не скрывать предупреждения и не чинить другую навигацию самостоятельно.

### Исправление по отчёту gate 23ae646

На `23ae646` test target не скомпилировался: `ChatVoiceOrbTests.swift:46`
пытался записать read-only `EnvironmentValues.accessibilityReduceMotion`
через `.environment`. Exit 65; XCTest не запущены, xcresult нет.
AppDev не собирался. Это не успешный gate и не ошибка рабочего аудиотракта.

Дельта `394eb79c`:
- `ChatVoiceOrbView`: внутренний необязательный `reduceMotionOverride`,
  по умолчанию nil → используется системная настройка, как раньше.
  Все четыре решения об анимации используют одно эффективное значение.
- `ChatVoiceOrbTests`: тот же обязательный тест рендеринга UIHostingController,
  с override вместо записи в read-only environment; проверяет nil/true/false.
- Source-проверка запрещает возврат ошибочной записи environment.
  Тесты не удалены и required-success список не ослаблен.

Разрешённая очистка уже выполнена по отчёту Claude: Preview-17 удалён,
Preview-SE ранее удалён; удалены только разрешённые cache-подкаталоги.
Логи, xcresult, SourcePackages, Корзина и принятые worktree сохранены.
После неуспешного gate сообщено 14 GiB свободно. Повторно измерить перед сборкой;
**не повторять очистку автоматически и не расширять её**.
Сохранить неуспешный `gate-23ae646.log` и его generated-artifacts.

Ранее принятый checkout: `~/Talk-Hint-VM-worktrees/iphone-ready`.
Сначала проверить фактическое существование, repo, branch, полный HEAD,
`git status --short`, Xcode/SDK/XcodeGen/Python, свободное место и состояние swap.
Текущий HEAD должен остаться c997a2d; если появились более поздние правки —
сообщить и остановиться, не терять их.

Места на Mac было мало. До gate оценить место по доступным размерам прежнего
DerivedData/xcresult и запасу под новый build. Если достаточность не подтверждается,
вернуть конкретный блокер вместо запуска сборки/самовольной очистки.
Не печатать конфиги с секретами, токены или их значения.

## 1а. Разрешённая точечная очистка после первого Mac-отчёта

Владелец ответил: **«Да, только указанные тестовые данные»**.
Это исключение из первоначального запрета очистки, а не разрешение на общую уборку.
По предыдущему отчёту было свободно 2,9–3,6 GiB; сборка ещё не начиналась.
Перед удалением повторно снять свободное место, размеры и состояние Git.
Изменять исходники или настройки ради освобождения места нельзя.

### Только два симулятора

- `TalkHint-ChatPreview-17`;
- `TalkHint-ChatPreview-SE`.

Сначала прочитать `xcrun simctl list devices --json`, установить конкретные UDID,
runtime и состояние. Подтвердить по прежним тестовым материалам, что это
созданные Claude preview-устройства. Не угадывать UDID и не удалять по имени,
маске или общему каталогу. Если есть одноимённые устройства либо принадлежность
не установлена — пропустить спорный объект и сообщить.
Разрешено остановить именно эти устройства, если они запущены, и удалить
только по проверенным UDID. Не использовать `delete all`, `delete unavailable`,
удаление runtimes или всего `CoreSimulator/Devices`.

Владелец предупреждён: вместе с двумя симуляторами удаляются установленные
в них приложения и локальные данные. Это не удаление приложения с настоящего
iPhone и не очистка связки ключей macOS. Остальные устройства сохраняются.

### Только DerivedData трёх прежних тестовых сборок

В подтверждённых существующих worktree:

- `iphone-ready/generated-artifacts/iphone-build`;
- `iphone-ready/generated-artifacts/main-sim-build`;
- `app-chat-dev/generated-artifacts/app-dev-build`.

Сначала установить полные реальные пути и проверить содержимое. Только
подтверждённые регенерируемые данные Xcode внутри этих путей можно удалять.
Если DerivedData является самим указанным каталогом, не удалять его целиком:
выбрать только проверенные cache/build-подкаталоги внутри.
Не считать любой файл под `generated-artifacts` ненужным автоматически.
Не следовать symlink за разрешённые границы, не применять рекурсивное удаление
к пути из непроверенной переменной или к каталогу worktree.

**Сохранить все логи, xcresult и отчёты.** Если выбранный подкаталог содержит
такие материалы или неизвестные файлы — не удалять его целиком; сузить выбор
либо пропустить и сообщить. Исходники, Git, документы/патчи и содержимое Корзины
не трогать. Общий `~/Library/Developer/Xcode/DerivedData` не входит в разрешение.
Не завершать принудительно Xcode, браузер или системные процессы.

### После очистки

Показать список фактически удалённого, пропущенного и почему, место до/после,
swap и чистоту исходного checkout. Предыдущая оценка освобождения ≈4,8 GB —
**не гарантия**: фактическое место измерить заново.
Повторить оценку запаса для gate и AppDev (ориентир прежнего отчёта 7–8 GiB).
Если запаса достаточно — продолжить шаги 2–4 этого задания **без нового запроса
разрешения на уже согласованные тесты/сборку**.
Если недостаточно — остановиться с цифрами, не расширять очистку и не начинать
gate на заведомо недостаточном месте.
Run, установка, Publish, реальные звонки и платные пробы по-прежнему запрещены.

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

Для исправленной сборки — **новый отдельный worktree**:
`~/Talk-Hint-VM-worktrees/chat-voice-sarah-render-check`.
Прежние `chat-voice-sarah-2026-11-11` и `chat-voice-sarah-reduce-motion`
с неуспешными gate оставить неизменными.
Если путь существует, не перезаписывать: проверить HEAD/чистоту, при несовпадении стоп.

```bash
git worktree add --detach "$HOME/Talk-Hint-VM-worktrees/chat-voice-sarah-render-check" "$TARGET"
cd "$HOME/Talk-Hint-VM-worktrees/chat-voice-sarah-render-check"
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
68 source-contract и 53 script-теста PASS. Проверен оригинальный родитель,
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
