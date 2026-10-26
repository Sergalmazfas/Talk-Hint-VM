"""Derived, read-only audit deliverables. No database writes or provider calls.
Run after scripts/audit-hint-lab.ts; the snapshot is not a second catalogue."""
import csv
import html
import io
import json
import os
import zipfile
import xml.etree.ElementTree as E
from collections import defaultdict
from pathlib import Path

source = json.loads(Path("/tmp/hint-lab-model.json").read_text())
nodes = source["data"]["nodes"]
by_code = {n["code"]: n for n in nodes if n["kind"] == "action"}
by_id = {n["id"]: n for n in nodes}
docs = {d["id"]: d for d in source["documents"]}
out = Path("generated-artifacts/hint-lab-audit")
out.mkdir(parents=True, exist_ok=True)
archive = "attached_assets/TalkHint_lab_Hint_v1_1793052963436.zip"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with zipfile.ZipFile(archive) as z:
    x = zipfile.ZipFile(io.BytesIO(z.read("TalkHint_lab_Hint_v1.xlsx")))
    strings = []
    if "xl/sharedStrings.xml" in x.namelist():
        strings = ["".join(e.itertext()) for e in E.fromstring(x.read("xl/sharedStrings.xml")).findall("s:si", NS)]
    sheets = {}
    for i, sheet in enumerate(E.fromstring(x.read("xl/workbook.xml")).find("s:sheets", NS), 1):
        rows = []
        for row in E.fromstring(x.read(f"xl/worksheets/sheet{i}.xml")).findall(".//s:sheetData/s:row", NS):
            vals = {}
            for c in row:
                v, inline, f = c.find("s:v", NS), c.find("s:is", NS), c.find("s:f", NS)
                text = strings[int(v.text)] if c.get("t") == "s" and v is not None else "".join(inline.itertext()) if inline is not None else v.text if v is not None else ""
                if f is not None:
                    text = "=" + f.text
                if text:
                    vals["".join(ch for ch in c.get("r") if ch.isalpha())] = text
            if vals:
                rows.append(vals)
        sheets[sheet.get("name")] = rows

