---
name: Process on-call notifications
description: Owner expects immediate email on broken or missing process transitions; coverage must be explicit.
---

Общее правило перенесено в `replit.md` v3 §6; границы и причины ниже сохранены.
Дневной отчёт P.OPS согласован на **08:00 America/Denver**, сутки по Денверу,
с календарными границами местного дня, а не фиксированным UTC-смещением.

**Why:** прямое решение владельца; время больше не открытый вопрос.

**How to apply:** использовать это решение при отдельной доработке P.OPS.
Оно не означает включённое расписание. Текущий пакет/формы P.OPS не менять
до сверки с проходом владельца: ENG.REG.7, три потока контроля, конкретные
входы; внешний сторож оформляется как «Запрос владельцу», не как выданный ресурс.

When a required process event/action fails or does not happen, the owner wants
the process on-call to notify him immediately by email.

**Why:** the owner explicitly requested a duty watcher for the process “green line”,
not silent failures that require manually checking for a report.

**How to apply:** distinguish deterministic operational monitoring from AI QA and
owner acceptance. Say which processes actually have instrumentation; do not
claim company-wide coverage from a call-only watcher. Under the owner's
2026-10-28 decision, P.OPS stays active when analysis is stopped: a missing
owner-call result still requires an alert, including other modes' missing notices.
A same-server/same-mailbox watcher cannot guarantee notification when
the server, database or mail channel itself is down. Never mark these unknown
conditions green or blindly resend ambiguous mail.

Неопределённая доставка уведомления секретаря не должна автоматически повторяться
и не должна повторно запускать само телефонное поручение.

**Why:** при недоступном обычном APNs канал доставки может бесконечно повторять
старые уведомления; повтор телефонного задания вместо уведомления создаст новый звонок.

**How to apply:** сохранять результат поручения и честный неопределённый исход доставки.
После восстановления канала отдельно согласовывать повтор уведомления, не перезапускать звонок.

The owner wants the duty role documented in the common structure before further
automation: all checking documentation must reach it, it controls system-wide
execution and sends a short daily report. Produce the role JSON for the owner's
manual pass, rather than silently turning the description into a running agent.

**Why:** the owner explicitly separated “write the duty role, its actions and JSON”
from his subsequent manual review.

**How to apply:** preserve existing role identity and reporting chains; give every
input a supplier and every report a receiving/review action. Daily system-wide
reporting is the requested scope, not evidence that every subsystem has feeds.
