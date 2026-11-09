# Claude на Mac: TalkHint Chat actions — сборка и независимая проверка

Репозиторий: https://github.com/Sergalmazfas/Talk-Hint-VM
Ветка передачи: `xcode-chat-actions-2026-11-09`.
База: `cac6bbf` (содержит FleetPride `9397cac`). Точный HEAD — `git rev-parse HEAD` в ветке передачи;
верните его в отчёте, не заменяйте текущий checkout владельца без проверки.

## Безопасный старт

Проверить `git status --short`, текущую ветку и HEAD. При чужих изменениях
остановиться и сообщить; без stash, reset, force, rebase и merge в main.
Можно использовать отдельный worktree без удаления предыдущих сборок/данных.
Проверить Xcode 26.5 в `/Applications/Xcode.app`; не переименовывать Xcode
и не создавать подменяющие symlink.

## Изменения для Xcode

- `ios/TalkHint/Chat/ChatPhoneContext.swift`: foreground location/time,
  разрешение один раз, deadline, необязательное название города.
- `ChatOutbox.swift`, `ChatAPI.swift`: стабильный phone snapshot при retry,
  декодирование событий/привязки задачи, получение источника и follow-up.
- `ChatViewController.swift`: snapshot при релевантном поручении,
  периодическое чтение результатов, ссылки на сохранённый источник,
  явное сохранение follow-up без обещания календаря.
- `Info.plist` и EN/RU/ES/KK/UK `InfoPlist.strings`: purpose геолокации.
- EN/RU/ES/KK/UK `Localizable.strings`: новые result/follow-up строки.
- `ios/TalkHintTests/ChatPhoneContextTests.swift`: три новых теста.
- Предыдущие Dev-изменения карточки плана и скрытия клавиатуры уже в базе.

XcodeGen должен включить новый Swift через существующий sources glob.
Не менять bundle IDs, signing/team/certificates, URL schemes и окружение.
Проверить, что новая сборка именно AppDev, а не production/Preview; не
запускать установленное приложение/микрофон без действия владельца.

## Gate

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer bash ios/scripts/validate-native.sh
```

Полный штатный target, без фильтрации тестов. Сверить актуальный Xcode/SDK
перед командой. Обязательные группы (не вместо полного набора):
ChatAPITests, ChatApprovedScreenTests, ChatAppShellTests, ChatCallPlanModelTests,
ChatDictationTests, ChatNavigationTests, ChatOutboxTests, ChatPhoneContextTests,
SecretaryPersonalityTests, SecretaryPersonalityUITests и существующие обязательные
URL/isolation/cards/Secretary/audio/recovery/secure-storage gate.

Новые тесты:
- testActionContextDoesNotRequireAProfession
- testOutboxPersistsExactPhoneSnapshotForIdempotentRetry
- testLegacyOutboxWithoutContextStillDecodes

Проверить отдельно: отмена/отказ/выдача разрешения геолокации, таймаут,
отсутствие фонового location tracking, старый outbox без context,
новый outbox с точным snapshot, клавиатура и кнопка Done,
возврат из проверки поручения в ту же переписку,
результат после повторного открытия приложения и отсутствие дублей.
Визуально проверить сообщения/источник/локальное follow-up на большом и
компактном iPhone, светлая/тёмная тема, EN/RU/ES и сохранённые KK/UK.

Детальный source-view сейчас показывает сохранённый JSON, а не новый дизайн
рапорта; основной чат показывает три строки без JSON. Отметить это как
ограничение, не переделывать по своему усмотрению.

## Запреты

Без Publish/push в main/Archive/TestFlight, реальных звонков/репетиций/SMS,
оплачиваемых AI/Maps/STT-запросов, изменения ключей, Retell/голоса/модели Кати,
Apple Team и сертификатов. Секреты не включать в логи, ZIP или screenshots.
Нативный интерфейс не редизайнить. Найденные ошибки сначала зафиксировать;
неправильные actor/permission/lifecycle связи нельзя маскировать аннотациями.

## Вернуть

Ветка/HEAD; Xcode/XcodeGen/SDK/Simulator; build result; полный passed/failed/skipped;
обязательные группы отдельно; предупреждения и diff новых предупреждений;
логи gate + verify-xcresult; крупные скриншоты; что не проверено;
вердикт «готово к релизу / блокер». Backend Publish не заменяет сборку iPhone.
