# Claude Mac: после 66/67 — исправлен поиск вложенных views, повторить 8 тестов

**Это единственное текущее задание.** Предыдущий общий проход не повторять.
Последний независимый отчёт владельца: на `00e77dc1` прошли 66/67;
оба прежних красных теста теперь зелёные. Новый
`testReadingAnchorSurvivesGrowthDuringReopen` остановился на поиске m1
из-за ошибки обхода view-дерева, ДО проверки положения строки.
Device-сборка/установка/запуск НЕ выполнялись.
На iPhone остался прежний `6a4fe3a`. Сохранить данные, логи и 47 UIKit-снимков
первого прохода. Старые результаты не называть тестами нового снимка.

## Снимок и границы

- Repo: https://github.com/Sergalmazfas/Talk-Hint-VM
- Постоянная ветка: `xcode-chat-voice-sarah-2026-11-11`.
- Та же рабочая копия: `~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency`.
- База: `00e77dc1e907b1851ea81cbbfc91a2a0d12e2ed2`.
- **Код тестов: `389960e9bd07a9614da856fa4a85d5f4b07140c8`.**
- Последующие коммиты этой передачи — только docs.
- [Точные 8 методов ChatNavigationTests и SHA-256 исходника](ios-chat-reading-recheck-scope.json).

Никаких новых worktree/очисток/зависимостей/смен Xcode, Team или подписи.
Не stash/reset/clean/rebase/force. При нечистой копии или непереданных
Mac-коммитах остановиться и сообщить пути/коммиты, не терять их.
Не переносить серверную ветку или весь её `ios/`.

Нет новых серверных изменений и зависимости от нового Publish.
В первом проходе Mac подтвердил production `/api/build` =
`7ec7572966a802ee1dba4297856b69fb36139c2f`. Ничего не публиковать и не менять
в production/БД, OAuth, телефонии, голосах, моделях, бюджетах и 682.
Без реальных сообщений, писем, STT/TTS/LLM/OCR, Агата-сеансов или звонков.

## Единственная правка

`descendants<T>` в ChatNavigationTests раньше прекращал обход, если сам
контейнер соответствовал T. Для UIStackView поиск возвращал messagesStack,
но не его строки. Теперь найденный view добавляется к результату И обходятся
дочерние — как в уже существующем helper `all` в ChatApprovedScreenTests.
Добавлена source-проверка, защищающая этот обход.

**Приложение, прокрутка, шрифт, аудио и другие XCTest не менялись.**
Прежние assertions, fixture GET, таймауты, ID и допуск ±2 pt сохранены.
Новая регрессия обязана дойти до проверок ПОСЛЕ reopen и проверить положение
на всех четырёх layout-проходах, не только найти m1.

Replit реально выполнил **91 source + 66 helper = 157 проверок**, все прошли.
Swift/XCTest/device не запускались: Replit работает на Linux.

## Получить дельту

В Bash, в прежней копии:

```bash
cd ~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency
git status --short
git branch --show-current
git rev-parse HEAD
# Продолжать только при чистой правильной ветке и ожидаемой истории.
git fetch --no-tags origin refs/heads/xcode-chat-voice-sarah-2026-11-11
git merge --ff-only FETCH_HEAD
git merge-base --is-ancestor 00e77dc1e907b1851ea81cbbfc91a2a0d12e2ed2 HEAD
git merge-base --is-ancestor 389960e9bd07a9614da856fa4a85d5f4b07140c8 HEAD
git diff --exit-code 389960e9bd07a9614da856fa4a85d5f4b07140c8 HEAD -- ios
git diff --exit-code 00e77dc1e907b1851ea81cbbfc91a2a0d12e2ed2 HEAD -- ios/TalkHint
```

## Один повтор 8 XCTest навигации

Сохранить действующие Xcode и тёплые DerivedData из первого прохода.
Первый отчёт говорит, что временный simulator удалён, потому что постоянных
не было. Не удалять другие устройства. Если доступного simulator по-прежнему
нет, допустимо одно временное устройство из уже установленного runtime;
никаких скачиваний SDK или сбросов кэшей. Указать это в отчёте.

