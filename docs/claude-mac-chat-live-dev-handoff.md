# Claude на Mac: настоящий Chat в отдельной Dev-сборке

Владелец одобрил внешний вид и разрешил перенос исправлений Claude в Dev
с реальным подключением. Дизайн больше не переделывать.

## Ветка и границы

- Репозиторий: https://github.com/Sergalmazfas/Talk-Hint-VM
- Ветка: `xcode-chat-live-dev-2026-11-07`.
- База: `064e76e9718cb5444cdbeb8d37518b7de080c751`.
- Точный новый HEAD сверить через `git ls-remote` после fetch.
- Это аддитивная нативная доставка, НЕ синхронизация всего Dev/сервера.
- Исходные Mac-патчи: `6baf30b`, `5bee7f3`, `a21ed07`, `18c564f`,
  отчёт `6d4ffb4`. Автор исходных исправлений — Claude Code на Mac владельца.
  Они перенесены из ZIP, не являются предками этой ветки.
- Никаких Publish, Archive, TestFlight, звонков, репетиций, Orb, меню,
  изменений рабочей навигации, Apple Team или сертификатов.

## Что сделано

Исправлены общий предок до bubble constraints, scroll layout, первый
черновик и ожидание событий UIKit в тестах. Исходники переноса сверены
по Git blob: контроллер без нового factory `665bf85`, тесты `45971f5`.

Добавлена схема **TalkHintChatLiveDev**, конфигурация **ChatLiveDev**,
флаг **TALKHINT_CHAT_LIVE_DEV**. Продукт `TalkHintChatDev`, отдельный bundle
`app.talkhint.chatdev`: рабочая установка, Keychain и UserDefaults не заменяются.
Настоящий Login → полноэкранный Chat с принятым appearance, реальным
URLSession и owner/origin-scoped черновиками. Никаких fixtures/auth bypass.
Назад возвращает на Login этой изолированной схемы. История остаётся в БД.
Push/телефонные провайдеры при запуске не инициализируются.
Диктовка сохраняет штатную проверку аудиосессии; звонки не инициировать.

Google-вход скрыт только в LIVE_DEV: старый `talkhint://` callback принадлежит
рабочему приложению. Владелец сам вводит email/пароль Dev-аккаунта.
Пароли/токены не записывать в файлы и отчёт. Если данных входа нет —
STOP в этой части, не создавать админ-доступ и не обходить auth.

Сервер уже существует **в Replit**: `server/chat/*`, регистрация
`/api/chat-v1` из `server/routes.ts`. Новый сервер писать не нужно.
AppConfig требует явный HTTPS `.replit.dev`, без fallback на production.

## Безопасное получение

Показать git status/ветку/HEAD, свободное место. Старую Mac-ветку с
`6d4ffb4`, патчи и отчёты сохранить. Fetch штатного remote этого репозитория;
создать НОВУЮ локальную ветку от remote HEAD в чистом выделенном worktree.
Не применять старые Mac-патчи повторно. Никаких stash/reset/force/rebase/merge.
При неизвестных изменениях, нехватке диска или подписи — STOP.
Никакой новой очистки сверх ранее разрешённых точных кэшей.

Проверить сохранённые прежние регрессии:
`InCallViewController.swift`, `InCallCaptionTests.swift`,
`PreparedHintPlansTests.swift` SHA256
`4dd6314001a17d00856522e6a7ff7437e56b6cd29bd573d2a43df755e2c73807`,
`SecretaryPersonalityUITests.swift` SHA256
`8d39aae64fd157b17de8203628c2ce876bd4bf665a1a0a70f35557c1577c5906`.

## Gate, затем отдельная сборка LIVE_DEV

Проверить фактический Xcode/SDK/runtime/XcodeGen. Последний Mac:
Xcode 26.5 (17F42), `/Applications/Xcode.app`, XcodeGen 2.45.4,
iOS Simulator 26.5. Не переименовывать Xcode и не делать подменяющий symlink.

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  bash ios/scripts/validate-native.sh
```

Полный TalkHintTests без фильтров + `verify-xcresult.py`.
Поимённый обязательный список: `docs/chat-1a/MAC_REQUIRED_TESTS.md`.
Все 33 Chat-теста в пяти классах и прежние регрессии обязательны.
259/259 старого Mac-прогона не заменяет gate на новой доставке.
Не ослаблять проверки и не повторять без причины «до зелёного».
Если повторяется `Unbalanced calls to begin/end appearance transitions` —
сохранить предупреждение и доложить, даже при зелёном gate.

```sh
cd ios
xcodegen generate --spec project.yml
open TalkHint.xcodeproj
```

Выбрать **TalkHintChatLiveDev**, arm64 iPhone Simulator, Run.
Перед запуском сверить resolved settings: `app.talkhint.chatdev`,
`TalkHintChatDev`, флаг LIVE_DEV. Native gate не компилирует этот флаг:
отдельная сборка обязательна. Обычную TalkHint-схему/Release не запускать.

В Run Environment задан реальный Dev:
https://e62acc35-f5e5-43be-91ea-c3ad7b36be85-00-3l7jbsd7n4zci.janeway.replit.dev

Replit workflow должен работать. Production URL не подставлять.
На iPhone не ставить без явного согласования подписи; начать с Simulator.

## Реальное подключение: что уже доказано

На Replit: HTTPS Dev + обычный Bearer auth, создание/повторное чтение
PostgreSQL, идемпотентность, изоляция двух синтетических пользователей,
реальный upload/download App Storage. Тестовые аккаунты и файл удалены.
209 серверных тестов, 36 Python source checks и 28 native gate helper checks
прошли; это не native запуск этой схемы.

С отдельного разрешения владельца «Да, максимум $0.50» выполнен ОДИН
AI-запрос через Dev API с txt-вложением: `green-42`, status complete,
модель `gpt-5.6-sol`, 166 input / 7 output tokens, reasoning 0.
Usage/provider ID проверены в PostgreSQL. Повтор HTTP с тем же ID
не создал генерацию: тот же reply ID, в истории два сообщения.
Точный счёт провайдера не подменять расчётом из токенов.
Это разрешение уже использовано; дополнительных AI/STT вызовов с Mac
автоматически не делать.

## Ручная проверка и отчёт

Без платных вызовов: Login, история, черновик/назад/повторный вход,
маленький txt и его повторное открытие, перезапуск, плохая сеть.
Для AI/STT — отдельное действие и разрешение владельца.
Диктовка: настоящий meter, stop/cancel, текст правится и не автоотправляется.
Orb/«…» неактивны; Camera/Photos не выдавать за готовые.

Вернуть ветку/HEAD, версии окружения, полный passed/failed/skipped,
verify-xcresult, LIVE_DEV build и bundle ID, крупный снимок реального
чата, реально проверенное против сервера и непроверенное.
Без секретов/личной переписки. Итог — Dev readiness, не релиз.
