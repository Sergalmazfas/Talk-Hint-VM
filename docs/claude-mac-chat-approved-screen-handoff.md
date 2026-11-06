# Claude на Mac: утверждённый экран TalkHint Chat, только Dev

## Точная передача

- Репозиторий: https://github.com/Sergalmazfas/Talk-Hint-VM
- Ветка: `xcode-chat-approved-screen-2026-11-05`.
- Коммит кода: `ba0e9da0c3b430e186217c3319aefd05f9f4ea56`.
- Принятая Mac-база: `0ab36d5fc30358e5ebdb94e26ddfb0bd9e7b17a8`.
- Источник Chat-кода Replit: `e27926a97ca25de93c30fea8a9a682a0facf3f3a`;
  это provenance, **не указание переключиться на Dev/clean-main**.
- HEAD ветки дополнительно содержит это задание и список обязательных тестов.
- Отчёт владельца для базы 0ab36d5: полный холодный gate, **226 passed /
  0 failed / 0 skipped**, успешный verify-xcresult; Xcode 26.5 (17F42),
  SDK/Simulator 26.5, iPhone 11, XcodeGen 2.45.4.
  Это исторический результат базы, **не результат текущей ветки**.

Цель: независимо проверить код, исправить найденные технические ошибки,
выполнить полный native gate, затем запустить **только локальный preview**
для владельца и предоставить настоящие крупные скриншоты.
Не считать выполнение этого задания разрешением на релиз.

## Границы — строго

Только экран чата по утверждённому образцу. Не делать меню, карточки,
календарь, почту, интеграции, новый голосовой движок или Voice Orb.
Не подключать этот экран к центральной вкладке и не менять основной UI.
Никакого Publish, Archive, TestFlight, production, реальных звонков,
платных моделей/STT/репетиций. Не менять ключи, Apple Team, сертификаты,
entitlements, голос, Retell, телефонные лимиты, сервер или CI workflow.

Ветка — **изолированная передача от принятой Mac-базы**, не полный Replit Dev.
Основная навигация и телефонный код оставлены как в базе. Это не откат
установленного приложения и не разрешение активировать Copilot.
**Не запускать обычную TalkHint/Release-схему и не распространять эту ветку.**

## До checkout / build

1. В существующем репозитории записать `git status --short`, текущую ветку,
   HEAD и локальные коммиты. Не выводить credentials в remote URL/логах.
2. Не делать stash, reset, clean, force, rebase, merge; не перезаписывать
   существующие ветки, worktree, чужие файлы и локальные Mac-исправления.
3. Если есть неизвестные непереданные изменения/коммиты Mac — STOP и отчёт:
   какие исправления отсутствуют в передаваемой базе. Не воссоздавать их
   по одному SHA и не накладывать патчи повторно.
4. Проверить свободное место. В последнем отчёте было около 4.6 GiB;
   актуальное значение неизвестно. Не удалять DerivedData/worktree/xcresult
   без отдельного согласия владельца. При нехватке места — STOP.
5. Получить ветку существующим авторизованным origin, затем создать **новый,
   отдельно названный worktree**, не переключая старый checkout:

```sh
git fetch --no-tags origin \
  refs/heads/xcode-chat-approved-screen-2026-11-05:refs/remotes/origin/xcode-chat-approved-screen-2026-11-05
git rev-parse refs/remotes/origin/xcode-chat-approved-screen-2026-11-05
git merge-base --is-ancestor 0ab36d5fc30358e5ebdb94e26ddfb0bd9e7b17a8 \
  refs/remotes/origin/xcode-chat-approved-screen-2026-11-05
git merge-base --is-ancestor ba0e9da0c3b430e186217c3319aefd05f9f4ea56 \
  refs/remotes/origin/xcode-chat-approved-screen-2026-11-05
```

Для `git worktree add -b ... <новый-путь> <remote-ref>` выбрать ещё не
существующие локальное имя и путь. Ничего не удалять, если имя занято.
В новом worktree проверить чистоту и совпадение HEAD с полученным remote SHA.
На исходной передаче после code commit допустимы только два документа:
это задание и `docs/chat-1a/MAC_REQUIRED_TESTS.md`.
Не брать ветку из другого репозитория и не синхронизировать полный Dev tree.

