# Claude Mac: устойчивый чат — одна проверка и одна итоговая сборка

Это единственное актуальное задание на следующую сборку. Оно заменяет очередь
из предыдущего `claude-mac-ios-consolidated-handoff.md`, не добавляет вторую сборку.
Claude проверяет, но не дописывает продукт: красное вернуть Replit с файлом/строкой.

## Репозиторий, ветка, точные границы дельты

- Репозиторий: https://github.com/Sergalmazfas/Talk-Hint-VM
- Ветка: `xcode-chat-voice-sarah-2026-11-11`.
- База: `6a4fe3a858201ff3da4ba10261ae7665662a47e7`.
- Коммит нового native-кода: `dfc559c4f30ef1b32209df03b9e751b780761d93`.
- Следующий за ним коммит содержит только эту передачу.
- Сохранены рабочие Agata/WebRTC/trickle ICE, Hint/PREP/GoalLifetime, память,
  документы, камеры, копирование, Markdown, таблицы и прежние Mac-исправления.
  Серверную ветку и старый `ios/` из неё НЕ сливать в эту native-ветку.

```sh
cd ~/Talk-Hint-VM-worktrees/chat-voice-sarah-concurrency
git status --short
# Чужие изменения: стоп, без stash/reset/clean/force/rebase, новой ветки/worktree.
git fetch origin xcode-chat-voice-sarah-2026-11-11
git merge --ff-only origin/xcode-chat-voice-sarah-2026-11-11
git merge-base --is-ancestor 6a4fe3a858201ff3da4ba10261ae7665662a47e7 HEAD
git merge-base --is-ancestor dfc559c4f30ef1b32209df03b9e751b780761d93 HEAD
git rev-parse HEAD
```

## Серверная зависимость и разрешения

Сервер изменён в Dev, Replit его НЕ публиковал. Нужен Publish владельцем:
`94515e7e` или потомок с исправлением ревизий Агаты и response-only retry.
Новый сервер добавляет `answerRetry: {revision:1,responseOnly:true}` и
`POST /api/chat-v1/conversations/:id/messages/:messageId/retry-answer`.
Миграций нет. На старом сервере кнопка повторения не показывается.

До подтверждения владельцем Publish — только просмотр исходников. Это задание
не является отдельным разрешением собрать/установить приложение. После Publish
и разрешения владельца выполнить целевые тесты, затем ОДНУ device-сборку.
Перед ней прочитать production `/api/build`, сохранить фактический JSON и проверить
ancestry к `94515e7e` (если объекта нет — спросить Replit, не угадывать).
Известный адрес из предыдущей передачи: `https://talkhint.app/api/build`;
если конфигурация обычного TalkHint указывает иной production — сначала сверить.
Не запускать сервер из native-ветки и не публиковать его.

## Что проверяется

1. Composer занимает полную строку. Кнопки под ним; высота до шести строк, затем
   внутренняя прокрутка. Вместо большого Done — значок скрытия клавиатуры.
   Обычный body Dynamic Type, системную доступность не отключать.
2. Partial текста не делает узкую колонку. Один индикатор генерации, без пустого
   фиолетового пузыря ошибки. Читатель выше конца остаётся у того же сообщения
   при росте текста выше него. «↓ Новое» возвращает вниз только по нажатию.
3. Поручение: суть, номер, первая фраза; «Подробности», «Исправить», прежний
   явный review/start. Полные условия не удалены. Заменённая карточка остаётся
   короткой строкой истории без второй формы и без кнопки запуска.
   Текст/голос «да» не открывает review и не запускает звонок.
4. Диктовка: только `requiresOnDeviceRecognition=true` при слушании; слова
   заменяют текущую гипотезу в редактируемом черновике. Ничего само не отправляется.
   Правка пользователем останавливает подмену его текста гипотезами.
   Stop ждёт финал до 1.5 с. Если финала нет — существующий batch STT ровно после
   Stop, из временного mono 16k WAV всей записи. Никакого нового STT-провайдера.
   При недоступном/запрещённом Speech — прежняя запись с распознаванием после Stop.
   Cancel/смена владельца/чата/фон отменяют результат и удаляют временный файл.
   Старый предел диктовки 60 с сохранён; это не лимит разговора с Агатой.
5. Новый владелец звука `.dictation`: не включать Агату/read-aloud одновременно
   с диктовкой; телефон имеет приоритет. Проверить освобождение lease и восстановление
   категории AVAudioSession при cancel/Stop/error. Retell/Merritt не менять.
6. «Повторить только ответ» — новый отдельный endpoint и сохранённый UUID запроса.
   При неизвестном результате следующий tap использует тот же UUID. Не повторяет
   исходное сообщение, подтверждение, звонок, письмо, запись памяти или таблицы.

