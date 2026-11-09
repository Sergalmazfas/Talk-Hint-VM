# Принят Mac-пакет AppDev

Владелец передал TalkHint_AppDev_85ec300_for_Replit_2026-11-09.zip с патчами,
REPORT, build/gate logs, xcresult и шестью PNG. CRC/path checks пройдены.

Mac HEAD 85ec300: 261 passed / 0 failed / 0 skipped, verify-xcresult PASS,
35 Chat-тестов. AppDev BUILD SUCCEEDED. Снимки показывают Chat в центральной
вкладке, fullscreen без нижней панели и сохранённый после relaunch черновик.
Google/back/relaunch проверены Claude. AI/STT/звонков не было.

Mac Google-патч 5793bb0 совпадает всеми восемью конечными blob hashes с уже
доставленным 15a5821, повторно не применялся.
Точно перенесён недостающий fb97108: только wait helper в
ChatApprovedScreenTests.swift; конечный blob 3727717*, deadline/assertions
сохранены. Исходное авторство содержится в предоставленном владельцем патче.
Replit не запускал Xcode; полученные Mac-логи не выданы за новый местный gate.

## Не скрывать ограничения

- 82 прежних build warnings и 13 Unbalanced calls не исправлены.
- Unsigned Simulator build не сохранял Keychain (securityd -34018). В Mac
  исправлено ad-hoc подписью с entitlements без изменения кода/Team/certificates.
- Ошибка Keychain пока игнорируется SessionStore.save. AppDev при неуспешном
  сохранении может показать shell и упасть при открытии Chat. Отдельный дефект,
  не исправлен этим переносом. Не объявлять готовность к релизу.
- Запуск AppDev только через Xcode Run с Dev-origin из схемы. Запуск значком
  без env падает fail-closed; production fallback не добавлять.
- Остальные вкладки/Settings, маленькая программная клавиатура, плохая сеть,
  txt и реальный iPhone в этой AppDev не проверены. Push/телефония не включены.
- Не повторять прежний gate, если проверяемый код/состав не менялся.
  Никаких Publish/Archive/TestFlight/платных запусков без разрешения владельца.

Proposed-урок проверяющему: BUILD SUCCEEDED не доказывает Keychain-login.
Проверять entitlements и сессию после relaunch; различать сбой credentials,
отсутствующий launch environment и ошибку сервера. Не принимать автоматически.