# Alias keys below are the owner's PROPOSED spreadsheet codes, never saved IDs.
mapping = {
    "OWN.LAB.1": ([], "Новое описание", "MKT.2.19 — тест конкурента, не собственный Hint. Не подменять им этот вход.", "Сергей → приём ID/версии/цели и оценки; звонки сейчас не поручены."),
    "LAB.{MODE}.1": (["ENG.CHIEF.1", "ENG.CHIEF.6"], "Дополнение", "Есть приём цели и достаточность испытаний, нет отдельного приёма материалов Hint.", "P.LAB предложен; HEAD.07 контролирует. Неполный пакет вернуть владельцу или техническому поставщику."),
    "LAB.{MODE}.2": (["ENG.CHIEF.6", "ENG.CHIEF.8", "ENG.REG.6"], "Дополнение", "Общие испытания/отклонения не равны разметке каждой подсказки.", "Разбор → сводка качества. QA проверяет рубрику/выборку; P.PRODUCT принимает пригодность вывода. Не самоприёмка."),
    "LAB.{MODE}.3": (["SUP.1.1", "ENG.CHIEF.8"], "Связать существующее", "Поддержка собирает обращение; лаборатория должна отдельно принять доступный материал и вернуть точный запрос.", "P.SUPPORT → предложенный приём P.LAB → HEAD.07; нет ID звонка — не выдумывать связь, запросить поддержку."),
    "LAB.{MODE}.4": (["ENG.CHIEF.6"], "Новое описание", "Общая матрица испытаний не даёт права читать записи пользователей.", "Поставщики: поддержка/техника/правовая роль и подтверждённое согласие. Без прав/объёма/срока хранения действие заблокировано."),
    "LAB.{MODE}.5": (["T07.REPORT.WEEK"], "Дополнение", "Не отдельный отчёт компании: раздел качества внутри T07.", "P.LAB предлагает блок → HEAD.07 проверяет полноту → P.COORD принимает T07. Неизвестное обозначить явно, не пустым успешным значением."),
    "LAB.{MODE}.6": (["ENG.CHIEF.6"], "Дополнение", "benchmark_fixtures — реальное хранилище, но его наличие не означает действие пополнения и приёмки reference.", "Разрешённое аудио + проверенный reference → версионированный корпус; QA проверяет эталон. Отсутствие согласия — стоп."),
    "TECH.1": (["ENG.CHIEF.2"], "Новое описание", "Технологический scouting не дублирует анализ возможностей продуктов-конкурентов P-BENCH.", "Предложенный P.TECH → инженер лаборатории/HEAD.07. Источник, дата, новая версия и ограничения обязательны."),
    "TECH.2": (["ENG.CHIEF.3", "ENG.CHIEF.6"], "Дополнение", "Инженер уже оценивает ресурсы/испытания; требуется технический вход кандидата без платного прогона.", "P.TECH → P.LAB/HEAD.07; не хватает тарифа/языка/8кГц/политики данных — точный возврат автору."),
    "TECH.3": (["ENG.CHIEF.8", "ENG.REG.8"], "Дополнение", "Эксплуатация и инциденты есть; профилактическое наблюдение за версиями/ценами надо явно связать.", "P.TECH → HEAD.07 и эксплуатация; существенные сбои передавать по событию, не ждать двух недель."),
    "BENCH.LAB.1": (["MKT.2.10", "MKT.2.11", "MKT.2.24", "MKT.2.5"], "Переиспользовать", "Новый самостоятельный конкурентный цикл не нужен: срез Hint существующего P-BENCH.", "P-BENCH → P.PRODUCT и лаборатория; HEAD.01 проверяет доказательства, продукт ведёт паспорта; мобильный тест — Сергей."),
    "DES.CMP.1": (["PRD.REG.1", "PRD.REG.2", "MKT.2.19"], "Переиспользовать", "Сравнение интерфейсов/прототип уже описаны; добавить привязку к версии Hint и источнику скриншота.", "Скриншоты владельца/бенчмарка → P.UX → P.PRODUCT; HEAD.06 контролирует. Нет скриншота — запрос, не реконструкция UI как факта."),
    "LAB.{MODE}.7": (["ENG.CHIEF.3", "ENG.CHIEF.6"], "Дополнение", "Заявка конкретизирует существующую оценку и матрицу, а не создаёт второй инженерный план.", "P.LAB → HEAD.07: гипотеза, корпус, сравнимые настройки, бюджет/лимиты и критерий остановки."),
    "LAB.{MODE}.7.С": (["ENG.CHIEF.6"], "Дополнение", "Разрешение технической проверки и разрешение расхода — разные решения.", "HEAD.07 проверяет метод; расходы и внешние действия — Сергей. Разрешение/отказ с датой и пределами, молчание не согласие."),
    "LAB.{MODE}.8": (["ENG.CHIEF.6"], "Новое описание", "Статус benchmark_runs не равен приёмке или автоматической работе лаборатории.", "После явного допуска P.LAB проводит/сохраняет → анализ. Сбой сохранить как сбой; повтор только в пределах согласованного лимита."),
    "LAB.{MODE}.9": (["ENG.CHIEF.9", "PRD.1.6"], "Дополнение", "Техническая передача уже есть, нужна доказательная рубрика качества.", "P.LAB → техническая проверка HEAD.07 → приём достаточности P.PRODUCT. Недостаточный отчёт вернуть автору, не выполнять его решение."),
    "PRD.1.6": (["PRD.1.6"], "Переиспользовать", "Существующее продуктовое решение сохранить; решение проверить/отложить не означает выпуск.", "P.PRODUCT записывает решение и возвращает его лаборатории; HEAD.06 — продуктовый контроль, Сергей — не делегированные решения."),
    "LAB.{MODE}.10": (["ENG.REG.6", "ENG.CHIEF.7", "ENG.REG.7"], "Дополнение", "Приёмка поставки, технический допуск и управляемый выпуск уже разделены. Проверка только после выпуска недостаточна.", "QA проверяет кандидата до выпуска; Сергей — iPhone/мобильные материалы; P.LAB сопоставляет. Нужна версия/база, решение об откате уполномоченным, не автоматическое."),
    "LAB.{MODE}.11": (["T07.REPORT.WEEK", "CTL.REPORT.WEEK.1"], "Дополнение", "Один недельный отчёт T07 с вложенным разделом Hint, не два одинаковых отчёта.", "P.LAB → HEAD.07 → P.COORD: версия/период, подтверждение получения, приёмка либо возврат."),
    "LAB.{MODE}.12": (["T07.REPORT.MONTH", "CTL.1.1"], "Дополнение", "Месячный вклад Hint в T07, затем общий отчёт; не суммировать недельные проценты.", "HEAD.07 → P.COORD, финансовая методика HEAD.08/P.FIN; пересчёт из исходных числителей/знаменателей, неизвестное не ноль."),
}
actions = []
load = defaultdict(float)
for row in sheets["Действия"]:
    code = row.get("A", "")
    if code not in mapping:
        continue
    refs, verdict, gap, handoff = mapping[code]
    assert all(r in by_code for r in refs), (code, refs)
    estimate = float(row.get("J", 0)) * float(row.get("K", 0)) / 60
    load[row["D"]] += estimate
    actions.append({
        "proposalCode": code, "name": row["C"], "proposedRole": row["D"],
        "existing": [{"id": by_code[c]["id"], "code": c, "name": by_code[c]["name"]} for c in refs],
        "assessment": verdict, "gapOrDuplication": gap, "receivingAndControlProposal": handoff,
        "draftProcedure": {"input": row.get("E"), "supplierAlias": row.get("F"), "result": row.get("G"),
            "recipientAlias": row.get("H"), "frequency": row.get("I"), "controller": row.get("N"),
            "deadline": row.get("O"), "acceptance": row.get("P"), "return": row.get("Q")},
        "estimatedMonthlyHours": round(estimate, 4), "metricAlias": row.get("M"),
        "status": "Предложение, не внесено; сроки/нагрузка/роли не утверждены",
    })
assert len(actions) == 20

