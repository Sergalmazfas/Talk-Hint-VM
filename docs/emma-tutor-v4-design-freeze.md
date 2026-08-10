# Emma Tutor v4 — FINAL Design Package (Design Freeze)

**Статус: NEEDS USER REVIEW** (после подтверждения → APPROVED FOR IMPLEMENTATION одной задачей «Implement approved Emma Tutor v4 Final Design exactly as frozen»).
**Production code НЕ менялся** (`server/tutorAvatarPage.ts`, `tutorPttMachine`, Tutor Engine, WebSocket, iOS, Call Memory, API — не тронуты). Все макеты — sandbox `artifacts/mockup-sandbox/src/components/mockups/tutor-v4/`.

## A. Итоговый каталог экранов (Canvas, 390×844)
Единственный экран продукта — **Main Conversation Screen** (fullscreen-режим удалён из v1, кнопки Expand нет).
Ряд 1 (y≈2160): референс Praktika · 01 Ready · 06 Short dialog · 09 Translation expanded · 02 Recording · 04 Thinking · 05 Speaking · 07 Long dialog · утверждённое кадрирование (half-body).
Ряд 2-3 (y≈3160+): 03 User turn committed · 08 Translation loading · 10 Hint loading · 11 Hint ready · 12 Text input · 13 Attachment menu · 14 Attachment in conversation · 15 Error/retry · 16 End-session confirmation · 17 Call Memory pending · 18 Call Memory review · 19 Call Memory confirmed / REAL_CALL_READY · EN-chrome (Ready).

## B. Матрица состояний
| Состояние | Микрофон | Статус-лейбл (ru) | Особенности |
|---|---|---|---|
| LOADING | disabled | «Загрузка…» | скелетон/спиннер, дизайн = Thinking-нейтраль |
| READY | violet 70px | «Удерживайте и говорите» | hint chip активен |
| RECORDING | красный + 2 пульс-кольца | «Слушаю…» | partial transcript: полупрозрачный violet 55% + italic |
| TRANSCRIBING → committed | disabled | «Распознано» | финальный транскрипт — обычный сплошной violet пузырь |
| THINKING | disabled серый | «Emma думает…» | 3 анимированные точки в пузыре |
| SPEAKING | disabled (barge-in нет в v1) | «Emma говорит…» | эквалайзер на карточке; стриминговый пузырь с курсором ЗАКРЕПЛЁН внизу ленты, авто-скролл без прыжков, история видна выше |
| ERROR | READY | «Ошибка» | локальный баннер «Что-то пошло не так» + Retry (RotateCcw), история сохранена |
| SESSION_ENDING | скрыт | — | шит подтверждения выхода |
| CALL_MEMORY_PENDING | скрыт | — | карточка «Готовлю память разговора…» + спиннер |
| MEMORY_CONFIRMATION | скрыт | — | review-шит: факты ПРЕДЛОЖЕНЫ, требуют подтверждения |
Одно состояние в один момент, без комбинированных статусов.

## C. Инвентарь компонентов
Всё в `_shared/TutorScreen.tsx` (+ `_group.css` keyframes): IconButton · AvatarCard (260px r28, emma-half.png, градиент, mute; БЕЗ Expand) · ChatBubble (emma/user/pending/committed, inline-перевод) · ActionRow (Повторить/Перевод/Копировать) · HintChip (off/loading) · HintCard (лиловая пунктирная карточка: EN-фраза + перевод + dismiss) · StatusLabel · MicButton (ready/recording+кольца/disabled) · ReturnToLatest (violet ArrowDown FAB) · TextComposer (+мок системной клавиатуры) · AttachSheet · AttachmentBubble (thumbnail + микрокопия «временное вложение») · ExitSheet · MemoryPendingCard · MemoryReviewSheet (факты + Pencil/Trash2 + Подтвердить/Изменить) · MemoryConfirmedCard. Иконки — только lucide, единый stroke.

