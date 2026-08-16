# Goal-Return Analysis — отчёт (offline, по записанным звонкам)
2026-08-16T07:59:28.269Z · анализ, НЕ изменение live-пайплайна

## Честные ограничения данных
- Цель звонка НЕ сохраняется на записи звонка в production — источник цели указан для каждого звонка (frozen fixture или задана оператором).
- Тексты доставленных подсказок НЕ сохраняются в production; счётчики sent/dropped взяты из hintLatency-метаданных, когда они есть.
- Разметка Owner-реплик — это анализ поведения Owner'а (goal-adherence), НЕ эффективность подсказок: обычная речь Owner'а неотличима от принятой подсказки, атрибуция невозможна.
- Оценка подсказок выполняется ТОЛЬКО там, где переданы явные записи подсказок; признак «произнесена» — нечёткое совпадение текста подсказки с Owner-репликой (порог 0.8), это эвристика, не доказательство использования.

## Mint Mobile — перенос номера на eSIM (CA4bd4d2eb…)
Цель: «Transfer existing Mint Mobile number to the eSIM on a new iPhone and activate service.» _(источник: frozen fixture 09e6bcce-3338-47b8-9136-1cc4ed24070c (dev benchmark_fixtures))_
Подсказки за звонок: hintLatency-метаданных нет — счётчики недоступны.
Судья: gpt-5.6-sol. Размечено 53/53 turn'ов.