bench_names = ["Ears/Brain", "Secretary Lab", "Translator Spike", "Voice Lab", "Copilot comparison"]
resource_specs = [
    ("/diagnostics", "shared/schema.ts:586–644; server/benchmark/routes.ts; DOC-TALKHINT-CHAPTER-HINT",
     "benchmark_runs + benchmark_fixtures (PostgreSQL). В текущем Dev: 16 прогонов, 3 фикстуры; содержимое не перезапускалось.",
     "TTL в просмотренном коде не найден; утверждённый срок неизвестен.",
     ["ENG.CHIEF.6", "ENG.CHIEF.2"], "STT/BRAIN, не акустическая проверка iPhone; исторические записи не доказывают актуального победителя."),
    ("/secretary-lab", "server/secretaryLab/comparisonStore.ts; server/secretaryLab/retell.ts",
     "Живые сессии в памяти отдельно от PostgreSQL secretary_lab_comparisons: в Dev 33 строки, число не равно числу неистёкших/принятых сравнений.",
     "Завершённые Retell-сессии ~1 час; сохранённые сравнения 30 дней от создания, код хранит expires_at. Не общий TTL всех провайдеров.",
     ["ENG.CHIEF.6"], "Сохранение сравнения явно, с согласием; нет проверки удалённого Engine/Retell и реального звонка."),
    ("/translator-spike", "server/translation/spike.ts:523–572,724–750,1011+; server/translation/forensics.ts",
     "Журнал eventLog в браузере; явный экспорт JSON. Анализатор принимает переданный журнал; постоянный архив этих экспортов не найден в просмотренном маршруте.",
     "До сброса/закрытия страницы; лимит 200000 событий с отметкой отброшенного. Согласованный срок архива неизвестен.",
     ["ENG.CHIEF.6", "ENG.REG.6"], "Браузерный эксперимент не доказательство PSTN/iPhone; без сохранённого экспорта история может потеряться."),
    ("/voice-lab", "server/voiceLab/store.ts; server/voiceLab/routes.ts; shared/schema.ts:644+",
     "PostgreSQL voice_lab_runs: в Dev 6 строк. listVoiceLab возвращает последние 100 по владельцу; это не TTL. Аудио генерируется отдельным запросом, не доказывается наличием строки.",
     "Автоматический TTL в просмотренном store не найден; срок хранения/политика голоса требуют решения.",
     ["ENG.CHIEF.6", "ENG.REG.6"], "Тексты/провайдер/тайминги отдельно от голосового клона и воспроизведения; сравнение не подтверждает цену счёта."),
    ("/translator-spike/copilot", "server/translation/copilotBench.ts; server/translation/copilotBenchPage.ts; server/translation/spike.ts:523",
     "Браузерная страница сравнения и потоковая сессия. Обязательная серверная запись каждого результата отдельным run_id в просмотренных модулях не найдена.",
     "Сессионное состояние; автоматический постоянный архив/TTL не подтверждены.",
     ["ENG.CHIEF.6", "PRD.REG.1"], "Не удаление Copilot; кандидатные сессии не запускались. Долговечное хранение отчёта — предложение, не внедрение."),
]
resources = []
for name, spec in zip(bench_names, resource_specs):
    path, evidence, storage, retention, codes, limitation = spec
    matches = [n for n in nodes if n["kind"] == "resource" and name.lower() in (n["name"]+" "+n["description"]).lower()]
    resources.append({"name": name, "path": path, "modelMatches": [{"id": n["id"], "name": n["name"]} for n in matches],
        "existingModelFinding": "Точный самостоятельный ресурс по названию/описанию не найден; косвенные ресурсы кода/документов не равны паспорту стенда." if not matches else "Есть совпадения; проверить идентичность перед дополнением.",
        "ownerProposal": "HEAD.07 — владелец технического ресурса; P.LAB — возможный оператор только после согласования, не назначен",
        "state": "Реализация найдена чтением кода; текущий живой прогон/доступ исполнителя не проверены",
        "access": "Административные стенды защищены существующим доступом; Translator/Copilot — только Dev при включённом spike, действия — по токену. Доступ будущему AI не проверен/не выдан; прав не меняли.",
        "storage": storage, "retention": retention, "usedByExistingActions": [by_code[c]["id"] for c in codes],
        "proposedActions": ["LAB.{MODE}.7", "LAB.{MODE}.8", "LAB.{MODE}.9"], "source": evidence,
        "limitation": limitation, "catalogueChange": "Только предложение добавить/уточнить в существующем каталоге, не создано"})

