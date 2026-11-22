# Текущая дельта после Mac-аудита abd1a749

База: `abd1a749c9b3a51adcc55f23ccdba59b51d24606`.
Независимый Mac-результат владельца: 126/127, блокер — восстановление позиции
чтения (263 вместо 250 ±2). Это результат предыдущего снимка, не текущего.

## Навигация и раскладка

- ChatNavigationTests выбирает ввод по accessibilityIdentifier=chat-composer,
  не первый UITextView; редактирование начинается после загрузки беседы.
- В продукте был реальный порядок, допускающий сдвиг: контроллер потреблял
  pendingScrollRestore на первом viewDidLayoutSubviews, а ChatMessageTextView
  мог затем инвалидировать intrinsic height после измерения ширины.
  Точный вклад в наблюдавшиеся 13 pt в Linux не воспроизведён: нет UIKit/Xcode.
- Якорь теперь восстанавливается на стабильной геометрии через layout turns;
  учитываются contentSize, viewport, insets и высота composer. Refresh при
  возврате в чат сохраняет позицию до перестройки message views. Старые
  отложенные auto-scroll отменяются поколением; начало ручного drag отменяет
  восстановление, чтобы не бороться с пользователем.
- Регрессионный тест ждёт настоящую замену message views при refresh,
  проходит повторные self-sizing раскладки и проверяет прежние 250 ±2
  также в последующих layout passes. Допуск не расширен.

## Цель только своего исходящего

- GoalLifetime.begin требует явный isOutgoing; входящий UUID не захватывает
  владение. CXStartCallAction требует исходящую сессию.
- Входящий reject/end/error и reset без владельца не стирают неиспользованную
  PREP-цель. endCall без сессии тоже её не сбрасывает.
- Отказ замороженного Copilot не сбрасывает PREP. Тест вызывает настоящий
  ранний startOutgoingCall(.copilot), без CallKit transaction/сети.
- Экран входящего не потребляет staged opening и не копирует/перезаписывает
  исходящую PREP-цель. Его live socket при reconnect берёт локальное поле цели;
  это не меняет сервер, типы control messages или телефонные маршруты.
- Отдельные a/b/c XCTest: входящий не меняет владельца исходящего; входящий
  без исходящего сохраняет PREP; отказ Copilot сохраняет цель и staged opening.

## Передача

Только native/docs, без сервера, SQL, Publish, моделей или платных вызовов.
Replit не выполняет XCTest в Linux. На Mac: ChatNavigationTests,
HintCallPreparationTests, ChatMessagePresentationTests, InCallCaptionTests
и связанный CallHintStreamReconnectTests; после зелёного результата
одна итоговая сборка в существующей рабочей копии, поверх приложения без удаления.
Откат — revert только текущей дельты поверх abd1a749.
Локально: 6/6 статических проверок native memory, отдельная сверка a/b/c,
incoming screen/stream, строгих 250 ±2 и native/docs-only diff; diff --check чистый.
Это проверки исходников, не компиляция Swift/XCTest и не подтверждение исчезновения
13 pt на устройстве. Финальный вердикт по UIKit — целевые XCTest на Mac.

---

# Предыдущая дельта: цель звонка и недоступная озвучка

База: `b4c799358fbb5444ae8f54645bfe5a762ca00859`. Предыдущие десять
исправлений приняты владельцем по независимому Mac-аудиту; ниже — новая узкая дельта.

## Production Hint

Read-only GET https://talkhint.app/api/build вернул
`3749bfa821d8934306a9d2d7081db6e9f44213de`, dirty=false,
build `2026-11-22T06:47:54.208Z`. Команда
`git merge-base --is-ancestor 45d8b0f18dcd65aa4900c5cfaa265be009752593 3749bfa821d8934306a9d2d7081db6e9f44213de`
вернула 0. В production-дереве server/websocket.ts сохранены SavedPlanOpening,
нейтральная первая фраза и инвалидирование opening речью владельца.

## Исправления

- CallManager владеет сроком жизни цели по UUID, независимо от открытия экрана.
  Очистка callGoal одновременно очищает staged opening штатным setter SessionStore.
  Покрыты terminal delegate/endSession, отказ запроса CallKit, отмена до токена,
  provider reset, timeout start/answer/end и ранний отказ недоступного режима.
  Цель очищается до публикации terminal notification. Поздний callback старого
  UUID не стирает цель нового звонка. Отменённый preflight не восстанавливает цель.
- InCallViewController больше не владеет локальной очисткой; его уведомление
  серверу setGoal("") при teardown сохранено.
- При readAloud.available=false неактивная Play остаётся видимой; под действиями
  короткая локализованная причина по server reason. Известные причины: доступ
  аккаунта, выключено сервером, голос не выбран, озвучка не настроена; неизвестная
  причина — понятный общий текст. Технические коды и секреты не выводятся.
  Остановить уже начавшееся воспроизведение можно и после отключения capability.