| Метрика | Значение |
| --- | --- |
| % turn'ов на цели | 62.3% |
| % оправданных отступлений | 26.4% |
| % ухода от цели | 11.3% |
| Эпизодов отступления | 5 |
| …из них с возвратом к цели | 4/5 |
| Owner-реплик «возврат к цели» (поведение Owner'а, не атрибуция подсказкам) | 8 |
| Owner-реплик «поддержка нужной ветки» | 7 |
| Owner-реплик «уводит в сторону» | 1 |
| Owner-реплик нейтральных | 2 |

Эпизоды: turn 0–1 (justified_digression, вернулись); turn 17–19 (justified_digression, вернулись); turn 33–34 (justified_digression, вернулись); turn 36–36 (justified_digression, вернулись); turn 41–52 (mixed, НЕ вернулись)
Примеры плохих (Owner уводит от цели — поведение Owner'а):
- turn 46: «bill set. One questions. What is your name?» — Says the issue is settled but introduces an unnecessary question about the AI's name.
Резюме судьи: The call stays focused on moving the existing number to a replacement eSIM, including necessary clarification, app steps, waiting, and a security warning. The owner repeatedly advances or resumes that process. Routine greetings and closure are justified side branches. Asking the assistant's name and the optional survey are unrelated to the activation goal.
Оценка подсказок недоступна: тексты подсказок для этого звонка не сохранены и не переданы — метрики выше описывают только поведение Owner'а.

## Mint Mobile — активация eSIM (CAfeca42c3…)
Цель: «Activate eSIM on the new phone via Mint Mobile support» _(источник: frozen fixture 7e2ee9c7-413f-46ee-b77c-ca57f35f7122 (dev benchmark_fixtures))_
Подсказки за звонок: hintLatency-метаданных нет — счётчики недоступны.
Судья: gpt-5.6-sol. Размечено 22/22 turn'ов.

| Метрика | Значение |
| --- | --- |
| % turn'ов на цели | 81.8% |
| % оправданных отступлений | 18.2% |
| % ухода от цели | 0% |
| Эпизодов отступления | 2 |
| …из них с возвратом к цели | 1/2 |
| Owner-реплик «возврат к цели» (поведение Owner'а, не атрибуция подсказкам) | 0 |
| Owner-реплик «поддержка нужной ветки» | 0 |
| Owner-реплик «уводит в сторону» | 0 |
| Owner-реплик нейтральных | 7 |

Эпизоды: turn 0–1 (justified_digression, вернулись); turn 20–21 (justified_digression, НЕ вернулись)
Плохих Owner-реплик (уводящих от цели) судья не нашёл.
Резюме судьи: The call remains focused on activating a replacement eSIM through the Mint app. Greetings and the final clarification are necessary side branches. The owner's replies mostly confirm completion of activation steps; none clearly pulls the call away from the goal. Garbled turns are interpreted using the surrounding activation and billing context.
Оценка подсказок недоступна: тексты подсказок для этого звонка не сохранены и не переданы — метрики выше описывают только поведение Owner'а.

## Mint Mobile — продолжение переноса/активации (CA702a1511…)
Цель: «Transfer the existing Mint Mobile number to the eSIM on the new iPhone and complete activation.» _(источник: operator-supplied (goal not persisted on the call; inferred from call context by the analyst))_
Подсказки за звонок (hintLatency): отправлено 16, отброшено 5 (текстов в метаданных нет).
Судья: gpt-5.6-sol. Размечено 34/34 turn'ов.

| Метрика | Значение |
| --- | --- |
| % turn'ов на цели | 52.9% |
| % оправданных отступлений | 47.1% |
| % ухода от цели | 0% |
| Эпизодов отступления | 5 |
| …из них с возвратом к цели | 4/5 |
| Owner-реплик «возврат к цели» (поведение Owner'а, не атрибуция подсказкам) | 3 |
| Owner-реплик «поддержка нужной ветки» | 3 |
| Owner-реплик «уводит в сторону» | 0 |
| Owner-реплик нейтральных | 7 |

Эпизоды: turn 0–1 (justified_digression, вернулись); turn 3–4 (justified_digression, вернулись); turn 16–21 (justified_digression, вернулись); turn 25–25 (justified_digression, вернулись); turn 29–33 (justified_digression, НЕ вернулись)
Плохих Owner-реплик (уводящих от цели) судья не нашёл.
Резюме судьи: The call stays focused on transferring and activating the existing number on the new iPhone eSIM. Compatibility checks, processing delay, email lookup, understanding checks, and closing are necessary side branches. The owner answers prerequisites, asks for next steps, and returns to activation/testing without any unnecessary drift.
Оценка подсказок недоступна: тексты подсказок для этого звонка не сохранены и не переданы — метрики выше описывают только поведение Owner'а.

## Wells Fargo — восстановить доступ к онлайн-банку (CAbe458255…)
Цель: «Regain access to Wells Fargo online banking (account locked / cannot log in) via a live representative.» _(источник: operator-supplied (goal not persisted on the call; inferred from call context by the analyst))_
Подсказки за звонок (hintLatency): отправлено 38, отброшено 9 (текстов в метаданных нет).
Судья: gpt-5.6-sol. Размечено 79/79 turn'ов.

| Метрика | Значение |
| --- | --- |
| % turn'ов на цели | 15.2% |
| % оправданных отступлений | 70.9% |
| % ухода от цели | 13.9% |
| Эпизодов отступления | 6 |
| …из них с возвратом к цели | 5/6 |
| Owner-реплик «возврат к цели» (поведение Owner'а, не атрибуция подсказкам) | 7 |
| Owner-реплик «поддержка нужной ветки» | 15 |
| Owner-реплик «уводит в сторону» | 5 |
| Owner-реплик нейтральных | 5 |

Эпизоды: turn 0–7 (justified_digression, вернулись); turn 10–25 (justified_digression, вернулись); turn 28–30 (justified_digression, вернулись); turn 32–60 (justified_digression, вернулись); turn 62–65 (off_goal, вернулись); turn 72–78 (off_goal, НЕ вернулись)
Примеры плохих (Owner уводит от цели — поведение Owner'а):
- turn 62: «four, twenty three, twenty four, twenty.» — Introduces unclear statement-year details rather than access recovery.
- turn 63: «Five... oh, yeah. Twenty three twenty four.» — Continues discussing apparent statement years.
- turn 65: «I I don't remember.» — Responds within the statement-retrieval detour.
- turn 72: «Okay. I got it. Oh, questions. So can you send me my my statement from my company, MediaClick incorporation, and my personal account? I will really appreciate it. I need for taxes.» — Shifts from access recovery to obtaining personal and business tax statements.
- turn 74: «Hey. Thank you. Thank you. I really appreciate.» — Accepts and thanks the banker for the off-goal business transfer.
Резюме судьи: The IVR, holds, transfers, account lookup, and identity checks are necessary digressions supporting access recovery. The owner repeatedly returns to the login lockout, and the representative ultimately explains that no active products remain and gives next steps. Discussion of specific tax statements and transfer to business support shifts away from the stated online-access goal.
Оценка подсказок недоступна: тексты подсказок для этого звонка не сохранены и не переданы — метрики выше описывают только поведение Owner'а.

## Итог
Звонков оценено: 4. Эпизодов отступления: 18, с возвратом к цели: 14. Owner-реплик «возврат к цели»: 18, «уводит в сторону»: 6 (поведение Owner'а — не атрибуция подсказкам).
Подсказки не оценивались: ни для одного звонка не переданы записи подсказок (тексты подсказок в production не сохраняются).
Вывод: см. эпизоды без возврата и уводящие реплики выше — это кандидаты на разбор.

_Run id: f179c944-4225-4112-8fd8-0d51b9657d85 (benchmark_runs, dev DB, run_type=goal_return)._
