# TalkHint Tutor — Current UX Reference (for Tutor Engine Workbench)

Дата снимка: 2026-08-13. Основа: фактический код после задач #163 (Compact Talking Tutor UI) и #166 (выравнивание по Tutor Engine Public Contract v1).

Назначение: reference для AI Tutor Engine при создании собственного Tutor Workbench Beta. Engine реализует свой интерфейс самостоятельно — этот документ описывает утверждённый flow и события, **не** предлагает переносить код TalkHint.

Скриншоты: `docs/tutor-ux-screens/*.jpg` — сняты через dev-превью `/tutor/preview` (тот же production-HTML `TUTOR_AVATAR_PAGE_HTML`, движок застаблен реальными формами tutor-realtime/1.0). Ограничения headless-съёмки: нет WebGL, поэтому круг аватара пуст (на устройстве там живой 3D-аватар TalkingHead); вьюпорт 1280×720, а не iPhone — верстка та же одностраничная responsive.

---

## A. Tutor Selection (выбор преподавателя)

**Точка входа.** iOS-приложение открывает WKWebView с Express-страницей `GET /tutor` (`ios/TalkHint/UI/TutorViewController.swift`, `server/tutorRoutes.ts:69-74`, HTML в `server/tutorAvatarPage.ts`). Auth: страница загружается БЕЗ токена в URL; она посылает нативу bridge-сообщение `needAuth` (без payload), и iOS отвечает вызовом `window.__setAuth(...)` (`TutorViewController.swift:50-92`) — токен никогда не попадает в URL/историю. (Разбор `#auth=` в странице существует только для dev-превью/legacy, это не продакшн-путь.) Обратная связь с нативом — `window.webkit.messageHandlers.tutor`. Отдельного нативного экрана выбора нет — всё внутри одной web-страницы.

**Экран выбора = стартовый bottom-sheet** `#startSheet` «Как хотите практиковаться?» (скриншот 01):
- ряд карточек-«чипов» преподавателей `#tutorRow` (`.tutorChip`: круглое превью + имя);
- кнопки «Свободная практика» (free talk) и «Симуляция звонка» (goal-driven simulation).

**Откуда список tutors.** Клиент НЕ ходит в Engine напрямую. Он вызывает `GET /api/tutor/tutors` (Bearer), сервер проксирует Engine `GET /api/v1/tutors` (ключ только на бэкенде) и нормализует каталог (`server/tutorRoutes.ts:92-103`, `server/tutorEngine.ts:125-153`).

**Используемые поля каталога** (raw → client): `tutor_id`→`tutorId`; `display_name`|`name`→`name`; `preview_url`|`avatar.preview_url`→`previewUrl`; `avatar.glb_url`|`glb_url`→`glbUrl`; `avatar.body`→`body`; `asset_version`|`avatar.asset_version`→`assetVersion`. Относительные URL достраиваются до базы Engine. Каталог динамический — ids не хардкодятся.

**Сохранение выбора.** Клик по чипу пишет `localStorage.tutorId`, сразу подменяет имя во всех строках UI (функция `tn()`: «Emma» → имя выбранного tutor) и префетчит GLB. Fallback: `defaultTutorId` от сервера, иначе первый в каталоге.

**Как tutor_id попадает в session.** `GET /api/tutor/status?tutorId=...` валидирует выбор по живому каталогу; при создании сессии сервер передаёт `tutor_id` в Engine `POST /api/v1/sessions`.

**GLB-аватар.** Загружается с Engine, кэшируется через браузерный Cache API с ключом `tutor_id + asset_version`; рендерится библиотекой TalkingHead (three.js) в круглом аватаре 80px; липсинк — `head.speakAudio()` (тайминги см. раздел B).

**Состояния.** loading/connecting, ready; пустой каталог и ошибка загрузки каталога просто скрывают ряд чипов (отдельного error-состояния каталога НЕТ). Экрана «страница выбора tutor» как отдельного шага НЕТ — выбор встроен в стартовый шит.

NOT IMPLEMENTED: отдельный полноэкранный «change-tutor picker» во время сессии.

## B. Main Tutor Workspace (живой экран, задача #163)

