---
name: LIVE Ears & Brain Benchmark bench
description: Durable rules for benchmark work — isolation from production telephony, fail-closed availability, PII policy
---

- The benchmark is a separate admin-only layer that must never import from or alter the production call path; the only allowed touch is the opt-in dual-channel recording toggle (env-gated, default OFF).
- **Why:** hard user constraint — production telephony must not change; no auto-switching of models based on benchmark results.
- Availability is fail-closed: a candidate is benchmarked only after a REAL API probe succeeds; unavailable candidates are reported UNAVAILABLE with the raw error — never silently substituted.
- **PII policy:** benchmark fixtures must be fully de-identified (synthetic names, SSN, DOB, call ids); never commit verbatim production transcripts. A committed real transcript was rejected in code review once already.
- Streaming LLM timeouts must cover the entire SSE body read, not just headers; every per-turn interaction is try/caught so one failed turn never blocks the next (continuity invariant).
- Benchmark tables are self-provisioned with idempotent CREATE TABLE IF NOT EXISTS at request time because the Reserved-VM deploy runs no drizzle migrations.
- API reality (Aug 2026): OpenAI realtime transcription is provisioned via POST /v1/realtime/client_secrets (older transcription_sessions endpoint 404s); semantic_vad accepted.
- Diagnostic recording (per-user capability, not admin role): capability check in the Twilio webhook path is hard-deadlined + cached and fails closed to "don't record"; never let recording bookkeeping block TwiML.
- Twilio recording fetch/delete must go only to a canonical api.twilio.com Recordings URL for OUR account (built from a validated RecordingSid, redirects rejected) — a stored URL fetched blindly with Basic auth is an SSRF/credential-exfil hole.
- Real-call fixtures keep ORIGINAL telephone quality: dual-channel 8kHz WAV split per channel (de-interleave + PCM16→μ-law only), no enhancement/resampling — non-8kHz audio is rejected honestly. Each channel is scored against the reference turns of ITS role (channelRoles editable, default ch0=owner).
- Owner-first reporting: EARS report must give two separate conclusions — Best STT for Owner speech (headline; accented, short, imperfect speech) and Best for Guest/overall; batch is an accuracy ceiling and never a LIVE winner; nothing auto-changes production.
- Deepgram Flux TurnInfo carries CUMULATIVE turn transcript on every Update — collect finals only on EndOfTurn or WER explodes ~10x from duplication.
- When a candidate's turn detection collapses (finals < half of ref turns), score the channel as document-level WER with an explicit note — per-turn greedy alignment otherwise produces absurd 1000%+ WER.
- OpenAI GA realtime (2026): no `OpenAI-Beta: realtime=v1` header (beta_api_shape_disabled); under server/semantic VAD never send manual input_audio_buffer.commit (commit_empty, which must also be non-fatal) — append a silence tail instead.
- Long real calls: stream guard timeouts must scale with (audio duration / accel) + flush window, or multi-minute calls time out mid-stream at the fixed 60s guard.
- Production transcript is never reference ground truth — fixtures import it as a draft tagged needs-reference-review; the admin listens and edits via the reference editor (each save appends a ref-v<ts> tag).

## Новый полигон: граница владельца

Новый экспериментальный полигон Hint должен быть отдельным от прежнего стенда.
Не переделывать старый стенд и не менять рабочий Hint под видом лабораторной работы.
Сначала честная базовая линия текущей живой связки; другие архитектуры — после
независимой проверки метода. Попадание отдельной задержки в ожидаемый диапазон
не является приёмкой всей базовой линии.

**Why:** владелец отдельно потребовал новый полигон рядом со старым и запретил
перенос экспериментального промпта в рабочий продукт без своего «да».

**How to apply:** сохранять изоляцию и точные версии метода; неполный live-контекст,
неподтверждённые физические тайминги и недействительные попытки показывать явно.
Нельзя ослаблять проверку VAD/окон или исключать расходы, чтобы получить красивую таблицу.

