### Доказательства для независимого QA

### Граница текстового стенда быстрого диалога

Сокращение текста и меньшая задержка не дают права продвигать вариант, который
меняет говорящего, присваивает ему чужие факты или теряет цель.
Текстовый стенд отдельно от полного audio/STT/экранного прогона.

**Why:** короткий лабораторный вариант отвечал от лица организации вместо
владельца. Числа времени были лучше, но ответ был непригоден.

**How to apply:** сохранять speaker/goal-проверки и неизвестные; first delta
не считать готовой подсказкой, а word count — доказанным секундным чтением.

Материалы, прочитанные главным агентом, не считаются автоматически переданными
независимому text-only QA. Название скриншота или путь исходника — указатель,
не проверяемое содержимое.

**Why:** QA возвращала инженерные выводы, потому что в её снимке были только
ссылки на код и изображения, которые основной агент действительно видел.
Наличие источника у отправителя не означает доступ к нему у получателя.

**How to apply:** передавать ограниченные проверяемые выдержки с происхождением
и отдельно помечать внешние материалы. Не объявлять скриншот проверенным
text-only QA, пока нет подходящего фактически переданного входа; не заменять
отказ QA инженерной уверенностью и не запускать новый платный разбор молча.
---
name: Hint lab release and baseline
description: Owner-approved separation of direct Dev fixes, historical baselines and live laboratory activation.
---

Общее правило перенесено в `replit.md` v3 §4 и §7; история ниже сохранена.
Прежнее разрешение одного диагностического повтора ниже — историческое.
Решение владельца от 27.10.2026: **до 3 диагностических повторов на звонок,
только его звонки, по сохранённому снимку, с записью каждого в журнал**.

**Why:** владелец явно расширил разрешение при согласовании правил v3.

**How to apply:** не смешивать разрешение с фактическим исполнением. Эта
документальная правка не меняет счётчики/ограничения runtime и не запускает
разборы. Исходник и каждый повтор сохраняются раздельно; слепая повторная
отправка письма и новые звонки этим решением не разрешены.

Small, reversible Hint fixes may be prepared directly by the engineer without
waiting for CrewAI acceptance. Keep diffs and verification; owner still publishes
the server and builds/releases iOS.

**Why:** the owner explicitly approved fixing the unreadable choice cards and
missing action-result help while the lab rollout was still incomplete.

**How to apply:** no mandatory crew round-trip for obvious bounded fixes, but do
not equate a successful build or one control call with independent QA acceptance.
For this rollout, the owner requires the laboratory to start paused after Publish
until its readiness is checked. Historical manual baselines must be labelled as
manual, never forged into fresh-call provenance or automatic CrewAI execution.
Collapsing or hiding the Prepare opening is not evidence it was spoken.

Владелец согласовал сворачивание первой фразы в одну строку после первой
надёжно распознанной реплики владельца; касание разворачивает её обратно.
Это заменяет прежний вариант только ручного скрытия.
**Why:** владелец хочет освободить экран разговора, а не считать подсказку использованной по косвенному событию.
**How to apply:** автоматическое сворачивание — только состояние интерфейса; не засчитывать произнесение opening, использование или достижение цели.

An owner-authorized repeat of a saved live call is a separately versioned manual
trigger, even when it actually executes CrewAI. Preserve the failed original,
label both source and execution environments, and reserve the single pass before
the model request. A saved letter must not be described as sent.

**Why:** the owner allowed one diagnostic repeat of a failed live-call analysis;
that permission is not permission for automatic historical replays or blind mail
resubmission.

**How to apply:** use the existing private lab store for the separate result;
do not overwrite the production baseline or turn the manual result into evidence
that the production pipeline has been repaired.

Cross-environment manual reviews need a lifecycle distinct from native calls,
not just an enabled/disabled switch.

**Why:** native orphan cleanup can remove a diagnostic reservation while the
manually triggered analysis is still running, because its source call exists
only in the other environment. A missing reservation must never permit a second
paid pass.

**How to apply:** mark the manual review explicitly, exclude it from automatic
claim/recovery, retain the existing diagnostic TTLs, and verify the saved result
instead of trusting an UPDATE that affected zero rows. Never fabricate a Dev
phone call to satisfy the cleanup.

Malformed model categories are not the same as uncertain evidence.

**Why:** valid JSON can still violate the assessment rubric. Replacing a
rejected category with “unknown” would silently turn an invalid model response
into an apparently valid assessment and bypass the intended QA gate.

**How to apply:** keep strict category validation and separate deterministic
measurements from rejected AI judgments. Enforce the output contract rather
than relaxing the rubric; do not label a diagnostic retry as a production fix.

A framework's request for structured output does not guarantee that its final
artifact actually came from the structured provider response.

**Why:** the pinned framework can catch a failed structured synthesis and silently
return concatenated free text instead. Validating that text as JSON alone would
hide the failed structured-output path.

**How to apply:** verify both the wire contract and the final artifact provenance
with offline framework/SDK tests. Keep a failed native response failed; do not
introduce hidden model-based conversion or repair calls as a parser fix.

Native schema compliance is not evidence that the reviewer's objections are
correct.

**Why:** a correctly structured QA response can still invent a category rule
that contradicts the author's canonical rubric.

**How to apply:** give author and reviewer the same authoritative domain rubric,
not merely their separate output schemas. Preserve disputed QA feedback and keep
the result unaccepted; an engineer identifying one false objection does not
justify silently accepting the other disputed judgments.