Скриншоты 02 (correction + teaching hint), 03 (длинный диалог), 04 (перевод), 08 (меню настроек).

Один fullscreen-экран (`server/tutorAvatarPage.ts`):
- **Header**: X (выход) слева; по центру круглый живой аватар 80px + имя («Репетитор Emma»); статус-pill; шестерёнка настроек справа.
- **Статус-pill**: READY→`LIVE`, RECORDING→`Listening`, PROCESSING→`Thinking`, SPEAKING→`Speaking`. Управляется локальной PTT-машиной; `session.ready` → READY, входящее аудио → SPEAKING, `turn.completed` → возврат.
- **Чат**: пузыри пользователя (фиолетовые справа) и tutor (серые слева) с action-строкой «Повторить / Перевод / Копировать»; автоскролл с FAB «к последнему», если пользователь отскроллил.
- **Карточка «КАК СКАЗАТЬ ЛУЧШЕ»** (correction): better-фраза, зачёркнутое user_said, объяснение + перевод.
- **Карточка «ПОДСКАЗКА УЧИТЕЛЯ»** (teaching hint, `tutor.hint`) — отдельная закрываемая карточка, появилась в #166; никогда не путается с suggested reply.
- **«Что сказать?»** (`#hintChip`): показывает текущий suggested reply от Engine; если его нет — честно «недоступно». Никакой локальной генерации.
- **Микрофон**: 70px hold-to-talk (pointerdown/up); PCM16 mono 24 kHz; первый чанк лениво шлёт `turn.start`, затем `audio.chunk {format:"pcm16", sample_rate:24000, size}` + бинарный кадр, отпускание — `audio.end`.
- **Клавиатура/композер и скрепка (attachment)**: кнопки есть, но текстовые/файловые ходы — «Coming soon — needs engine support». NOT IMPLEMENTED (ждут поддержки Engine).
- **Настройки** (шестерёнка): «Звук Emma Вкл/Выкл», «Завершить практику». Никакого settings-API Engine.
- **TTS и липсинк**: `tutor.audio.chunk` (JSON-дескриптор с `subtitle` + бинарный mp3) → decode → TalkingHead `speakAudio`. Word-тайминги Engine НЕ присылает в audio.chunk; контрактное событие `avatar.lipsync` (отдельная timeline, по контракту предшествует своему audio chunk) страницей НЕ обрабатывается. Вместо этого страница РАВНОМЕРНО распределяет слова subtitle по реальной длительности декодированного аудио (`deriveTimings`, `tutorAvatarPage.ts:709-741`) — аппроксимация, а не настоящие viseme-тайминги. «Повторить» переигрывает аудио Engine.

### Карта UI-элемент → событие Engine → файл

| UI элемент | Источник / событие | Файл |
|---|---|---|
| Статус-pill LIVE/Listening/Thinking/Speaking | локальная PTT-машина; `session.ready`, входящее аудио, `turn.completed` | `tutorAvatarPage.ts` (~:465-512), `tutorPttMachine` |
| Пузырь пользователя | `speech.partial` → pending, `speech.final` → финал, `transcript.normalized` привязка | `tutorAvatarPage.ts:1061-1079` |
| Пузырь tutor (стрим) | `tutor.text.delta` (накопление) + `tutor.text.final` (авторитетный, в тот же пузырь) | `tutorAvatarPage.ts:1080,1119-1127`, классификатор `tutorRealtimeUi.ts` |
| Карточка suggested reply / «Что сказать?» | `tutor.suggested_reply {text, translation\|null, carryover}` | `tutorRealtimeUi.ts:49-64`, `tutorAvatarPage.ts:515-528,~830` |
| Карточка «Подсказка учителя» | `tutor.hint {hint, mode}` → `showTeachingHintCard` | `tutorRealtimeUi.ts:65-70`, `tutorAvatarPage.ts:1117,~841` |
| Карточка «Как сказать лучше» | `tutor.correction {correction:{user_said, better, explanation, translation, category}}` | `tutorRealtimeUi.ts:72-83`, `showCorrectionCard` |
| Голос + липсинк аватара | `tutor.audio.chunk` (mp3 + subtitle; тайминги деривируются из subtitle, `avatar.lipsync` не используется) → TalkingHead `speakAudio` | `tutorAvatarPage.ts:709-749,1025-1052` |
| Индикатор «Thinking» текста | `turn.state` (THINKING/TRANSCRIBING label) | `tutorAvatarPage.ts:1105-1118` |
| Микрофон → Engine | исходящие `turn.start`, `audio.chunk`, `audio.end` | `tutorAvatarPage.ts:1151-1185` |
| Открывающий ход tutor | `turn.started {opening:true}` (гейт микрофона до конца opening) | `tutorRealtimeUi.ts:88-96` |

