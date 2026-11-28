# Claude Mac: повтор после 227/229 — позиция чтения и системный шрифт

**Это единственное текущее задание.** Предыдущий общий проход не повторять.
Независимый отчёт владельца: на `ecce1d3a` прошли 227/229, два теста
ChatApprovedScreenTests упали, device-сборка/установка/запуск НЕ выполнялись.
На iPhone остался прежний `6a4fe3a`. Сохранить данные, логи и 47 UIKit-снимков
первого прохода. Старые результаты не называть тестами нового снимка.

## Снимок и границы

- Repo: https://github.com/Sergalmazfas/Talk-Hint-VM
- Постоянная ветка: `xcode-chat-voice-sarah-2026-11-11`.
- Та же рабочая копия: `~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency`.
- База: `ecce1d3a03ae189cb98ce535de7048bbedd2bc72`.
- **Код: `213c32022bbd45ab8c10530d319721046667e835`.**
- Последующие коммиты этой передачи — только docs.
- [Точные 67 методов, 8 suites, SHA-256 исходников](ios-chat-reading-recheck-scope.json).

Никаких новых worktree/очисток/зависимостей/смен Xcode, Team или подписи.
Не stash/reset/clean/rebase/force. При нечистой копии или непереданных
Mac-коммитах остановиться и сообщить пути/коммиты, не терять их.
Не переносить серверную ветку или весь её `ios/`.

Нет новых серверных изменений и зависимости от нового Publish.
В первом проходе Mac подтвердил production `/api/build` =
`7ec7572966a802ee1dba4297856b69fb36139c2f`. Ничего не публиковать и не менять
в production/БД, OAuth, телефонии, голосах, моделях, бюджетах и 682.
Без реальных сообщений, писем, STT/TTS/LLM/OCR, Агата-сеансов или звонков.

## Изменения — не объявлять их успешно проверенными до XCTest

1. **Код:** refresh после возвращения в чат прежде сохранял только число
   `contentOffset`, поэтому render пропускал захват читаемой строки.
   Теперь refresh и render используют общий capture **до** замены старых rows.
   Существующий pending offset тоже получает message-relative anchor, если его
   ещё не было. Перетаскивание и «↓ Новое» по-прежнему отменяют восстановление.
2. **Тест роста сообщения:** вместо 12 `Task.yield` ждёт фактического завершения
   асинхронного восстановления с трёхсекундным пределом. UIKit/main-queue не
   обязаны закончить работу за 12 yield. Исходная причина именно первого падения
   ещё требует проверки на Mac; это не доказательство, что виноват только fixture.
   Допуск **2 pt не увеличен**; рост проверяется дважды — 30 и 60 повторов.
   Исходное ручное перемещение теперь посылает обычное событие начала drag,
   отменяя отложенное следование за концом начальной переписки.
3. **Новая регрессия:** `ChatNavigationTests/testReadingAnchorSurvivesGrowthDuringReopen`
   проходит настоящий close/reopen и refresh с подставным GET: первое сообщение
   увеличивается вне открытого чата. После reflow проверяется та же строка ±2 pt
   на четырёх дальнейших layout-проходах. Никакой сети или API модели.
   Тест добавлен в обязательный registry, старые проверки не удалены.
4. **Шрифт:** продукт остаётся системным `.preferredFont(forTextStyle: .body)`
   с Dynamic Type, а не фиксированным 20 pt. Устаревшее ожидание 20 исправлено.
   Это соответствует просьбе владельца убрать огромный шрифт, а не повод
   увеличивать его обратно. Другие размеры и дизайн не менялись.

Replit реально выполнил **90 source + 66 helper = 156 проверок**, все прошли.
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
git merge-base --is-ancestor ecce1d3a03ae189cb98ce535de7048bbedd2bc72 HEAD
git merge-base --is-ancestor 213c32022bbd45ab8c10530d319721046667e835 HEAD
git diff --exit-code 213c32022bbd45ab8c10530d319721046667e835 HEAD -- ios
```

## Один повтор 67 связанных XCTest

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
assert len(m["suites"]) == m["suiteCount"] == 8
assert sum(len(s["methods"]) for s in m["suites"]) == m["methodCount"] == 67
for s in m["suites"]:
    raw = (root / s["source"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == s["sourceSha256"], s["source"]
    assert re.findall(r"\bfunc\s+(test\w+)\s*\(", raw.decode()) == s["methods"], s["suite"]
for s in m["suites"]:
    print("-only-testing:TalkHintTests/" + s["suite"])
PY
)
test "${#TEST_FLAGS[@]}" -eq 8 || exit 1
xcodebuild "${COMMON[@]}" test-without-building -parallel-testing-enabled NO \
  -testLanguage en -testRegion US "${TEST_FLAGS[@]}" \
  -resultBundlePath "$OUT/ChatReadingRecheck.xcresult" 2>&1 | tee "$OUT/tests.log"
```

В `.xcresult` сверить все 67 методов manifest поимённо. Обязательны оба
прежних красных, новая регрессия reopen, прежняя проверка draft/scroll после
возврата, остальные tests выбранных suites. Никаких skip/ослабления допусков.
Не запускать полный `verify-xcresult.py` на частичном прогоне и не менять
registry ради зелёного результата.

Границы повтора: chat approved 12, navigation 8, message presentation 5,
read-aloud 10, tables 8, memory screen 5, documents 3, dictation 16 = **67**.
Код звука Кати, Агаты, Keychain и телефонной сессии не изменён; их результаты
первого прохода сохранить отдельно, повторять 80-секундный engine-тест не нужно.
Он доказал callbacks обоих синтетических каналов, не слышимость на iPhone.

Любой failed/missing/skipped или ошибка компиляции — остановка до установки,
вернуть ошибку/stack и fixture-снимок. Не объявлять исправление готовым.
Для якоря сохранить UIKit-снимки до/после обоих увеличений и после reopen,
с offset/ID читаемой строки. Сохранить snapshot шрифта/composer на 320 pt.

## Одна обычная device-сборка, обновление поверх и запуск

Только после **67/67**: одна инкрементальная `TalkHint / Debug`, не AppDev.
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

Ветка/полный SHA, поимённая сверка 67, passed/failed/skipped, длительности
тестов и device-сборки, UIKit-снимки, установка/запуск и версия binary,
новые предупреждения. Если исходное смещение 1116 pt повторилось —
конкретная геометрия/момент, не утверждение «это fixture» без доказательств.
Не считать прошлые 227 тестами этого коммита. Реальную речь/Bluetooth/слышимость
и фото HEIC на устройстве не объявлять проверенными.

Последние проверки владельцу:
1. В середине переписки обновление/возврат не сдвигают читаемую строку;
   «↓ Новое» возвращает вниз, жест прокрутки не отменяется автоматикой.
2. Диктовка — видимый редактируемый черновик без автоотправки; шрифт обычный
   системный, подробности поручения раскрываются отдельно.
3. В отдельно разрешённых владельцем разговорах — слышимость Кати и Агаты.
   Без автоматического нового звонка или платной сессии ради проверки.