## Проверки и передача

Добавлены XCTest: очистка настоящего SessionStore без открытия экрана и
следующий номер без чужого HintGoal/plan; поздний callback и reset; локализация
причин; offline UI с видимой неактивной Play и объяснением.
В Linux XCTest не исполнены: нет Xcode/iOS SDK. Claude на Mac выполняет
HintCallPreparationTests, ChatReadAloudTests, ChatApprovedScreenTests,
затем одну итоговую сборку после зелёного результата.
Локально прошли 6/6 статических проверок native memory, равенство ключей и
placeholders пяти локализаций, проверка связей терминальной очистки и
git diff --check. Это не результат компиляции Swift или выполнения XCTest.

Серверных изменений, SQL, Publish, платных вызовов нет. Откат: revert только
этой native-дельты поверх b4c79935; production и данные не менять.

---

# Предыдущий принятый аудит: исправления по a0a772b

Постоянная ветка: `xcode-chat-voice-sarah-2026-11-11`.
База: `a0a772b692166b7aaa2d0eab1056b72bef2e72b4`.
Все изменения — native-код, тесты и документы. Сборка и Publish не выполнялись.

| № | Исправление | Проверка для Mac |
|---|---|---|
| 1 | Keyboard editing test выбирает только `chat-composer` | ChatApprovedScreenTests |
| 2 | Tap-to-copy получает подменный clipboard writer; test не читает/не восстанавливает general pasteboard | ChatMessagePresentationTests |
| 3 | При пустом/неудачном preflight сохранена переданная localOpening PREP, уже проверенная по цели CallManager; без неё нейтральная | HintCallPreparationTests |
| 4 | Fenced code минует Markdown-парсер; prose разбирается построчно, переводы строк/отступы кода не склеиваются | ChatMessagePresentationTests: текст показа и whole-copy |
| 5 | chatBinary сохраняет серверный error/code; UI переводит busy/limit/unavailable/failure/network/auth в понятный текст | ChatReadAloudTests, ru/es/en |
| 6 | Сообщения пользователя отображаются буквально; Markdown только у ассистента | ChatMessagePresentationTests |
| 7 | Две компактные подписи copyItems + меню «ещё N»; код имеет короткую подпись, значение копируется полностью | ChatMessagePresentationTests + визуальный аудит |
| 8 | Файл называется по таблице, с очисткой небезопасных символов и ограничением UTF-8; уникальна лишь временная папка. Failed/purged освобождает попытку для явного Retry; неизвестный исход сохраняет requestId/job | ChatTablesTests |
| 9 | Ошибки таблиц — локализованный текст, не TABLE_*; при экспорте есть явная кнопка повтора | ChatTablesTests |
| 10 | Сервер возвращает manifest по исходному row.text, включая пробелы/код. Нормализация — позже, при озвучке выбранного slice. Пропусков ranges сейчас нет, строгая проверка покрытия сохранена | ChatReadAloudTests + бесплатная проверка текущего server/chat/readAloud.ts |

Ключи локализации добавлены синхронно в en/ru/es/kk/uk. Новых платных вызовов нет.
Ошибки воспроизведения не запускают автоматический платный повтор.

## Доказательства и границы

Статические проверки памяти/пяти локализаций: 6/6.
Дополнительно: равенство ключей и placeholders пяти языков, JSON fixtures,
отсутствие general pasteboard в tap-тестах. На фактическом серверном
speechSegments/checkSpeechRange бесплатно проверены 3 образца (код/пробелы,
2300 UTF-16 с emoji и fenced code, 1301 пробел): полное покрытие, gaps = 0.
Новые и изменённые XCTest написаны, но в Linux нет Xcode/iOS SDK:
их результат не выдаётся за green. Время 174 с из аудита относится к старому
тесту системного pasteboard; ускорение нового теста должен подтвердить Mac.

Серверные изменения и SQL: **нет**. Контракт manifest не ослаблен ради возможного
будущего сервера с gaps: такая смена потребует явной версии/совместимости.
Retell, модели, Катя, Hint-промпты, звонковые маршруты не изменялись.

## Передача Claude

Продолжить единое задание `docs/claude-mac-ios-consolidated-handoff.md` в прежней
рабочей копии, получить HEAD этой же ветки. Выполнить ChatApprovedScreenTests,
ChatMessagePresentationTests, HintCallPreparationTests, ChatReadAloudTests,
ChatTablesTests. Новые файлы подключить штатным XcodeGen при необходимости,
не обновлять зависимости и не менять подписи/минимум iOS 15.
При красном результате вернуть точную ошибку Replit, не исправлять продукт
проверяющим. Итоговая одна сборка — после проверок и разрешённого владельцем
серверного Publish/сверки `/api/build`; установка поверх, без удаления данных.

Откат этой дельты — отмена её отдельного коммита поверх a0a772b,
без reset, без отката пользовательских данных или серверной схемы.