Доступность model ID через каталог не доказывает совместимость платного endpoint
и его параметров. До длинного корпуса нужен короткий отдельный контрольный запрос
без данных звонка; сохранять HTTP, request-id и очищенную ошибку.

**Why:** каталог модели отвечал успешно, а реальный запрос судьи был отклонён
из-за несовместимой формы запроса. Один успешный GET не проверяет POST.

**How to apply:** проверять новый adapter/формат ответа до длинного опыта,
учитывать диагностику в том же бюджете и не повторять unknown-payload.

Успешный короткий синтетический ответ native API подтверждает только соединение
и этот контрольный запрос, а не прохождение реального многорепликового звонка.

**Why:** синтетические контроли отвечали, но на реальном аудио обнаружились
несовместимость формата, незавершённые и прерванные ответы.

**How to apply:** отдельно проверять реальный многорепликовый replay; нельзя
выдавать контроль формата за успешную native-архитектуру или live-проверку.

При параллельном 1x-replay общие синхронные операции могут задержать сразу все
аудиочасы. Сбой этих часов — не измерение задержки модели.

**Why:** независимые аудиопотоки всё равно обслуживает общий event loop.

**How to apply:** тяжёлые сводки, тесты и архивы делать после остановки всех
аудиочасов; долговечность финансового учёта сохранять без синхронной блокировки
остальных потоков. Причину конкретной паузы без измерений не объявлять доказанной.

## Неоднозначность и порядок корпуса

Неоднозначная реплика исключается отдельно, остальные реплики звонка продолжают
обрабатываться. Звонок бракуется, только если неоднозначных реплик **больше 30%**.
Это послабление не превращает ошибки API и недостоверные аудиочасы в валидные данные.
Группа с сохранённой целью — основная; записи без цели — отдельная группа,
цель за них не придумывать. Допускается 4–6 одновременных записей, но каждая
подаётся 1x и имеет собственные часы; общая скорость процесса не заменяет 1x.

**Why:** владелец уточнил, что один плохой фрагмент не должен терять весь звонок,
но потребовал сохранить честность времени и разделение записей по наличию цели.

**How to apply:** показывать число исключённых реплик, недействительных звонков
и неповторённых unknown отдельно; не смешивать качество групп. После измерения
базы владелец разрешил продолжать лабораторные рецепты без дополнительных нажатий,
в пределах общего бюджета; это не разрешение переносить их в рабочий Hint.

Отсутствие подсказки — результат алгоритма, а не испорченное аудио.

**Why:** разрешённое воздержание карточного алгоритма нельзя исключать из оценки,
иначе из сравнения исчезают его пропуски.

**How to apply:** показывать покрытие всех пригодных реплик и передавать судье
также null-подсказки; нулевое покрытие само по себе не повод браковать запись.

Отсутствие alias в выгрузке общего прайса не доказывает отсутствие официального
тарифа: отдельно проверять каноническую карточку модели и условия кэширования.

**Why:** общий прайс не показывал Terra, но официальная карточка той же модели
содержала вход, cached input и выход; прежний вывод о неподтверждённом тарифе
оказался слишком широким. Затем отдельное руководство выявило платную запись
кэша: только трёх базовых ставок недостаточно для полного расчёта.

**How to apply:** сохранять источник и отделять подтверждённую ставку от
расчёта по usage и от фактического счёта провайдера; старые начисления не переписывать.

Скорость SSE среди успешных ответов не доказывает надёжность всего варианта.

**Why:** короткая панель прошла, а на расширенном корпусе появились известные,
оплаченные ответы с невалидным JSON. Требование JSON в промпте не равно API-схеме.

**How to apply:** вместе с задержкой показывать отказы формата и покрытие корпуса.
Известный отказ можно исключить из latency, но не из расходов или отчёта о надёжности.
Продолжение других, ещё не начатых записей не является разрешением повторять unknown.