Неизвестные события игнорируются безопасно; кадры без обязательных полей контракта отбрасываются (fail-closed, #166).

NOT IMPLEMENTED: обработка события `avatar.lipsync` (липсинк аппроксимируется из subtitle аудио-чанка, см. выше); входящее `playback.started` (старт плейбека меряется локально); текстовые/файловые ходы; suggestions-UI кроме описанных карточек; камера.

## C. End of Conversation / Results / Call Memory

Скриншоты 09 (выход), 05 (подготовка памяти), 06 (проверка), 07 (подтверждено).

1. **Завершение**: X → quit-sheet «Завершить практику?» («Продолжить практику» / «Завершить»), либо «Завершить практику» в меню настроек.
2. **Backend**: TalkHint вызывает Engine `POST /api/v1/sessions/:id/complete`; сессия завершается. Затем `POST /api/v1/sessions/:id/call-memory` и поллинг `GET .../call-memory` (до ~20 с, backoff). 409 `NO_COMPLETED_TURNS` → сообщение «памяти нет». TalkHint сам транскрипт НЕ суммаризирует.
3. **Экран «Готовлю память разговора…»** (pending) → полноэкранная **проверка Call Memory** (review): редактируемые поля Цель / Факты / Вопросы / Отрепетированные ответы / Словарь / Непроверенные факты.
4. **Подтверждение обязательно**: «Сохранить и подтвердить» → `PATCH /api/tutor/memories/:id` + `POST /api/tutor/memories/:id/confirm` → статус `REAL_CALL_READY` → экран «Память подтверждена / Готово к реальному звонку»; натив получает `callMemoryConfirmed`. Это ЕДИНСТВЕННЫЙ путь в REAL_CALL_READY.
5. **Хранение**: таблицы `tutor_sessions` и `tutor_call_memories` (`shared/schema.ts:330-397`), жизненный цикл MEMORY_CONFIRMATION → REAL_CALL_READY → COMPLETED; сохраняются также engine `group_id`/version.
6. **Использование дальше**:
   - Симуляция: подтверждённые памяти (только REAL_CALL_READY с group/version) выбираются в шите «Симуляция звонка»; контекст передаётся Engine по ссылке (group_id), не инлайном.
   - Реальный звонок: одна REAL_CALL_READY-память атомарно «забирается» при звонке (`server/websocket.ts:2138-2150`), её содержимое попадает в контекст live-подсказок, статус становится COMPLETED (одноразовое использование).

NOT IMPLEMENTED: Session Result / Summary экран — Engine-эндпоинты `GET /v1/sessions/:id/result|summary` существуют в контракте, но TalkHint их не вызывает и такого экрана нет. Engine-сторонние confirm/correction/handoff API для call-memory — только spec, не используются. Отдельного экрана «память готова к звонку» нет — только confirmed-состояние + событие нативу.

## D. Screen Flow Diagram (фактический)

```
Открыть /tutor (WKWebView)
  └─ Стартовый шит «Как хотите практиковаться?»
       ├─ карточки tutors (выбор = localStorage + tn() + GLB prefetch)
       ├─ «Свободная практика» ──────────────┐
       └─ «Симуляция звонка» → шит цели/ролей │
            (+ выбор подтверждённой памяти)   │
                                              ▼
              Live Tutor Workspace (opening turn от tutor,
              PTT-микрофон, чат, corrections, teaching hints,
              suggested reply / «Что сказать?»)
                                              │  X → quit-sheet «Завершить?»
                                              ▼
              «Готовлю память разговора…» (pending)
                                              ▼
              Проверка Call Memory (редактирование)
                                              ▼  «Сохранить и подтвердить»
              «Память подтверждена — готово к реальному звонку»
                                              ▼
              Один следующий реальный звонок использует память (одноразово)
```

Отличия от идеализированной схемы «Choose Tutor → Prepare/Goal → …»: выбор tutor и выбор режима — один экран (стартовый шит); «Prepare/Goal» существует только для симуляции; Summary-экрана нет — после завершения сразу Call Memory review.

## E. UI → Engine API/Event Mapping (сводно)

REST (всегда через TalkHint-бэкенд, ключ только на сервере):
- `GET /api/v1/tutors` — каталог для стартового шита.
- `GET /api/v1/capabilities` — handshake версии контракта (v1, tutor-realtime/1.0).
- `POST /api/v1/sessions` — создание (practice | simulation с goal/roles/context-by-reference, `tutor_id`). Не идемпотентно — без авторетраев; simulation fail-closed (echo проверяется).
- `POST /api/v1/sessions/:id/complete` — завершение.
- `POST` + `GET /api/v1/sessions/:id/call-memory` — генерация и поллинг памяти.

Realtime (WS, клиент→сервер): `auth`, `turn.start`, `audio.chunk`, `audio.end` (используются); `playback.started`, `turn.cancel`, `session.end` — в контракте есть, страницей НЕ отправляются.
Сервер→клиент (потребляемые): `session.ready`, `turn.started`, `turn.state`, `speech.started/partial/final`, `transcript.raw/normalized`, `tutor.text.delta/final`, `tutor.audio.chunk`, `tutor.suggested_reply`, `tutor.hint`, `tutor.correction`, `turn.completed`, ошибки/close-коды. Детали — `docs/tutor-engine-consumer-contract.md` и `docs/tutor-engine-public-contract-v1.md`.

## F. Screenshots

| Файл | Экран |
|---|---|
| `tutor-ux-screens/01-start-sheet.jpg` | Стартовый шит: выбор режима (+ ряд tutors при живом каталоге) |
| `tutor-ux-screens/02-hint-correction.jpg` | Live: correction «Как сказать лучше» + «Подсказка учителя» + «Что сказать?» |
| `tutor-ux-screens/03-dialog-long.jpg` | Live: длинный диалог, стриминг текста tutor |
| `tutor-ux-screens/04-translate.jpg` | Live: приветствие TalkHint, action-строки Повторить/Перевод/Копировать |
| `tutor-ux-screens/05-memory-pending.jpg` | «Готовлю память разговора…» |
| `tutor-ux-screens/06-memory-review.jpg` | Проверка Call Memory (редактируемые поля) |
| `tutor-ux-screens/07-memory-confirmed.jpg` | «Память подтверждена — готово к реальному звонку» |
| `tutor-ux-screens/08-settings-menu.jpg` | Меню настроек (Звук, Завершить практику) |
| `tutor-ux-screens/09-quit-sheet.jpg` | Quit-sheet «Завершить практику?» |

В headless-съёмке аватар-круг пуст (нет WebGL) и в стабе каталог tutors пуст — на устройстве в шите виден ряд чипов, а в круге живой 3D-аватар.

## G. Реализовано / NOT IMPLEMENTED

Реализовано: динамический каталог tutors + выбор в стартовом шите; free practice и goal-driven simulation (context by reference); живой 3D-аватар с TTS и липсинком; PTT-микрофон PCM16/24kHz; стриминговый чат; corrections; teaching hints (`tutor.hint`); suggested reply + перевод («Что сказать?»); переводы реплик; quit-flow; Call Memory: генерация → проверка/редактирование → подтверждение → одноразовое использование в реальном звонке; fail-closed валидация всех событий контракта v1.

NOT IMPLEMENTED (в контракте/споке есть, в TalkHint нет): Session Result/Summary экран; `playback.started`, `turn.cancel`, `session.end` (клиентские сообщения); `avatar.lipsync` как событие; текстовый композер и attachments как ходы Engine; change-tutor во время сессии; камера; Engine-сторонние confirm/correction/handoff API call-memory; отдельный error-UI пустого каталога tutors.