data_audit = [
    {"need": "События/текст подсказок и время показа", "finding": "Частично в коде, фактические Dev-записи не подтверждены",
     "evidence": "server/candidatePipeline.ts:274–447, server/websocket.ts:3074–3104; ios/TalkHint/Calls/CallHintStream.swift:222–233",
     "detail": "hintLatency.entries: sttFinalAt, triggerAt, readyAt, sentAt, deliveredAt по ACK, text, outcome/dropReason; сохраняются первые 200. sttFinalAt не физический конец речи. summary использует весь накопленный набор, entries ограничены: не пересчитывать их как полный набор. hintUsage — совпадение речи, не человеческая полезность. В текущем Dev calls=0. Реальный ACK текущей iPhone-сборки не проверен.",
     "supplier": "HEAD.07/P.LG.TECH/P.MOBILE", "request": "Разрешённый существующий пример с полной цепочкой событий, версией сборки и часов; отсутствие ACK считать неизвестным. Новый звонок не разрешён."},
    {"need": "Записи/дорожки и эталон", "finding": "Есть benchmark_fixtures, но это не право на произвольные записи пользователей",
     "evidence": "shared/schema.ts:586–644; DOC-TALKHINT-AUDIO-PASSPORT; Dev SELECT count benchmark_fixtures=3",
     "detail": "Наличие 3 фикстур не доказывает согласие на новый корпус, полноту дорожек или качество reference. Записи пользователей не открывались. Нужны согласие, цель, доступ, удаление и при необходимости правовая проверка.",
     "supplier": "HEAD.07 + P.LEGAL + владелец/поддержка", "request": "Перечень разрешённых фикстур и оснований использования; эталон и его приёмка, политика хранения."},
    {"need": "Оценка полезности владельцем", "finding": "Структурированная разметка каждой Hint-подсказки в History не подтверждена",
     "evidence": "server/candidatePipeline.ts:436; DOC-TALKHINT-CHAPTER-HINT metrics/reviewProtocol",
     "detail": "hintUsage — алгоритмический proxy, не оценка Сергея. Оценки Secretary Lab нельзя выдавать за оценки Hint. Рубрика и принимающий требуют согласования.",
     "supplier": "P.PRODUCT/P.UX + Сергей", "request": "Рубрика верная/бесполезная/ошибочная/выдумка, хранение версии оценки, разграничение judge/человека."},
    {"need": "Расход на звонок", "finding": "Нет подтверждённого полного факта себестоимости",
     "evidence": "DOC-TALKHINT-CHAPTER-HINT metrics.hint-cost; server/benchmark/candidates.ts",
     "detail": "Исторические estCostPer10MinCall — оценки, не счёт. В Dev нет звонков для атрибуции. Нужны датированные STT/LLM/Twilio тарифы и usage с единицами, без двойного счёта инфраструктуры.",
     "supplier": "HEAD.08/P.FIN + HEAD.07", "request": "Методика атрибуции, цены/валюта/период, неизвестные тарифы явно; расход не разрешён."},
    {"need": "Сопоставимый метод Ears", "finding": "Недостаточность сопоставимости требует проверки по run/config/reference, не автоматического утверждения «метод исправлен»",
     "evidence": "DOC-TALKHINT-CHAPTER-HINT layers.lab; server/benchmark; исторические benchmark_runs",
     "detail": "Одинаковый corpus/hash, reference, язык, канал, скорость replay, режим final/EOT; единый WER=(S+D+I)/N. Семантический proxy отдельно; исторические ускоренные тайминги не real-time.",
     "supplier": "HEAD.07 + QA; P.LAB только предложение", "request": "Проверить метод на существующих результатах/эталоне, перечислить несопоставимые поля. Новый прогон отдельно согласуется."},
]

metric_notes = {
 "test_calls_done": "Сделано/согласованный план за период; плана нет — null. Не обязанность совершать звонки сейчас.",
 "review_on_time": "Число разборов с приёмкой в согласованный срок / число работ, срок которых наступил в периоде. Открытые просроченные включать; ждать недостающий вход отдельно.",
 "quality_report_on_time": "Принятые в срок сводки / запланированные сводки с наступившим сроком. Пятница пока предложение.",
 "corpus_growth": "Число новых разрешённых и принятых записей/слов reference, с версией. Не стимулировать объём вместо качества.",
 "scouting_on_time": "Принятые обзоры в срок / согласованные двухнедельные обзоры с наступившим сроком; срочные риски отдельно.",
 "candidates_accepted": "Допущенные кандидаты / рассмотренные кандидаты; решения ожидаются отдельно. Не доля среди всех найденных в интернете и не целевой норматив.",
 "run_lead_time": "Медиана рабочих дней от регистрации достаточного кандидата до явного решения; длительность активной работы и ожидания отдельно; незавершённые не скрывать.",
 "reproducible_runs": "Завершённые прогоны с полным corpus/config/prompt/code и сопоставимой методикой / все допущенные начатые прогоны периода; сбои/отмены отдельно.",
 "regressions_found": "Знаменатель «все ухудшения» неизвестен. Предложение: число найденных до выпуска регрессий и число проверок; отдельно post-release escapes среди известных регрессий. Не объявлять полноту обнаружения и не поощрять число дефектов.",
 "proposals_accepted": "Принятые дизайн-предложения / рассмотренные; ожидающие и отклонённые раздельно. Не считать отсутствие решения отказом или приёмкой.",
 "report_on_time": "Принятые в согласованный срок отчёты / обязательные отчёты с наступившим сроком; раздельно неделя/месяц.",
}
metrics = []
for r in sheets["KPI"][1:]:
    key = r.get("A")
    if key not in metric_notes:
        continue
    metrics.append({"metricId": key, "name": r["B"], "draftFormula": r["C"],
        "clarificationProposal": metric_notes[key], "target": None, "actual": None,
        "status": "ждёт согласования; нормативов и факта нет"})