## D. Interaction Flow
Ready → (hold mic) Recording → (release) committed user turn → Thinking → Speaking (стрим) → Ready. Параллельно: Translate (инлайн в том же пузыре: collapsed→loading→expanded→повторный тап сворачивает; ошибка — локально в пузыре), Replay (повтор аудио того же ответа), Hint (chip→loading→HintCard; подсказка — предлагаемый ОТВЕТ ПОЛЬЗОВАТЕЛЯ, не отправляется автоматически, можно скрыть), Keyboard→TextComposer (текстовый ход = обычный user turn той же сессии), Paperclip→AttachSheet (Сделать фото / Медиатека / Файл / Отмена) → вложение в ленте + ответ Emma. X → ExitSheet (Продолжить/Завершить + предупреждение о памяти) → MemoryPending → MemoryReview → Confirm → REAL_CALL_READY. Emma по дизайну ведёт диалог дальше (реакция + вопрос) — это ОДИН ход Lesson Agent, без второго LLM-запроса.

## E. Локализация
`ui_locale` (язык интерфейса) ≠ `language.target` (изучаемый) ≠ `language.native` (переводы). Пример ru/en/ru: хром русский, урок английский, переводы русские. Смешение языков в хроме запрещено; спроектированы RU- и EN-варианты хрома (фрейм EN-chrome). Багфикс к реализации: русская строка `translateFailed` в EN-словаре.

## F. Скролл-поведение ленты
Карточка Emma закреплена сверху (260px во ВСЕХ состояниях — компактификация отклонена). Лента — вертикальный скролл под ней; новое сообщение входит снизу, старые уходят вверх; во время речи Emma стриминговый пузырь остаётся в фокусе с естественным авто-скроллом, без прыжков и без скрытия истории. При скролле вверх появляется FAB «к последнему» (violet ArrowDown над доком), тап плавно возвращает вниз. Док не перекрывает последнее сообщение (нижний inset).

## G. Перевод / H. Подсказка / I. Вложения
G: без попапов и дублей — карточка сообщения расширяется вертикально (EN → divider → RU), перевод вторичен, загрузка локальна, повторный тап сворачивает; состояние ошибки перевода локально.
H: подсказка не блокирует UI (mic доступен), результат — отдельная лиловая карточка с EN-фразой + родным переводом, визуально отлична от сообщений, есть dismiss. Backend подсказок в этой задаче не проектировался.
I: шит открывается от скрепки поверх дока, не разрушает чат, закрывается естественно. Вложения ЭФЕМЕРНЫ: контекст сессии/хода, не Student Memory, не Call Memory, не БД; персистентными могут стать только подтверждённые пользователем производные факты.

## J. Допущения по анимации 3D Emma
Idle: дыхание/микродвижения тела, моргание, малые повороты головы, живая мимика. Speaking: lip-sync + мимика. Приветствие: один короткий wave в начале сессии, затем нейтральный разговорный idle. Редкие естественные кивки/жесты — НЕ постоянная жестикуляция. Никаких «письменных» анимаций. На макетах 3D-модель заменена изображением (headless-рендер WebGL недоступен).

## K. Дельта реализации от текущего production Tutor UI
1. Перекадровка камеры TalkingHead (half-body, лицо в верхней трети) + фон-сцена с blur вместо плоского #dfe3ee. 2. Удаление Fullscreen/Expand и его логики. 3. Lucide-SVG иконки вместо всех эмодзи (вкл. перевод). 4. Рестайл: карточка 260px, пузыри/типографика/цвета по спеке, док (70px mic + 48px кнопки). 5. Состояние committed-транскрипта. 6. FAB «к последнему» + авто-скролл стрима. 7. HintCard-поток (UI). 8. Текстовый композер (UI; ходы в ту же сессию). 9. Шит вложений + вложение в ленте (UI, эфемерность). 10. Рестайл exit-шита и Call Memory экранов под v4. 11. Анимации состояний (кольца, точки, эквалайзер) + idle/wave поведение аватара. 12. Локализация: чистые RU/EN-хромы, фикс translateFailed.

## L. Отложено (не в v1)
Fullscreen-режим (удалён) · barge-in во время речи Emma · backend подсказок/текста/вложений (в этой задаче — только UI) · смена тьютора · управление камерой · субтитры fullscreen · долгосрочное хранение вложений.