Выбрать фактические `ROOT`, `DD`, `SIM_ID`; `OUT` — новый каталог логов под
`generated-artifacts/`, не перезаписывающий первый `.xcresult`.
Не публиковать UDID/личные имена устройств/credentials.
Сгенерировать прежний проект, собрать тесты инкрементально:

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
SIM_APP="$DD/Build/Products/NativeValidation-iphonesimulator/TalkHint.app"
codesign --verify "$SIM_APP"
xcrun segedit "$SIM_APP/TalkHint" -extract __TEXT __entitlements "$OUT/simulator-entitlements.plist"
python3 "$ROOT/ios/scripts/verify-native-entitlements.py" "$OUT/simulator-entitlements.plist"
TEST_FLAGS=()
while IFS= read -r flag; do TEST_FLAGS+=("$flag"); done < <(
  python3 - "$ROOT" <<'PY'
import hashlib, json, pathlib, re, sys
root = pathlib.Path(sys.argv[1])
m = json.loads((root / "docs/ios-chat-reading-recheck-scope.json").read_text())
assert len(m["suites"]) == m["suiteCount"] == 1
assert sum(len(s["methods"]) for s in m["suites"]) == m["methodCount"] == 8
for s in m["suites"]:
    raw = (root / s["source"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == s["sourceSha256"], s["source"]
    assert re.findall(r"\bfunc\s+(test\w+)\s*\(", raw.decode()) == s["methods"], s["suite"]
for s in m["suites"]:
    print("-only-testing:TalkHintTests/" + s["suite"])
PY
)
test "${#TEST_FLAGS[@]}" -eq 1 || exit 1
xcodebuild "${COMMON[@]}" test-without-building -parallel-testing-enabled NO \
  -testLanguage en -testRegion US "${TEST_FLAGS[@]}" \
  -resultBundlePath "$OUT/ChatReadingRecheck.xcresult" 2>&1 | tee "$OUT/tests.log"
```

В `.xcresult` сверить все 8 методов manifest поимённо: новая регрессия reopen,
прежняя проверка draft/scroll после возврата и остальные тесты навигации,
поскольку helper общий для этого класса. Никаких skip/ослабления допусков.
Не запускать полный `verify-xcresult.py` на частичном прогоне и не менять
registry ради зелёного результата.

Граница повтора — только **ChatNavigationTests: 8 методов**.
Остальные 59 успешных тестов последнего прогона не затронуты этой test-only
правкой и повторения не требуют. Их прошлый результат хранить отдельно,
не выдавать за новый прогон. Внутри класса навигации повторяются все 8,
а не только один упавший тест, поскольку изменён их общий helper.
Код звука Кати, Агаты, Keychain и телефонной сессии не изменён; их результаты
первого прохода сохранить отдельно, повторять 80-секундный engine-тест не нужно.
Он доказал callbacks обоих синтетических каналов, не слышимость на iPhone.

Любой failed/missing/skipped или ошибка компиляции — остановка до установки,
вернуть ошибку/stack и fixture-снимок. Не объявлять исправление готовым.
Если для новой регрессии есть UIKit-снимки, приложить их; если нет — явно
указать это, не менять тест ради снимков. При падении вернуть доступные
offset/ID и stack из журнала. Прежние снимки сохранить без пересоздания.

## Одна обычная device-сборка, обновление поверх и запуск

Только после **8/8**: одна инкрементальная `TalkHint / Debug`, не AppDev.
Использовать прежние `DEVICE_DD` и подключённое устройство `DEVICE_ID`.
Никаких `-allowProvisioningUpdates`, Archive/TestFlight/Publish.

```bash
xcodebuild -project "$ROOT/ios/TalkHint.xcodeproj" -scheme TalkHint \
  -configuration Debug -sdk iphoneos \
  -destination "platform=iOS,id=$DEVICE_ID" -derivedDataPath "$DEVICE_DD" \
  build 2>&1 | tee "$OUT/device-build.log"
```

По effective settings проверить `.app`: `app.talkhint`, production
`https://talkhint.app`, прежние callback/Team/подпись, без Dev/NativeValidation.
`TALKHINT_APP_PATH` получить из реального build output, не угадывать.
Если активного звонка нет, разрешена прежняя единая установка/запуск:

```bash
xcrun devicectl device install app --device "$DEVICE_ID" "$TALKHINT_APP_PATH"
xcrun devicectl device process launch --device "$DEVICE_ID" app.talkhint
```

Приложение не удалять, историю/Keychain/данные не сбрасывать. Открыть обычный
чат, но не посылать сообщения и не нажимать микрофон, Orb, Play или Start.

## Вернуть отчёт

Ветка/полный SHA, поимённая сверка 8, passed/failed/skipped, длительности
тестов и device-сборки, UIKit-снимки, установка/запуск и версия binary,
новые предупреждения. Если исходное смещение 1116 pt повторилось —
конкретная геометрия/момент, не утверждение «это fixture» без доказательств.
Не считать прошлые 66 или 227 тестами этого коммита. Реальную речь/Bluetooth/слышимость
и фото HEIC на устройстве не объявлять проверенными.

Последние проверки владельцу:
1. В середине переписки обновление/возврат не сдвигают читаемую строку;
   «↓ Новое» возвращает вниз, жест прокрутки не отменяется автоматикой.
2. Диктовка — видимый редактируемый черновик без автоотправки; шрифт обычный
   системный, подробности поручения раскрываются отдельно.
3. В отдельно разрешённых владельцем разговорах — слышимость Кати и Агаты.
   Без автоматического нового звонка или платной сессии ради проверки.