## Что уже проверено и что ещё неизвестно

Replit: бесплатные серверные тесты и PG-репродуктор гонки; TypeScript; 68/68 native
source-contract checks; пять локализаций, privacy-ключи и plist; diff-check.
В принятой native-базе было четыре устаревших source-check ожидания (камера,
координаты прокрутки, старый voice entry); они приведены к уже существовавшему коду.
Ещё два source-check отражают намеренно изменённую ширину/шрифт.
Добавлены 11 XCTest, но на Linux они НЕ запускались. Снимков нового UIKit,
измерений качества локального Speech и проверки физического микрофона пока нет.
Не выдавать эти исходниковые проверки за 68 XCTest.

Новый Speech.framework — системный SDK, не новая зависимость. Есть
`NSSpeechRecognitionUsageDescription` на пяти языках. Проверить пригодность
существующей подписи/entitlements для on-device Speech. Не менять Team,
сертификаты, provisioning или capabilities молча: если это требуется — блокер
с объяснением; штатный batch-fallback не обходить.

## Целевые проверки после разрешения владельца

Использовать существующий Xcode/SDK, проект и кэши. Не удалять DerivedData.
Новые файлы включаются штатным `project.yml`; при необходимости выполнить
имеющийся XcodeGen, не обновляя пакеты. Не запускать полный gate без отдельной причины.
`SIMULATOR_UDID` — выбрать из уже доступных симуляторов, не выдумывать.

```sh
cd ios
xcodebuild -project TalkHint.xcodeproj -scheme TalkHint -showdestinations
xcodebuild -project TalkHint.xcodeproj -scheme TalkHint \
  -configuration NativeValidation \
  -destination "platform=iOS Simulator,id=$SIMULATOR_UDID" \
  -parallel-testing-enabled NO \
  -only-testing:TalkHintTests/ChatApprovedScreenTests \
  -only-testing:TalkHintTests/ChatDictationTests \
  -only-testing:TalkHintTests/ChatAnswerRetryTests \
  -only-testing:TalkHintTests/ChatNavigationTests \
  -only-testing:TalkHintTests/ChatReadAloudTests \
  -only-testing:TalkHintTests/ChatMessagePresentationTests \
  -only-testing:TalkHintTests/ChatAgataAudioRoutingTests \
  -only-testing:TalkHintTests/CallAudioDeviceRouterTests \
  -only-testing:TalkHintTests/HintCallPreparationTests \
  -only-testing:TalkHintTests/InCallCaptionTests \
  -only-testing:TalkHintTests/CallHintStreamReconnectTests test
```

Не пропускать новый красный тест ради сборки. Обязательные новые сценарии:
full-width composer на 320 pt; короткий/длинный streaming; один indicator;
пустая ошибка; старая карточка после замены; якорь после роста верхнего сообщения;
замена partial без накопления; финал только после Stop; WAV без микрофона;
взаимоисключение audio lease; повтор запроса с тем же UUID; старые capabilities.
Вложить XCTest-снимки `chat-689-*`, в том числе компактную/полную карточку.

Только при зелёных связанных тестах, подтверждённом сервере и разрешённой установке:

```sh
xcodebuild -project TalkHint.xcodeproj -scheme TalkHint -configuration Debug \
  -destination "id=$IPHONE_UDID" build
# TALKHINT_APP_PATH получить из build settings существующей сборки.
xcrun devicectl device install app --device "$IPHONE_UDID" "$TALKHINT_APP_PATH"
xcrun devicectl device process launch --device "$IPHONE_UDID" app.talkhint
```

Обычный TalkHint поверх установленного, без удаления приложения/данных/Keychain.
Без AppDev, TestFlight/Archive, платных STT/TTS/OCR/LLM-проб, звонков, писем,
new-country и каких-либо операций 682@2. Не раскрывать ключи.

## Ответ владельцу и Replit

HEAD, фактический `/api/build`, passed/failed/skipped по suites, время проверок
и сборки, новые warnings, установка, build/version stamp, ссылки на xcresult/снимки;
что не проверено на устройстве. Ошибки вернуть Replit, не править продукт самому.

Последние проверки владельцу после разрешённой установки:
1. Надиктовать короткое поручение: видеть слова, исправить одну цифру, Stop,
   проверить текст, отправить самому. Cancel не отправляет ничего.
2. Читать середину длинной беседы, дождаться ответа: не отбрасывает наверх;
   «↓ Новое» возвращает к последнему сообщению.
3. Уточнить поручение: видеть короткую новую карточку, раскрыть подробности;
   старая карточка недоступна. Реальный звонок для этой проверки не нужен.