assert len(metrics) == 11
metric_field = {
    "status": "Предложение схемы, НЕ поле действующей модели",
    "current": "WorkNode содержит success, register, reporting; структурированного поля KPI в shared/operatingModel.ts нет. Метрики главы Hint — документ, не KPI у действия.",
    "example": {"actionId": by_code["T07.REPORT.WEEK"]["id"], "metrics": [{
        "id": "report_on_time", "name": "Своевременность принятого отчёта", "formula": "accepted_on_time/due_reports",
        "unit": "доля", "period": {"start": None, "end": None, "timezone": None},
        "plan": None, "fact": None, "numerator": None, "denominator": None, "sampleSize": None,
        "source": {"documentId": None, "runIds": [], "capturedAt": None, "evidenceType": None},
        "scope": {"mode": "hint", "language": None, "build": None, "environment": "Dev"},
        "calculationStatus": "нет данных", "approvalStatus": "предложение", "acceptanceEvidence": None,
    }]},
    "rules": ["null — неизвестно; нулевой знаменатель → не применимо, не 0%/100%",
        "Одинаковые метрики не складывать между уровнями. Пересчитывать из дедуплицированных числителей/знаменателей; процентили из одинаковых исходных измерений, не среднее недельных p95.",
        "Факт связан с источником/датой/версией; измерение, оценка и публичное заявление — разные типы.",
        "4 продуктовые метрики Hint отделены от 11 KPI работы лаборатории; их цели всё ещё ждут решения владельца.",
        "План, ресурсные лимиты и стоимость согласовываются отдельно; эта схема не выдаёт доступ и не создаёт автоматическую сборку."],
}

coverage = []
for i in range(1, 11):
    code = f"T{i:02}"
    direction = next(n for n in nodes if n["kind"] == "department" and n["code"] == code)
    aa = [a for a in nodes if a["kind"] == "action" and a["code"].startswith(code + ".REPORT.")]
    report_items = []
    for a in aa:
        r = a.get("reporting") or {}
        tid = r.get("templateDocumentId")
        report_items.append({"id": a["id"], "code": a["code"], "formStatus": r.get("formStatus"),
            "templateDocumentId": tid, "templateExists": tid in docs if tid else False})
    coverage.append({"direction": code, "name": direction["name"], "id": direction["id"],
        "reports": report_items,
        "finding": "Общих привязанных шаблонов отдела нет; поля formStatus=required и templateDocumentId=null.",
        "exception": "Есть отдельные DOC-PBENCH-DAILY-TEMPLATE v2 и DOC-PBENCH-WEEKLY-TEMPLATE v2 (черновики на обсуждении), бланки кандидатов/решения v1. MKT.2.13–17 задают недельную/месячную цепь; это не полные шаблоны T01. Считать T01 неполным нельзя только из-за отличного кода, но общую форму отдела нужно уточнить." if i == 1 else None})

chain_codes = ["T07.REPORT.WEEK", "CTL.REPORT.WEEK.1", "CTL.REPORT.WEEK.2", "CTL.REPORT.WEEK.3"]
chain = []
for c in chain_codes:
    n = by_code[c]
    chain.append({"id": n["id"], "code": c, "name": n["name"], "roleId": n["roleId"],
        "acceptorId": n["acceptorId"], "nextId": n["nextId"], "status": n["status"],
        "inputIds": [i["sourceId"] for i in n["inputs"]],
        "outputs": [l["to"] for l in source["data"]["links"] if l["kind"] == "produces" and l["from"] == n["id"]],
        "returnTo": [l["to"] for l in source["data"]["links"] if l["kind"] == "return" and l["from"] == n["id"]],
        "implemented": "Описанная цепь, не доказательство выпуска/получения/приёмки реального отчёта"})