### Старые Mac-исправления должны остаться

В Replit эти файлы проверены побайтно относительно принятой базы:

- `ios/TalkHint/UI/InCallViewController.swift`;
- `ios/TalkHintTests/InCallCaptionTests.swift`;
- `ios/TalkHintTests/PreparedHintPlansTests.swift`:
  SHA-256 `4dd6314001a17d00856522e6a7ff7437e56b6cd29bd573d2a43df755e2c73807`;
- `ios/TalkHintTests/SecretaryPersonalityUITests.swift`:
  SHA-256 `8d39aae64fd157b17de8203628c2ce876bd4bf665a1a0a70f35557c1577c5906`.

Включены старое исправление call-screen safe-area crash, window/trait
фикстура Prepare и bounded provider-sheet wait. Не накладывать их снова.
Отдельно сохранить/проверить
`SecretaryPersonalityUITests.testGPTAndRetellSelectionOnlyChangesFutureDrafts`.
Не увеличивать таймеры и не менять assertions, чтобы скрыть ошибку.

## Что передано и что не переносилось

- Новый каталог `ios/TalkHint/Chat/`: существующие Dev-handlers, models/API
  extension, owner-scoped outbox, dictation state/bar, opt-in reference skin,
  DEBUG-only offline preview и вспомогательный navigation container.
- Пять новых Chat test classes; два source-contract файла.
- Только Chat-ключи добавлены к пяти таблицам локализации; старые строки
  Mac-базы не заменены.
- `ChatPreview` / `TalkHintChatPreview` внутри существующего XcodeGen target.
- AppDelegate/SceneDelegate — только compile-time вход в offline preview.
- Захват настоящих Simulator screenshots и утилита одинаковой ширины.

Не переносились Dev-изменения Home/Secretary, CallManager, CopilotStream,
APIClient, push routing, основных вкладок, сервера и workflow.
`makeMainTabController()` побайтно совпадает с Mac-базой; обычные экраны
не заменены картинками или плитками.
Все старые записи REQUIRED_TESTS и validate-native.sh сохранены; добавлены
33 обязательных Chat-теста. Список поимённо:
**[MAC_REQUIRED_TESTS.md](chat-1a/MAC_REQUIRED_TESTS.md)**.
Он включает также обязательные тесты прежней базы, а не только новые.

## Визуальный эталон — именно он

**[reference/approved-chat-original.jpeg](../reference/approved-chat-original.jpeg)**
— крупный IMG_4200, 960×1517.
SHA-256 `28bfba3a0b34b0397a15b30b4f69bbed37404fb80d591ad4ade019268f612ed8`.
Не заменять его общим коллажем или предыдущими мелкими концептами.

Параметры и допущения:
- [APPROVED_SCREEN_MEASUREMENTS.md](chat-1a/APPROVED_SCREEN_MEASUREMENTS.md);
- [APPROVED_SCREEN_MAC.md](chat-1a/APPROVED_SCREEN_MAC.md).

Сообщения 20 pt, поле 19 pt, headline 20 pt; Dynamic Type. Hit targets ≥44 pt,
чёрный Orb 48 pt отдельно справа от капсулы. Оттенки и параметры измерены
приблизительно по JPEG при нормализации ширины к 390 pt; это не доказанный
исходный iPhone scale. Верх рисунка обрезан — системную safe area не выдумывать.
Не менять дизайн свободно. При необходимости исправить constraint/overflow/
потерянный элемент, показать точную причину и результат относительно эталона.
Не уменьшать шрифт, чтобы «всё влезло», и не выдавать hit target за размер иконки.

## Техническая проверка и исправления

1. Независимо просмотреть Swift/constraints, жизненный цикл, отмену/повтор
   диктовки, сохранность текста, недопущение отправки без действия пользователя,
   владельца/черновика и корректность offline transport.
2. Проверить, что `.approvedReference` включён только в отдельном preview.
   В нём нет tab bar и действий бокового меню; кнопка Orb не запускается.
