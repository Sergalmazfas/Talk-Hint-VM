# Claude на Mac: Документовед — одна iOS-дельта

Выполнить только это задание. Не продолжать старые задания полного gate,
голоса или AppDev. Сервер из этой native-ветки **не публиковать**.

## Сначала сервер

Сборка/установка новой функции — **после Publish сервера владельцем**.
Не считать этот файл подтверждением Publish: Replit его не выполнял.
Нужен опубликованный потомок серверного кода
`ad674d851da4d055f1fa04b334b6f73afe96fdfa`; Replit проверяет `/api/build`
и пять новых таблиц. До подтверждения разрешены только offline XCTest.
Одна старая `memory`-схема недостаточна.

## Получение

- Репозиторий: https://github.com/Sergalmazfas/Talk-Hint-VM
- Постоянная ветка: `xcode-chat-voice-sarah-2026-11-11`.
- База: `8a4c97ce2d34c017aedbad99b1dbc619766f705a`.
- iOS-код: `32bcb08759b1bf13ce0369eddc510949ef742a6f`.
- Верхушка также содержит это задание. Push выполняет Replit.
- Существующая рабочая копия:
  `~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency`.

Проверить HEAD и `git status --short`. Fetch только постоянной ветки:

```sh
git fetch --no-tags origin refs/heads/xcode-chat-voice-sarah-2026-11-11
git merge --ff-only FETCH_HEAD
git diff --name-only 8a4c97ce2d34c017aedbad99b1dbc619766f705a HEAD
```

Только при чистой копии и fast-forward. Иначе остановиться и сообщить.
Без stash/reset/clean/rebase/force; без новой ветки/worktree на Mac,
без merge серверной ветки, удаления DerivedData/симуляторов или данных.
Mac-исправления звука/Agata из базы должны остаться без изменений.

## Дельта и границы

- `ChatDocuments.swift`: список, до 10 вложений, запуск отдельным явным
  действием, выбор типа, загрузка оригинала, pin/unpin/close/forget/restore,
  история и карточка отката/повторного подтверждения без нового AI.
- `ChatViewController.swift`: меню «Документы» / «Распознать вложенные
  документы», сохранение черновика и загрузка отдельных карточек.
- `ChatMemoryCardView.swift`: подсветка «проверь»; по-прежнему ОДНА Save/Cancel
  на весь документ, а не на поле или часть.
- 5 локализаций; новые offline `ChatDocumentsTests`.
- Документы `document-specialist-dev-report.md` и SQL — материалы проверки,
  не команда мигрировать сервер с Mac.
- iOS 15, идентичность `app.talkhint`, production `https://talkhint.app`
  сохранены. Нет изменений моделей, телефонии, Кати, Retell или аудио.

## Тесты → одна сборка → установка

Replit: **641/641 основная + 31/31 связанная проверка**, TypeScript без ошибок, ключи 5
локализаций совпадают. **Swift/XCTest здесь не запускались.**

Проверить текущий Xcode/SDK и использовать существующий test simulator/cache.
Не переименовывать Xcode, не создавать symlink, не обновлять зависимости.
Если нужно включить новые glob-исходники — из `ios` штатный `xcodegen generate`.

Только эти наборы:

- `ChatDocumentsTests`:
  - `testDocumentListKeepsUnknownTypesAndHiddenOrDeletedStatuses`;
  - `testBatchUsesDocumentEndpointAndDoesNotConfirmOrDial`;
  - `testWholeDocumentCardHasOneSaveAndOneCancelDespiteMultipleParts`.
- `ChatMemoryTests`, `ChatMemoryScreenTests`.
- `ChatAPITests`, `ChatOutboxTests`, `ChatNavigationTests`.

Команда из каталога `ios` с **реальным ID существующего** test simulator:

```sh
xcodebuild -project TalkHint.xcodeproj -scheme TalkHint \
  -configuration NativeValidation -destination "platform=iOS Simulator,id=$SIMULATOR_UDID" \
  -only-testing:TalkHintTests/ChatDocumentsTests \
  -only-testing:TalkHintTests/ChatMemoryTests \
  -only-testing:TalkHintTests/ChatMemoryScreenTests \
  -only-testing:TalkHintTests/ChatAPITests \
  -only-testing:TalkHintTests/ChatOutboxTests \
  -only-testing:TalkHintTests/ChatNavigationTests test
```

Без сетевых/платных операций и записей в production. Не запускать весь gate.
При ошибке/новом предупреждении от дельты остановиться, вернуть точный текст.
Допустимое узкое исправление — отдельный commit для Replit; не подавлять ошибку.

После подтверждённого серверного Publish — одна incremental обычная сборка:

```sh
xcodebuild -project TalkHint.xcodeproj -scheme TalkHint -configuration Debug \
  -destination "id=$IPHONE_UDID" build
```

Использовать текущую подпись/кэш, не менять Team/сертификаты. Определить путь
готового обычного TalkHint.app из build settings, не выбирать AppDev.
Установка/открытие через существующий разрешённый способ (`devicectl`):

```sh
xcrun devicectl device install app --device "$IPHONE_UDID" "$TALKHINT_APP_PATH"
xcrun devicectl device process launch --device "$IPHONE_UDID" app.talkhint
```

Без удаления приложения/данных, Archive/TestFlight/Publish, телефонных
звонков, писем, платного распознавания или смены ключей.

Вернуть: ветка/HEAD; passed/failed/skipped и длительность целевых XCTest;
build/install и время; новые предупреждения; пути логов; что на устройстве
не проверено. Коротко, без ZIP.

## Владельцу на телефоне

1. `Чат → + → Документы`: список открывается, скачивание своего оригинала
   не закрывает чат/черновик; чужих файлов нет. Если документов ещё нет —
   понятная инструкция, не ошибка.
2. После отдельно разрешённого распознавания тестового фото/PDF: в чате
   одна карточка на документ, сомнительное выделено «проверь». До Save память
   не меняется; Cancel не сохраняет. Не запускать Катю/Hint для проверки.
3. У сохранённого тестового документа проверить pin/историю; «Забыть» —
   только на тестовом: скрытие сразу, предупреждение 30 дней; до удаления
   восстановление возвращает карточку, а удалённый оригинал не обещается.