report = {
    "format": "talkhint.hint-lab.mapping-proposal", "version": 1, "snapshotRevision": source["revision"],
    "capturedAt": source["capturedAt"], "status": "Для обсуждения. Не внесено, кроме общего стандарта владельца",
    "sourceArchive": archive, "notRoleExecutionPackage": True,
    "purpose": "Сопоставление существующей структуры с черновиком лаборатории, не второй каталог и не работающая Crew",
    "facts": {"roles": sum(n["kind"] == "role" for n in nodes), "newRoleCodesPresent": [n["code"] for n in nodes if n["code"] in ["P.LAB", "P.TECH"]],
        "actionsMapped": len(actions), "labKpisReviewed": len(metrics), "benchesReviewed": len(resources),
        "databaseRead": {"environment": "Dev only", "calls": 0, "benchmarkRuns": 16, "benchmarkFixtures": 3, "voiceLabRuns": 6, "secretaryComparisons": 33},
        "limits": "Агрегатные SELECT, без аудио/транскриптов/персональных данных; не проверка production, текущей сборки или провайдеров."},
    "actions": actions, "resources": resources, "requiredData": data_audit,
    "roleBoundaries": [
        {"role": "P.LAB", "status": "Предложение, отсутствует в модели", "client": "P.PRODUCT получает доказательное сравнение для решения, HEAD.07 — технические основания",
         "does": "Приём разрешённого корпуса/материалов, разметка, воспроизводимая проверка и технический раздел T07",
         "doesNot": "Не принимает свою работу, не выпускает продукт, не утверждает расходы, не имеет доступа по факту описания. Сначала проверить возможность поручить операторские действия существующим P.LG.TECH/QA; не дублировать должность автоматически."},
        {"role": "P.TECH", "status": "Предложение, отсутствует в модели", "client": "Лаборатория и HEAD.07",
         "does": "Публичные релизы моделей/провайдеров, совместимость, кандидаты, риски устаревания/цен/сбоев",
         "doesNot": "Не ведёт паспорта конкурентов вместо продукта; не подключает API/оплату. Можно начать как обязанности существующего технического специалиста; отдельная должность требует решения о границах и нагрузке."},
        {"role": "HEAD.07 / QA / P.PRODUCT / P-BENCH / P.UX", "status": "Есть в модели; исполнители не назначены этим аудитом",
         "does": "HEAD.07 метод/допуск/контроль; QA независимая проверка; продукт — достаточность/решение/паспорт; бенчмаркинг — доказательства конкурентов; UX — сравнение экранов",
         "doesNot": "Сергей выполняет мобильные тесты и сохраняет не делегированные расходы/внешние действия/выпуск. Роль и отдельный экземпляр AI не смешивать."},
    ],
    "reportingChain": chain,
    "reportingChainGaps": [
        "Приём материалов Hint инженером лаборатории и приём его семи блоков HEAD.07 не имеют отдельного подтверждённого действия; предложено добавить/уточнить существующую приёмку, без нового уровня контролёров.",
        "T07 → P.COORD → агрегирование → CEO → owner существует как описание с возвратами. У owner есть статус конечного принимающего, но отдельное исполненное действие приёмки отчёта не подтверждено.",
        "Некоторые поля acceptor/links описывают разные уровни контроля. До внедрения устранить неоднозначность: HEAD.07 — содержание T07, координатор — комплектность общего пакета, CEO — предложение решения, Сергей — конечные полномочия.",
        "Состав входов большой: брать относящиеся к периоду и режиму, не ждать все документы компании и не включать один результат дважды.",
    ],
    "departmentReports": coverage,
    "commonReportProposal": {"status": "Черновик, не утверждённый бланк",
        "header": ["ID/версия", "направление/ответственный", "период/часовой пояс", "аудитория/регион/язык/платформа", "план и критерии до выполнения", "принимающий/срок либо неизвестно"],
        "core": ["План-факт результатов и действий; отклонения", "Качество и метрики с источниками/знаменателями/стоимостью", "Сделано и принятые версии, доказательства", "Внешняя среда и изменения, факт отдельно от гипотезы", "Решения/блокеры/меры: кому, что требуется, срок, статус ответа и эффект"],
        "specific": "Лаборатория: качество по языкам, стенд/корпус, внешние технологии, конкуренты, дизайн. Другие отделы добавляют свои блоки, не второй независимый отчёт.",
        "sevenLabBlocks": [
            ["Качество", "Качество/метрики", "LAB.{MODE}.5"],
            ["Стенд", "Сделано/доказательства", "LAB.{MODE}.8–9"],
            ["Сделано", "План-факт", "Принятые результаты действий"],
            ["Внешняя среда", "Внешняя среда", "TECH.1–3"],
            ["Конкуренты", "Внешняя среда + находки продукту", "P-BENCH существующие передачи"],
            ["Дизайн", "Специфичный блок с версиями скриншотов", "PRD.REG.1–2"],
            ["Решения", "Решения/блокеры", "PRD.1.6 + фактический ответ/возврат"]],
        "handoff": "Составить/передать → принять/вернуть; ID результата и ID/версия формы отдельно. Ответы не получены этим аудитом.",
        "cadence": "Оперативный дневной журнал → недельный план-факт → месячная сводка → квартальное рассмотрение; конкретные даты/ответы и формы согласовать, не придумывать факт."},
    "actionMetricProposal": metric_field, "kpis": metrics,
    "workload": {"estimatedMonthlyHours": {k: round(v, 2) for k, v in load.items()},
        "basis": "Формулы XLSX J*K/60, не измерение, не бюджет и не машинная мощность. P.LAB включает выборку пользователей, которая пока не разрешена.",
        "limits": "Нагрузка неполная: время поставщиков/доработок/ожидания и пересечения нескольких режимов не измерены. P.TECH частично общий для режимов; не умножать автоматически на три."},
    "scheme": [
        {"step": "Должность", "now": "HEAD.07, QA, P.PRODUCT, P-BENCH, P.UX", "proposal": "Оператор P.LAB и scouting P.TECH, либо уточнение существующих обязанностей"},
        {"step": "Действия", "now": "20 строк сопоставлены с существующими ID", "proposal": "Конкретные дополнения и парные приёмы"},
        {"step": "Ресурс/стенд", "now": "5 реализаций/документаций, точных ресурсных карточек не найдено", "proposal": "Связи существующего каталога; владелец/доступ/хранение"},
        {"step": "Метрика", "now": "4 метрики главы + исторические измерения, без утверждённых целей", "proposal": "11 уточнённых KPI и структурированная запись у действия"},
        {"step": "Отчёт отдела", "now": "T07.REPORT.WEEK описан, общего шаблона нет", "proposal": "7 блоков Hint внутри общей формы T07"},
        {"step": "Общий отчёт", "now": "CTL.REPORT.WEEK.1 → .2 → .3 → owner, описание", "proposal": "Явные получение/приёмка/возврат и реальные подтверждения вместо симуляции"}],
    "questions": [
        "Согласовать P.LAB/P.TECH как отдельные должности или сначала закрепить эти действия за существующим техническим специалистом/QA под HEAD.07?",
        "Подтвердить границы приёмки: HEAD.07 техническое содержание, P.PRODUCT достаточность для решения, координатор комплектность; без нового постоянного контролёра?",
        "Какие уже имеющиеся звонки/записи/скриншоты разрешены для первого ручного прохода и где подтверждение согласия? Новые звонки не предполагаются.",
        "Принять ли предлагаемые ритм/сроки/рубрику и схему формы? Пока 2 дня, пятница, двухнедельный цикл, 38/8 часов — предложения, а не обязательства.",
    ],
    "next": "Согласовать сопоставление и минимальный состав операторских обязанностей. Затем отдельно внести согласованные связи, выгрузить канонический JSON и реально пройти его; этот аудит не является таким проходом.",
    "notDone": ["Новые роли/ресурсы/KPI-поле не сохранены", "Формы не утверждены", "Доступы/согласия не выданы", "Прогоны/звонки/crew не запускались", "Продуктовая приёмка и ответы других ролей не имитировались", "Production не проверялся и не публиковался"],
}
standard_doc = docs["DOC-TALKHINT-PRODUCT-PASSPORT"]
book = json.loads(standard_doc["text"].split("<!-- TALKHINT-PRODUCT-BOOK-V2 -->")[1])
report["book"] = {"id": standard_doc["id"], "version": book["version"], "updatedAt": standard_doc["updatedAt"],
    "standardPresent": "## Как собирается каждая должность" in book["responsibilities"],
    "scope": "Единственная разрешённая запись — общий стандарт владельца, не предложения этого аудита"}