3. Проверить compile-time flags: preview не стартует CallKit/PushKit и не
   требует реального login. NativeValidation сохраняет прежнюю изоляцию.
4. Сверить Xcode/XcodeGen/SDK. Последний рабочий путь — Xcode.app, **не**
   отсутствующий Xcode_16.4.app. Не переименовывать Xcode и не создавать symlink.
5. Полный cold-simulator gate, из корня нового worktree:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  bash ios/scripts/validate-native.sh
```

Полный `TalkHintTests`, без `-only-testing`, `-skip-testing`, пропуска
классов, подмены runner или ослабления verify-xcresult. Финальный verifier
должен выполниться и пройти на **итоговом HEAD**.

На ошибке прекратить текущий прогон, сохранить стек/диагностику. Разрешены
минимальные исправления в пределах этого экрана/его тестов. Каждое — отдельный
коммит с причиной и diff. Повтор полного gate допустим после реального
исправления, не повторять неизменённый flaky-прогон до случайного зелёного.
Если исправление требует других функций, изменения безопасности или дизайна
вне образца — STOP и вопрос владельцу.

До пуша исправлений показать diff и SHA; сохранять их только в этой отдельной
ветке, без force/merge/main/clean-main. Если push недоступен — точная ошибка
без credentials и оригинальные git patches, не обход прав/не новый токен.

## Только после успешного gate — локальный показ

Проверить отдельную сборку **TalkHintChatPreview / ChatPreview** для Simulator.
После её успешной сборки разрешён её локальный запуск, **не релиз**.
Не запускать обычную TalkHint-схему или телефонный сценарий.

Открыть на служебном экране sample conversation. Проверить настоящее UIKit:

- заголовок/стрелку и видимый крупный текст; сообщения/плотность/цвета;
- поле/плюс/микрофон и отдельный Orb; отсутствие вкладок и меню;
- компактную ширину, прокрутку, editing и клавиатуру;
- RU/EN/ES через язык приложения в схеме; светлую/тёмную тему;
- отмену UI-диктовки/recognition, возвращение редактирования без автосенд.

Предпросмотр — **локальные данные, не работающий AI/STT**. Recording и
recognition fixtures — явно симулированные UI-состояния. Волна fixture имеет
фиксированную амплитуду; обычный handler по-прежнему использует настоящий meter.
Микрофон, распознавание и файлы не подключать к провайдерам ради этой проверки.

Сохранить отдельные крупные **реальные native** screenshots, не рисунки и
не мелкий коллаж. Для полного экрана с системной клавиатурой — Simulator ⌘S
или `bash ios/scripts/capture-chat-approved-preview.sh`.
UIView attachments в xcresult не доказывают capture системной клавиатуры.
Для сравнения скрипт сохраняет два отдельных изображения одной ширины;
это нормализация, не автоматическое доказательство pixel-perfect совпадения.
Если условие не проверялось — так и написать.

## Вернуть владельцу

Краткий отчёт в чате + файл отчёта в этой же ветке:

1. Branch, первоначальный code SHA, финальный HEAD, список fix commits/diff.
2. Версии/пути Xcode, XcodeGen, SDK и Simulator; свободное место.
3. Полный passed/failed/skipped и итог verify-xcresult. Обязательные Chat
   и старые Mac-регрессии — отдельно. Не подменять результат текущего HEAD
   историческими 226 passed.
4. Исходные ошибки, точная причина и что исправлено; логи/xcresult/attachments.
5. Крупные screenshot-файлы и сравнение с исходным JPEG, что осталось проверить.
6. Итог: **ГОТОВ К ЛОКАЛЬНОМУ ПОКАЗУ ВЛАДЕЛЬЦУ** либо **БЛОКЕР**.
   Не писать «готово к релизу» на этом этапе.

После показа **остановиться**. Финальное визуальное принятие — только владелец.
Подключение Chat к вкладке, меню, публикация, Archive и TestFlight требуют
отдельного разрешения. Publish сайта не обновляет iPhone-приложение.
