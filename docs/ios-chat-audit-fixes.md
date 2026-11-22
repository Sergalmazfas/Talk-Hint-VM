# Исправления аудита Claude Mac по a0a772b

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