assert report["book"]["standardPresent"], "Save only the approved standard before final export"
assert len(coverage) == 10 and len(resources) == 5
assert report["facts"]["newRoleCodesPresent"] == []
(out / "Hint-lab-mapping-v1.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
with (out / "20-actions-mapping.csv").open("w", newline="") as f:
    w = csv.writer(f); w.writerow(["Предложенный код", "Действие", "Существующие ID", "Оценка", "Пробел", "Передача/контроль", "Статус"])
    for a in actions:
        w.writerow([a["proposalCode"], a["name"], "; ".join(e["code"]+" / "+e["id"] for e in a["existing"]),
            a["assessment"], a["gapOrDuplication"], a["receivingAndControlProposal"], a["status"]])

domain = os.environ.get("REPLIT_DEV_DOMAIN")
assert domain, "Use actual Dev domain, not a guessed URL"
base = "https://" + domain
link = base + "/admin/project-model?hypothesis=new-country&view=book&chapter=team"
download = base + "/api/product-crew/documents/DOC-TALKHINT-PRODUCT-PASSPORT/download"
report["links"] = {"book": link, "canonicalDocument": download}
(out / "Hint-lab-mapping-v1.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))

def esc(x):
    return html.escape(str(x))

field_labels = {
    "role": "Должность", "client": "Клиент результата", "does": "Ответственность", "doesNot": "Границы",
    "name": "Название", "status": "Статус", "source": "Источник", "evidence": "Основание",
    "proposalCode": "Код в черновике", "proposedRole": "Предлагаемый исполнитель", "existing": "Существующие записи",
    "assessment": "Оценка соответствия", "gapOrDuplication": "Пробел / риск дублирования",
    "receivingAndControlProposal": "Передача, приёмка и контроль — предложение", "draftProcedure": "Процедура из черновика",
    "input": "Вход", "supplierAlias": "Поставщик (код черновика)", "result": "Результат",
    "recipientAlias": "Получатель (код черновика)", "frequency": "Ритм", "controller": "Контролирующий",
    "deadline": "Срок — предложение", "acceptance": "Приёмка", "return": "Возврат", "estimatedMonthlyHours": "Оценка часов в месяц",
    "metricAlias": "Метрика черновика", "code": "Код", "id": "Сохранённый ID", "finding": "Результат проверки",
    "need": "Что нужно", "detail": "Подробности", "supplier": "Поставщик", "request": "Запрос",
    "path": "Путь", "modelMatches": "Найденные ресурсные карточки", "existingModelFinding": "Что есть в модели",
    "ownerProposal": "Владелец ресурса — предложение", "state": "Подтверждённое состояние", "access": "Доступ",
    "storage": "Хранение", "retention": "Срок хранения", "usedByExistingActions": "Связать с существующими действиями",
    "proposedActions": "Предлагаемые действия", "limitation": "Ограничение", "catalogueChange": "Изменение каталога",
    "direction": "Направление", "reports": "Действия отчётности", "exception": "Особенности",
    "formStatus": "Статус формы", "templateDocumentId": "ID шаблона", "templateExists": "Шаблон существует",
    "roleId": "Ответственная роль", "acceptorId": "Принимающий", "nextId": "Следующий шаг",
    "inputIds": "Источники входа", "outputs": "Результаты", "returnTo": "Кому возвращает", "implemented": "Что действительно работает",
    "metricId": "Код KPI", "draftFormula": "Формула в черновике", "clarificationProposal": "Уточнение формулы",
    "target": "Цель", "actual": "Факт", "current": "Сейчас", "example": "Пример предлагаемой записи",
    "rules": "Правила", "step": "Элемент цепи", "now": "Сейчас", "proposal": "Предложение",
    "header": "Шапка", "core": "Общее ядро", "specific": "Специфика отдела", "sevenLabBlocks": "Семь блоков лаборатории",
    "handoff": "Передача", "cadence": "Периодичность", "basis": "Основание", "limits": "Ограничения",
    "version": "Версия", "updatedAt": "Обновлено", "standardPresent": "Стандарт сохранён", "scope": "Границы",
    "roles": "Ролей в модели", "newRoleCodesPresent": "P.LAB / P.TECH в модели", "actionsMapped": "Сопоставлено действий",
    "labKpisReviewed": "Проверено KPI", "benchesReviewed": "Проверено стендов", "databaseRead": "Проверка Dev-базы",
}

def render(x):
    if isinstance(x, dict):
        return "<dl>"+"".join("<dt>"+esc(field_labels.get(k,k))+"</dt><dd>"+render(v)+"</dd>" for k,v in x.items())+"</dl>"
    if isinstance(x, list):
        return "<ul>"+"".join("<li>"+render(v)+"</li>" for v in x)+"</ul>"
    if isinstance(x, bool):
        return "да" if x else "нет"
    return esc("неизвестно" if x is None else x)

labels = {
    "facts": "Что подтверждено", "scheme": "Единая схема связей", "actions": "Все 20 действий: сейчас → предлагается",
    "roleBoundaries": "Границы должностей", "resources": "Пять стендов как ресурсы", "requiredData": "Необходимые данные",
    "reportingChain": "Существующая цепочка отчётности", "reportingChainGaps": "Разрывы приёмки",
    "departmentReports": "Шаблоны десяти направлений", "commonReportProposal": "Предлагаемая общая форма",
    "actionMetricProposal": "Предложение KPI у действия", "kpis": "Все 11 KPI", "workload": "Оценки нагрузки",
    "book": "Сохранённый стандарт", "questions": "Вопросы Сергею", "next": "Один следующий шаг", "notDone": "Что не выполнялось",
}
document = """<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hint · лаборатория и структура · сверка v1</title><style>
body{margin:0;background:#f5f8f7;color:#183431;font:16px/1.55 system-ui,sans-serif}
main{max-width:960px;margin:auto;padding:20px}h1{font-size:27px;line-height:1.2}h2{font-size:20px}
details{background:white;border:1px solid #d8e5e1;border-radius:12px;padding:15px;margin:12px 0}
summary{cursor:pointer;font-weight:700;color:#12695d}dt{font-weight:650;margin-top:10px}
dd{margin-left:0;overflow-wrap:anywhere}ul{padding-left:20px}li{margin:8px 0}
a{color:#00695d;overflow-wrap:anywhere}.button{display:inline-block;padding:12px;background:#146c60;color:white;border-radius:9px;text-decoration:none}
small{color:#526b66}.note{padding:15px;background:#fff4d7;border-radius:10px}dl{margin:0}
.chain{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:9px}.chain article{background:white;padding:12px;border:1px solid #bed4cd;border-radius:8px}.chain p{font-size:14px}
@media(max-width:480px){main{padding:12px}details{padding:12px}ul{padding-left:15px}}
</style><main><h1>Лаборатория Hint: единая структура и отчётность</h1>"""
document += f"<p>Сверка v1 · new-country rev{report['snapshotRevision']} · книга v{book['version']} · 26.10.2026</p>"
document += "<p class='note'>Для обсуждения. Роли, ресурсы, KPI и формы не внедрены. Сохранён только прямо согласованный общий стандарт. Этот файл — снимок сверки, не второй каталог и не исполняемый JSON должности.</p>"
document += f"<p><a class='button' href='{esc(link)}'>Открыть стандарт в книге</a></p><p><small>Требуется обычный вход владельца; доступ не изменён.</small></p>"
document += "<p>Должность → действие → ресурс/стенд → метрика → отчёт отдела → общий отчёт</p>"
document += "<section class='chain'>" + "".join("<article><strong>"+esc(step["step"])+"</strong><p>"+esc(step["now"])+"</p></article>" for step in report["scheme"])+"</section>"
for key, label in labels.items():
    document += "<details"+(" open" if key in ["facts", "questions", "next"] else "")+"><summary>"+label+"</summary>"+render(report[key])+"</details>"
document += "</main></html>"
(out / "Hint-lab-audit-v1.html").write_text(document)
(out / "README.txt").write_text(f"""TalkHint: лаборатория Hint — сверка v1
Снимок модели rev{source['revision']}; книга v{book['version']}. Дата 26.10.2026.
Hint-lab-audit-v1.html — читаемый отчёт, открывается локально и на телефоне без внешних скриптов.
Hint-lab-mapping-v1.json — полный снимок предложений, НЕ паспорт назначенной роли.
20-actions-mapping.csv — таблица всех 20 действий.
Актуальный стандарт: {link}
Документ: DOC-TALKHINT-PRODUCT-PASSPORT. MCP get_document с этим documentId.
Скачивание канонического документа: {download} (существующий доступ Product Crew, права не менялись).
Чтение модели/кода и агрегатов Dev выполнено вручную Replit; приёмка других ролей не выполнялась.
Существующая глава Hint v1 не менялась. Единственная запись в модель — согласованный стандарт в прежней книге с историей.
Предложения требуют обсуждения. Выпуск, расходы, внешние вызовы, записи пользователей и запуск команды не разрешены этим пакетом.
""")
with zipfile.ZipFile(out / f"TalkHint-Hint-lab-audit-v1-rev{source['revision']}.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for name in ["Hint-lab-audit-v1.html", "Hint-lab-mapping-v1.json", "20-actions-mapping.csv", "README.txt"]:
        z.write(out/name, name)
print(json.dumps({"revision": source["revision"], "bookVersion": book["version"], "actions": len(actions),
    "kpis": len(metrics), "resources": len(resources), "departments": len(coverage), "loadEstimates": dict(load),
    "output": str(out)}, ensure_ascii=False))
