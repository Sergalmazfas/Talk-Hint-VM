# Проверка полученного Mac-пакета полного AppDev

Пакет владельца: `TalkHint_AppDev_85ec300_for_Replit_2026-11-09_1794207560848.zip`.
CRC проверен, небезопасных путей и symlink нет. Содержит исходные патчи,
REPORT, предупреждения, gate/build logs, xcresult и шесть PNG Simulator.
Архив сохранён в attached_assets, не распакован поверх исходников.

## Подтверждено материалами

- Mac HEAD 85ec300: 261 passed, 0 failed, 0 skipped, verify-xcresult PASS.
  В validate-native-full.log и tests.log итог совпадает; включая 35 Chat-тестов.
- AppDev BUILD SUCCEEDED, отдельный bundle app.talkhint.chatdev,
  конфигурация AppDev, флаги LIVE_DEV + APP_DEV, одна URL scheme talkhint-chatdev.
- На просмотренных PNG: номеронабиратель с Chat в центре вместо Copilot;
  открытый Chat без нижней панели; черновик после перезапуска сохранён.
- Реальный Google/Replit-вход, back и relaunch подтверждены отчётом Claude.
  Снимки не доказывают AI/STT; сообщения не отправлялись.
- 82 прежних предупреждения, 0 новых по сравнению Claude; 13 сообщений
  Unbalanced calls в native gate. Не устранены.

## Аддитивный перенос

Google-патч Mac 5793bb0 поблочно соответствует уже доставленному 15a5821:
все восемь конечных blob hashes совпадают с исходным GitHub-коммитом.
Повторно не применять.

Новый для Replit патч fb97108 меняет только
ios/TalkHintTests/ChatApprovedScreenTests.swift: проверяет готовность fixture
после пробуждения перед проверкой deadline. Deadline 3 секунды и assertions
сохранены. Перенесён буквально, итоговый Git blob должен начинаться на 3727717.
Авторство исходного Mac-патча сохранено в архиве; это не новая правка продукта.

Это не повторный native gate в Replit: Xcode/macOS здесь недоступны.
Предыдущая AppDev-доставка плюс точный Mac test patch соответствует описанной
Claude дельте Mac; неизвестных дополнительных изменений не реконструировали.

## Важные ограничения из REPORT

1. Unsigned Simulator build (CODE_SIGNING_ALLOWED=NO) не мог сохранять Keychain:
   Securityd -34018. После ad-hoc подписи Simulator и сохранения штатных
   entitlements вход/перезапуск заработали. Сертификаты и Apple Team не менялись.
2. SessionStore.save игнорирует ошибку Keychain, а AppDev показывает shell
   без повторной проверки сессии: при сбое сохранения на Chat возможен crash.
   Это открытый дефект обработки ошибки, в этом переносе не исправлялся.
3. AppDev требует TALKHINT_API_BASE_URL из схемы. Запуск значком без Xcode/env
   падает fail-closed, не переключается на production. Пока запускать Run
   из схемы TalkHintAppDev, а не значком.
4. Остальные вкладки/Settings, программная клавиатура на маленьком экране,
   плохая сеть, txt и iPhone в этом AppDev не проверены. AI/STT/звонки/push
   намеренно не запускались. Не объявлять приложение готовым к выпуску.

Телефонию, настройки аудио, модели, production, APNs и paid flows не меняли.
Предупреждения требуют отдельного разбора, не «лечить» их вслепую аннотациями.

## Proposed-урок проверяющему

Было: успешная unsigned Simulator build не гарантировала Keychain-login.
Узнали: проверять нужно не только BUILD SUCCEEDED, но сохранение токена с
правильными entitlements и запуск в нужном configuration/environment.
Действовать: подтверждать вход после relaunch, различать потерю Keychain,
потерю launch environment и ошибки сервера. Статус proposed, не принят.
