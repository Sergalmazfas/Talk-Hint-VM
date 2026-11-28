> После отчёта 227/229 выполнять только [узкий повтор чтения и шрифта](claude-mac-chat-reading-recheck-handoff.md).
> Общий проход ниже — архив снимка ecce1d3a. Не повторять 229 тестов или отдельные сборки.

# Claude на Mac: чат, Агата и звук Кати — исторический общий проход

**Архив первого общего задания; заменён узким повтором по ссылке выше.** Владелец 27.11.2026 попросил
передать всю уже подготовленную работу с чатом, Агатой и прослушиванием Кати,
проверить её вместе и запустить обычный TalkHint. Прежние отдельные handoff —
источники истории, не очередь дополнительных проверок, сборок или запусков.
Это не запрос разрабатывать новые функции и не разрешение платных операций.

## 1. Репозиторий и точный снимок

- Репозиторий: [Sergalmazfas/Talk-Hint-VM](https://github.com/Sergalmazfas/Talk-Hint-VM).
- Постоянная [iOS-ветка](https://github.com/Sergalmazfas/Talk-Hint-VM/tree/xcode-chat-voice-sarah-2026-11-11):
  `xcode-chat-voice-sarah-2026-11-11`.
- Существующая Mac-копия: `~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency`.
- База предыдущей передачи: `99ed59b3c25c38f4a7e0ec9f33e407b327da7a8d`.
- **Целевой коммит кода: `7e2b9e3d6f0afa30f7986277d59cb96ff337c52b`.**
- После него разрешена только документация этой передачи. Код iOS должен совпасть.
- Полный поимённый состав: [ios-chat-agata-secretary-validation-scope.json](ios-chat-agata-secretary-validation-scope.json):
  **30 suites, 229 XCTest-методов**, SHA-256 каждого тестового исходника.

В коде относительно предыдущей передачи исправлен только устаревший registry:
несуществующий `testPrepareOpeningShowsOnSmallScreenAndTogglesCollapse` заменён
реально существующими, более подробными тестами
`testPrepareOpeningUsesOnlyBottomBannerAndTranslationStaysCollapsed` и
`testIncomingScreenDoesNotConsumePreparedOutgoingGoalOrOpening`.
Проверки поведения не удалены и не ослаблены; продукт в этой передаче не менялся.

Вся согласованная дельта уже находится в ветке:

| Область | Что включено | Контроль происхождения |
|---|---|---|
| Чат | Полноширинный composer; устойчивое чтение/«↓ Новое»; короткая карточка и подробности; заменённая карточка без запуска | `dfc559c4f30ef1b32209df03b9e751b780761d93` |
| Диктовка | Локальные partial в редактируемом черновике; резерв batch только после Stop; нет автоотправки; отмена поздних результатов | тот же пакет чата |
| Ответы и данные | Markdown/точное копирование, ручной read-aloud, таблицы/экспорт, память и документы; без новых разрешений | сохранённая native-база, включая `a0a772b6` |
| Агата | Retell в существующем Orb и том же чате; trickle ICE; speaker/Bluetooth и освобождение WebRTC-template; общий владелец звука | `718f30c1` и `572f1c72c981f17940313dd12a7895669ac7322d` |
| Катя | Только местное прослушивание: диагностика, сохранение ошибок, ограниченное восстановление, два playback-узла и настоящий engine fixture | `09024abac21a429355ec50f619324250488b0051` |
| Регрессии | Авторизация/Keychain, навигация, Hint/PREP и captions, приоритет телефонной аудиосессии | поимённый manifest |

Не копировать весь `ios/` из серверной ветки: там иные/старые варианты,
включая отдельный интерфейс карточек Orb, не входящий в этот пакет.
Не терять Mac-исправления WebRTC, trickle ICE, подписи и аккаунтного scope.
Агату не возвращать на прежнюю STT/ElevenLabs-связку. Чатовый read-aloud —
отдельный прежний путь; голос/модель и оба транспорта не менять.
Голосовое «да» не является разрешением звонка: остаются обычные review/Start.

## 2. Сервер уже опубликован; нового Publish не нужно

Replit сделал read-only проверку `https://talkhint.app/api/build`:

- commit `7ec7572966a802ee1dba4297856b69fb36139c2f`;
- builtAt `2026-11-27T15:45:20.852Z`, dirty=false, DB connected;
- `94515e7e` (Agata revision / response-only retry) и `45d8b0f1` (Hint)
  проверены как предки этого production-коммита.

Это закрывает старое требование «сначала Publish» для данного пакета.
Перед итоговой device-сборкой ещё раз прочитать публичный `/api/build`.
Тот же SHA допустим. Если изменился — подтвердить ancestry к указанным
серверным предкам или вернуть блокер, не гадать. Авторизованные capabilities
не проверялись от имени владельца; это не обещание доступности всех функций
для любого аккаунта. При недоступности клиент должен показать честную причину.

Не публиковать сервер из native-ветки, не изменять production/БД/агентов/682,
бюджеты, голоса, модели, номера, webhook, OAuth/Secrets или права.
Никаких реальных STT/LLM/TTS/OCR-проб, звонков и писем.

## 3. Получить одну ветку без потери локальной работы

```bash
cd ~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency
git status --short
git branch --show-current
git rev-parse HEAD
```

Проверить origin на указанный репозиторий, не показывая credentials.
Грязная копия, свои непереданные Mac-коммиты или другая ветка — остановиться
и вернуть пути/коммиты. Не stash/reset/clean/rebase/force, не создавать worktree.
В чистой существующей ветке:

```bash
git fetch --no-tags origin refs/heads/xcode-chat-voice-sarah-2026-11-11
git merge --ff-only FETCH_HEAD
git merge-base --is-ancestor 99ed59b3c25c38f4a7e0ec9f33e407b327da7a8d HEAD
git merge-base --is-ancestor 7e2b9e3d6f0afa30f7986277d59cb96ff337c52b HEAD
git diff --exit-code 7e2b9e3d6f0afa30f7986277d59cb96ff337c52b HEAD -- ios
git rev-parse HEAD
```

Любой non-fast-forward — блокер. Существующие бинарники, логи, xcresult,
DerivedData/SPM-кэши сохранить. Не менять Xcode/SDK/пакеты/Team/сертификаты.
Источник WebRTC закреплён существующим project.yml; зависимости не обновлять.

## 4. Один набор связанных тестов

Replit на этом native-снимке реально выполнил **88 + 66 = 154 Python-проверки**:
источники, локализации и вспомогательные native-guard проверки; все прошли.
Это **не** Swift-компиляция, XCTest или подтверждение звука/микрофона iPhone.
229 XCTest пока НЕ запускались. Старые 92/92, 126/127 и другие результаты
не подставлять вместо текущего снимка.

Команды ниже выполнять в Bash. Взять действующие локальные Xcode,
существующий simulator и тёплый DerivedData.
`ROOT`, `OUT`, `DD`, `SIM_ID`, далее `DEVICE_DD`/`DEVICE_ID` определить по
существующей Mac-среде. `OUT` — новый каталог логов в `generated-artifacts/`.
Не печатать UDID, имена устройств, токены или содержимое Keychain.

При необходимости штатно регенерировать существующий Xcode-проект:

```bash
(cd "$ROOT/ios" && xcodegen generate --spec project.yml)
```

Тесты — изолированный `TalkHintValidation / NativeValidation`, `.invalid` backend,
simulator-only ad-hoc подпись с существующими runtime entitlements.
Это не отдельная устанавливаемая AppDev и не изменение device signing:

```bash
COMMON=(-project "$ROOT/ios/TalkHint.xcodeproj" -scheme TalkHintValidation
  -configuration NativeValidation -sdk iphonesimulator
  -destination "platform=iOS Simulator,id=$SIM_ID"
  -derivedDataPath "$DD"
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual
  DEVELOPMENT_TEAM= PROVISIONING_PROFILE= PROVISIONING_PROFILE_SPECIFIER=
  "CODE_SIGN_ENTITLEMENTS=$ROOT/ios/scripts/native-validation.entitlements")
set -euo pipefail
xcodebuild "${COMMON[@]}" build-for-testing 2>&1 | tee "$OUT/build-for-testing.log"
SIM_APP="$DD/Build/Products/NativeValidation-iphonesimulator/TalkHint.app"
codesign --verify "$SIM_APP"
xcrun segedit "$SIM_APP/TalkHint" -extract __TEXT __entitlements "$OUT/simulator-entitlements.plist"
python3 "$ROOT/ios/scripts/verify-native-entitlements.py" "$OUT/simulator-entitlements.plist"
```

Сверить хэши и собрать flags из manifest — без `mapfile`, которого нет в
стандартном старом Bash macOS:

```bash
TEST_FLAGS=()
while IFS= read -r flag; do TEST_FLAGS+=("$flag"); done < <(
  python3 - "$ROOT" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
m = json.loads((root / "docs/ios-chat-agata-secretary-validation-scope.json").read_text())
assert len(m["suites"]) == m["suiteCount"] == 30
assert sum(len(s["methods"]) for s in m["suites"]) == m["methodCount"] == 229
for s in m["suites"]:
    assert hashlib.sha256((root / s["source"]).read_bytes()).hexdigest() == s["sourceSha256"], s["source"]
for s in m["suites"]:
    print("-only-testing:TalkHintTests/" + s["suite"])
PY
)
# При ошибке генератора flags — СТОП. Не запускать команду с пустым списком.
test "${#TEST_FLAGS[@]}" -eq 30 || exit 1
xcodebuild "${COMMON[@]}" test-without-building -parallel-testing-enabled NO \
  -testLanguage en -testRegion US "${TEST_FLAGS[@]}" \
  -resultBundlePath "$OUT/CombinedChatAgataSecretary.xcresult" 2>&1 | tee "$OUT/tests.log"
```

Сверить `.xcresult` по всем **229 методам** manifest, не только общему exit code.
Не запускать старые разрозненные команды, полный gate или повторные сборки
для каждой области. Полный `verify-xcresult.py` требует других suites:
не выдавать его за PASS на частичном прогоне и не ослаблять его ради этого.

Любая компиляционная ошибка, failed/отсутствующий/новый skipped тест —
остановка до device-сборки. Единственное уже существующее аппаратное исключение:
`ChatAttachmentImageTests/testHEICPhotoIsConvertedToJPEGWithOrientation` может
вернуть свой прежний XCTSkip при отсутствии HEIC encoder. Явно записать как
«не проверено, нужен iPhone», НЕ как PASS. Новых skip/моков вместо реальных
проверок не добавлять. Для аудио, навигации, авторизации и Keychain skip недопустим.

### Обязательные связки, не только отдельные экраны

- Диктовка → черновик → ручная правка → Stop/Cancel → отправка только владельцем;
  нет повторов partial, поздней подмены или автоотправки.
- Чтение середины чата → streaming/возврат → тот же якорь; короткая карточка,
  раскрытие, замена и старый task без запуска.
- Агата ↔ диктовка/read-aloud ↔ телефон: один владелец звука; lease освобождается,
  телефон приоритетнее; Retell/ICE ошибки не делают скрытый платный restart.
- Отсутствующие/недоступные speech/capabilities дают честную ошибку, не fallback
  на другой голосовой продукт или разрешение действия.
- Катя: оба синтетических канала через настоящий AVAudioEngine дают playback
  callback; reset текстовой ленты не стирает аудиоошибку; только видимый экран
  восстанавливает звук, максимум три попытки, без новых звонков.
- Память/документы/таблицы, точное копирование, авторизация/Keychain и Hint:
  сохранить существующие права, данные, leading zeros/code, подтверждения,
  текущую цель/карточку и приоритет аудио. Не дописывать продукт вместо проверки.

Для UIKit сохранить fixture-снимки composer/диктовки, компактной и раскрытой
карточки, середины переписки и строки диагностики звука. Если снимок настоящего
UIKit не получен — указать, не заменять HTML-картинкой.

## 5. Одна конечная сборка обычного TalkHint и запуск

После успешных обязательных проверок и подтверждения сервера:

```bash
xcodebuild -project "$ROOT/ios/TalkHint.xcodeproj" -scheme TalkHint \
  -configuration Debug -sdk iphoneos \
  -destination "platform=iOS,id=$DEVICE_ID" \
  -derivedDataPath "$DEVICE_DD" build 2>&1 | tee "$OUT/device-build.log"
```

Проверить в собранном .app: bundle `app.talkhint`, production `https://talkhint.app`,
прежние Team/подпись/callback, нет Dev/NativeValidation override.
Путь `TALKHINT_APP_PATH` получить из effective build settings, не угадать.
Не `-allowProvisioningUpdates`, Archive/TestFlight, AppDev или смена сертификатов.

Если нет активного звонка — обновить **поверх** установленного TalkHint, без
удаления приложения, истории, Keychain или данных. Владелец разрешил этот
единый проход проверки/обновления/запуска:

```bash
xcrun devicectl device install app --device "$DEVICE_ID" "$TALKHINT_APP_PATH"
xcrun devicectl device process launch --device "$DEVICE_ID" app.talkhint
```

Открыть обычное приложение/чат. **Не нажимать микрофон/Orb/Play, не создавать
сеанс Агаты, не отправлять сообщение/письмо и не подтверждать звонок за владельца.**
«Запустить всё» здесь — установить единый готовый клиент, а не включить агентов
или начать платные разговоры. Недоступное устройство/подпись/нечистый checkout
или красная проверка — точный блокер, не удаление данных и не обход.

## 6. Что вернуть коротким отчётом

- Ветка, полный HEAD, код `7e2b9e3d`, фактический `/api/build`.
- По 30 suites: фактические passed/failed/skipped, поимённые отсутствующие/ошибки;
  длительность тестов и одной device-сборки, новые предупреждения.
- Для настоящего AVAudioEngine: callback обоих буферов/либо stage и системный код.
  Слышимость iPhone по callback не объявлять доказанной.
- Установка/запуск выполнены или нет; версия сборки и код соответствующего binary;
  путь логов/xcresult/UIKit-снимков. Секреты и идентификаторы устройства скрыть.
- Что не проверено: реальная речь/эхо/Bluetooth/слышимость/HEIC и причины.
  Итог «готово к ручной проверке» либо точный блокер.
  Продукт самостоятельно не дописывать; ошибку вернуть Replit для узкой правки.

## 7. Последние три проверки владельцу на iPhone

1. **Сначала звук Кати:** в отдельно разрешённом владельцем разговоре слышны оба
   участника; можно менять динамик/наушники. При ошибке снять строку stage/code,
   не повторять платные звонки ради диагностики. Монитор не передаёт микрофон владельца.
2. **Чат:** слова диктовки видны в редактируемом черновике; Stop/Cancel ничего
   не отправляют. При чтении середины не отбрасывает; карточка короткая,
   подробности раскрываются, старая не запускается.
3. **Агата:** только при отдельном ручном запуске владельцем слышен ответ,
   сохраняется тот же чат, выход освобождает звук. Не включать одновременно
   диктовку/read-aloud и не выдавать голосовое «да» за разрешение звонка.
