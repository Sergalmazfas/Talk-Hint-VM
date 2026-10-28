"""Prepare a review-only export. Never writes the operating model or starts services."""
import copy
import difflib
import hashlib
import json
import os
import subprocess
from pathlib import Path
import zipfile
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

BASE = Path("/tmp/pops-current.json")
SOURCE = Path("attached_assets/0_P-OPS_pass_rev800_v1_1793148094526.zip")
OUT = Path("generated-artifacts/pops-review")
PACKET = "DOC-POPS-WORK-PACKAGE"
FORM = "DOC-POPS-DAILY-REPORT"
ROLE = "management-role-operations-specialist"


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def sha(value):
    return hashlib.sha256(value).hexdigest()


def write(name, value):
    target = OUT / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value if isinstance(value, str) else
                      json.dumps(value, ensure_ascii=False, indent=2) + "\n")


state = json.loads(BASE.read_text())
operating = state["operatingModel"]["revisions"][-1]
data = operating["data"]
nodes = {n["id"]: n for n in data["nodes"]}
documents = {d["id"]: d for d in state["documents"]}
original = json.loads(documents[PACKET]["text"])
original_form = json.loads(documents[FORM]["text"])
assert original["version"] == 2 and original_form["version"] == 1
with zipfile.ZipFile(SOURCE) as archive:
    pass_name = next(n for n in archive.namelist() if n.endswith(".json"))
    review = json.loads(archive.read(pass_name))
    review_text = archive.read(next(n for n in archive.namelist() if n.endswith(".md"))).decode()
    assert review["metadata"]["sourceRevision"] == 800
    assert review["manualPass"]["verdict"] == "принять с исправлениями"
assert [a["id"] for a in review["actions"]] == [a["id"] for a in original["actions"]]
OUT.mkdir(parents=True, exist_ok=True)
write("history/P-OPS_work_package_v2_rev800_PASS.json", review)
write("history/01_Проход_P.OPS.md", review_text)
write("history/P-OPS_work_package_v2_stored.json", original)
write("history/P-OPS_daily_report_v1_stored.json", original_form)

packet = copy.deepcopy(original)
packet["version"] = 3
packet["metadata"].update({
    "sourceRevision": state["revision"], "operatingVersion": operating["version"],
    "snapshotAt": datetime.now(timezone.utc).isoformat(),
    "status": "Предложено после прохода rev800; к модели не применено",
    "ownerAcceptance": None,
    "documentId": PACKET,
})
packet["authorization"].update({
    "automaticExecution": False, "appliedToModel": False,
    "scope": "Только пакет исправлений для ручной сверки; не разрешение активации",
})
packet["manualPass"] = {
    "verdict": None, "performedBy": None, "performedAt": None,
    "rule": "Проход v3 ещё не выполнен. Историческая приёмка v2 не переносится.",
}
packet["manualPassHistory"] = [{
    "source": "history/P-OPS_work_package_v2_rev800_PASS.json",
    "sourceArchiveSha256": sha(SOURCE.read_bytes()),
    "verdict": review["manualPass"]["verdict"],
    "performedBy": review["manualPass"]["performedBy"],
    "performedAt": review["manualPass"]["performedAt"],
    "appliesToVersion": 2,
}]
packet["commonProcedure"]["responseTime"] = (
    "Сбой — без искусственной отсрочки после обнаружения; технический порог отдельный. "
    "Дневной отчёт: 08:00 America/Denver за предыдущий местный календарный день; "
    "границы 00:00→00:00 с DST. Сроки ответов поставщиков не утверждены."
)
packet["commonProcedure"]["acceptance"] += (
    " HEAD.07 проверяет выборочно и последующе, не задерживает сигнал/письмо. "
    "Факт обнаружения не требует разрешения инженерии."
)
packet["role"]["permissions"] += (
    " Сигнал владельцу не требует предварительной приёмки HEAD.07. "
    "Техническую готовность выпуска принимает HEAD.07; Publish/TestFlight — владелец."
)
packet["dailyReportForm"] = {
    "documentId": FORM, "version": 2,
    "read": "MCP get_document(documentId='DOC-POPS-DAILY-REPORT') после применения",
    "reviewFile": "P-OPS_daily_report_v2_CANDIDATE.json",
    "rule": "Единственная форма и карта контроля в прежнем документе; копию не заводить",
}
packet["metrics"] = {"documentId": FORM, "pointer": "/metricDefinitions"}
packet["relatedForms"] += [{"documentId": FORM, "version": 2, "status": "кандидат"}]
packet["reviewBasis"] = {
    "revision": state["revision"], "sourcePassRevision": 800,
    "findingCount": 8, "independentReviewOfV3": False,
    "ownerDecision": "Час 08:00 America/Denver принят владельцем 27.10.2026, replit.md v3 §6",
    "runtimeVerified": False,
}


def results(action_id):
    return [link["to"] for link in data["links"]
            if link["from"] == action_id and link["kind"] == "produces"]


def supplier(result_id):
    producers = [nodes[link["from"]] for link in data["links"]
                 if link["to"] == result_id and link["kind"] == "produces"]
    assert producers, ("Missing actual supplier", result_id)
    return producers[0]["id"], producers[0].get("roleId")


def inp(result_id, name=None, when="По относящемуся событию/периоду; не ждать все системы"):
    assert result_id in nodes, result_id
    action_id, role_id = supplier(result_id)
    return {"name": name or nodes[result_id]["name"], "sourceId": result_id,
            "supplierActionId": action_id, "supplierRoleId": role_id,
            "requiredWhen": when, "freshness": "Версия/период/окружение/источник и ограничения"}


actions = {a["code"]: a for a in packet["actions"]}
by_id = {a["id"]: a for a in packet["actions"]}
department_results = []
for entry in packet["documentationInputs"]:
    actual_results = results(entry["supplierActionId"])
    assert actual_results
    department_results.extend(actual_results)
    entry.update({"resultIds": actual_results, "received": False, "response": None,
                  "status": "ожидает реального входа, не отправлено"})

mapping = {
    "OPS.SCOPE": ["company-action-product-reference-result",
                  "company-action-technical-facts-result"],
    "OPS.DOCUMENTS": department_results,
    "OPS.INPUTS": ["oncall-action-scope-out", "oncall-action-documents-out"],
    "OPS.QUALITY": ["management-result-qa", "lab-result-qa",
                    "engineering-chief-readiness-result", "oncall-action-documents-out"],
    "OPS.ALERT": ["management-result-operations", "oncall-action-quality-out",
                  "oncall-action-self-out"],
    "OPS.ROUTE": ["oncall-action-alert-out", "oncall-action-scope-out"],
    "OPS.RECOVERY": ["engineering-chief-incident-result", "management-result-qa",
                     "management-result-operations"],
    "OPS.DAILY": ["management-result-operations", "oncall-action-alert-out",
                  "oncall-action-route-out", "oncall-action-recovery-out",
                  "oncall-action-quality-out", "oncall-action-inputs-out",
                  "oncall-action-self-out"],
    "OPS.SEND": ["oncall-action-daily-out"],
    "OPS.FEEDBACK": ["oncall-action-receive-daily-out"],
    "OPS.PERIOD": ["oncall-action-daily-out", "oncall-action-feedback-out",
                   "oncall-action-alert-out", "oncall-action-recovery-out"],
    "OPS.SELF": ["oncall-action-inputs-out", "oncall-action-scope-out"],
}
for code, source_ids in mapping.items():
    action = actions[code]
    action["inputs"] = [inp(i) for i in source_ids]
    action["acceptance"] = (
        "Результат по purpose и commonProcedure.acceptance; "
        "версия/период/окружение/источник обязательны."
    )
    action["returns"] = (
        "По commonProcedure.returns: поле, поставщик, версия; "
        "ожидает ответа, срок не утверждён."
    )
    action["controller"] = "head-engineering: последующий выборочный контроль"
    action["timezone"] = "America/Denver" if code in ["OPS.DAILY", "OPS.PERIOD"] else None
    action["nextAction"] = None

actions["ENG.REG.8"]["inputs"] = [
    i for i in actions["ENG.REG.8"]["inputs"] if i["sourceId"] != "head-engineering"
] + [inp("oncall-action-scope-out"), inp("oncall-action-inputs-out")]
actions["ENG.REG.8"]["procedure"] += (
    " Явный результат: таблица каждого звена утверждённой карты: звено→ожидалось→факт→"
    "статус→доказательство→observedAt→сборка/окружение. Статусы: работало / сбой / "
    "задержка / выключено / нет данных / не проверено. Нет карты, данных, свежести "
    "или полного охвата — общий зелёный запрещён. Неактивированное наблюдение не зелёное."
)
release = actions["ENG.REG.7"]
release.update({
    "client": "head-engineering", "recipient": "engineering-chief-release-review",
    "acceptor": "head-engineering", "nextAction": "engineering-chief-release-review",
    "procedure": "Подготовить комплект выпуска: QA, совместимость, резервирование, "
                 "миграции и откат; проверить его комплектность, передать ENG.CHIEF.7. "
                 "HEAD.07 отдельно принимает техническую готовность. "
                 "Публикация/TestFlight только по отдельному решению владельца; "
                 "P.OPS не принимает собственный выпуск и не публикует.",
    "releaseDecisionBy": "owner",
})
# A readiness response is not an initial input to preparing the same package.
release["inputs"] = [i for i in release["inputs"]
                     if i["sourceId"] not in ["engineering-chief-release-review",
                                               "engineering-chief-release-review-result"]]
actions["ENG.REG.8"]["nextAction"] = None
actions["OPS.SCOPE"].update({
    "client": ROLE, "recipient": "management-action-operations",
    "acceptor": "product-manager-specialist", "nextAction": "management-action-operations",
})
actions["OPS.SCOPE"]["procedure"] += (
    " Актуальные документы: DOC-TALKHINT-PRODUCT-PASSPORT, DOC-TALKHINT-TECHNICAL-PASSPORT, "
    "реестр действий текущей операционной версии и список выпусков из ENG.REG.7. "
    "Отсутствующие карта/критерии возвращаются продукту/технике; карта пока не утверждена."
)
actions["OPS.DOCUMENTS"]["recipient"] = "oncall-action-inputs"
actions["OPS.INPUTS"]["recipient"] = "management-action-operations"
actions["OPS.QUALITY"]["recipient"] = "oncall-action-daily"
actions["OPS.SELF"]["recipient"] = "oncall-action-daily"
for code in ["OPS.DOCUMENTS", "OPS.INPUTS", "OPS.QUALITY", "OPS.SELF"]:
    actions[code]["client"] = ROLE
    actions[code]["acceptor"] = "head-engineering: последующий выборочный контроль"
actions["OPS.ALERT"].update({
    "recipient": "owner", "client": "owner",
    "acceptor": None,
    "acceptance": "Подтверждение транспорта SENT с provider ID либо ошибка/unknown; "
                  "приёмка инженерией не нужна для регистрации факта и сигнала. "
                  "SENT не означает прочтение, исправление или приёмку владельца.",
    "nextAction": "oncall-action-route",
})
actions["OPS.ALERT"]["procedure"] += (
    " Срабатывать только на подтверждённый сбой/просрочку известного ожидания "
    "из ENG.REG.8, QUALITY или SELF. Нормальный результат проверки не инцидент. "
    "Сигнал напрямую владельцу; HEAD.07 получает задачу исправления, не право скрыть сигнал."
)
actions["OPS.ROUTE"]["nextAction"] = "oncall-action-recovery"
actions["OPS.ROUTE"]["recipient"] = "engineering-chief-incident"
actions["OPS.ROUTE"]["procedure"] += (
    " Переход к RECOVERY только после фактического ответа/нового события, "
    "не автоматическое закрытие инцидента."
)
actions["OPS.RECOVERY"]["acceptor"] = "lg-qa-role: независимый вердикт; не P.OPS"
actions["OPS.RECOVERY"]["recipient"] = "oncall-action-daily"
actions["OPS.RECOVERY"]["procedure"] += (
    " Новый успешный переход и вердикт ENG.REG.6 относятся к тому же инциденту/версии. "
    "P.OPS сверяет доказательства, не подменяет независимую QA. "
    "Подтверждение восстановления не закрывает продуктовую жалобу без её приёмки."
)
actions["OPS.DAILY"].update({
    "client": "owner", "recipient": "oncall-action-send",
    "acceptor": "head-engineering: выборочно после отправки",
    "nextAction": "oncall-action-send",
    "trigger": "Ежедневно 08:00 America/Denver за предыдущий местный календарный день; "
               "сейчас только описание, расписание не запущено",
    "deadline": "08:00 America/Denver", "timezone": "America/Denver",
})
actions["OPS.DAILY"]["procedure"] += (
    " В письме ровно четыре блока формы v2: светофор, открытые инциденты, "
    "что выпущено, чего не хватает. detailRows и план-факт по ссылке; "
    "критические ограничения видны сразу. Отсутствующие отчёты отделов не блокируют сводку."
)
actions["OPS.SEND"]["acceptor"] = None
actions["OPS.SEND"]["nextAction"] = "oncall-action-feedback"
actions["OPS.SEND"]["procedure"] = (
    "Принять сохранённый OPS.DAILY.OUT, проверить разрешённый адрес в защищённой настройке "
    "и выданный P.OPS Gmail-канал. Сейчас не отправлять. После отдельной активации: "
    "сохранить идемпотентный ключ role+period+environment+version, отправить владельцу; "
    "зафиксировать provider ID/SENT, ambiguous→unknown, не слепой повтор. "
    "HEAD.07 получает ссылку в существующей передаче T07, новый почтовый адрес не вводить. "
    "Содержательная проверка последующая, не блокирует отправку."
)
actions["OPS.FEEDBACK"]["procedure"] += (
    " Реальный отзыв владельца допустим как вход из журнала, не выдумывать событие. "
    "Нет отзыва — ожидание, не зависание отправки и не автоматический переход PERIOD."
)
actions["OPS.PERIOD"]["recipient"] = "management-action-report-engineering-week"
actions["OPS.PERIOD"]["recipientActions"] = [
    "management-action-report-engineering-week", "management-action-report-engineering-month"]
actions["OPS.SELF"]["procedure"] += (
    " Health, heartbeat и транспорт — отдельные доказательства, не наличие файла кода. "
    "Пока внешний контроль не выдан: «внешнего контроля нет». "
    "Страница /health в production защищена; 401/страница входа не зелёный health."
)
for code in ["OPS.SELF", "OPS.SEND", "OPS.ALERT"]:
    actions[code]["requiredEvidence"] = (
        "checkedAt/окружение/источник и статус; подтверждения транспорта отдельны. "
        "Отсутствующий доступ — blocked/не проверено."
    )

packet["flows"] = [
    {"id": "observation", "name": "Наблюдение", "entry": "OPS.SCOPE",
     "steps": ["OPS.SCOPE", "ENG.REG.8"],
     "parallel": ["OPS.QUALITY", "OPS.SELF"],
     "support": ["OPS.DOCUMENTS", "OPS.INPUTS"],
     "output": "Таблица каждого звена с доказательством; не общий зелёный без карты"},
    {"id": "incident", "name": "Авария", "entry": "Подтверждённый сбой, не любая проверка",
     "sources": ["ENG.REG.8", "OPS.QUALITY", "OPS.SELF"],
     "steps": ["OPS.ALERT", "OPS.ROUTE", "OPS.RECOVERY"],
     "condition": "RECOVERY ждёт реальный ответ и доказательство; не цикл повторов"},
    {"id": "report", "name": "Отчёт", "entry": "08:00 America/Denver",
     "steps": ["OPS.DAILY", "OPS.SEND", "OPS.FEEDBACK"],
     "periodicBranch": ["OPS.PERIOD", "T07.REPORT.WEEK", "T07.REPORT.MONTH"],
     "condition": "Нет входа → неизвестно+поставщик, не ждать весь отдел"},
]
packet["otherResponsibilities"] = {
    "release": ["ENG.REG.7"], "existingLabTransport": ["LAB.MAIL.SEND"],
    "rule": "Прежние обязанности сохраняются вне трёх потоков; LAB.MAIL.SEND не меняется",
}
packet["openDecisions"] = [
    "Карта всех ожидаемых событий/порогов/источников ещё не утверждена",
    "Исполнитель P.OPS и выдача ресурсов не подтверждены",
    "Независимый внешний монитор/резервный канал не подключены",
    "Сроки ответов и приёмки поставщиков неизвестны",
    "Предложения KPI 100% ещё не утверждены",
    "Неделя/месяц: точный час передачи неизвестен; Denver, без сложения дневных процентов",
    "Ручной проход v3 и отдельная активация ещё впереди",
]
packet["decisions"] = [{
    "id": "owner-ops-daily-time-2026-10-27", "status": "согласовано владельцем",
    "value": "08:00 America/Denver; предыдущие сутки по Denver, DST",
    "source": "Прямое решение владельца 27.10.2026; replit.md v3 §6",
    "runtimeEnabled": False,
}]
packet["trialProtocol"] = [{
    "actionId": a["id"], "status": "не выполнено в версии 3",
    "evidence": None, "result": None, "missingInputOrResource": None,
    "requestSupplier": None, "recipientResponse": None, "acceptance": None,
} for a in packet["actions"]]
for resource in packet["resourceRequirements"]:
    resource["issuedToRole"] = False
    resource["access"] = "Read-only; секреты только в защищённых настройках"
    if resource["id"] == "oncall-resource-events":
        resource["readiness"] = "Первым проверить чтение Hint; код watchdog есть, доступ P.OPS/runtime не подтверждены"
    elif resource["id"] in ["oncall-resource-mail", "lab-resource-mail"]:
        resource["readiness"] = "В лаборатории описан Gmail self-mail; выдача P.OPS не подтверждена"
    elif resource["id"] == "oncall-resource-external":
        resource["readiness"] = "Нет; см. OWNER-OPS-EXTERNAL-CONTROL"
packet["resourceIssuanceOrder"] = ["oncall-resource-events", "oncall-resource-mail",
                                  "oncall-resource-documents", "oncall-resource-external"]

receivers = {a["id"]: a for a in packet["receivingActions"]}
for a in receivers.values():
    a["procedure"] = nodes[a["id"]]["procedure"]
receivers["oncall-action-receive-daily"]["procedure"] = (
    "Выборочно после отправки проверить четыре блока и подробную форму v2: период, "
    "окружение, охват и доказательства; принять или вернуть P.OPS конкретные замечания. "
    "Не задерживать сигнал/письмо и не объявлять молчание приёмкой."
)
for period in ["week", "month"]:
    rid = f"management-action-report-engineering-{period}"
    receivers[rid] = {
        "id": rid, "code": nodes[rid]["code"], "role": nodes[rid]["roleId"],
        "inputSources": ["oncall-action-period-out"],
        "procedure": "Принять вклад P.OPS: проверить границы периода, окружение, версии, "
                     "уникальные результаты, знаменатели и неизвестные. Включить в "
                     "существующую сводку T07 и передать координатору по прежней связи; "
                     "иначе вернуть конкретные замечания P.OPS. Пока ответа нет.",
        "acceptance": "Источники/период/методика согласованы; фактическая приёмка записана",
        "returns": "Недостающие поля и адресный возврат, молчание не приёмка",
    }
receivers["engineering-chief-release-review"] = {
    "id": "engineering-chief-release-review", "code": "ENG.CHIEF.7", "role": "head-engineering",
    "inputSources": ["management-result-release"],
    "procedure": "Независимо от подготовки P.OPS проверить техническую готовность комплекта: "
                 "QA, миграции, совместимость, резервирование, откат. "
                 "Записать технический вердикт/возврат; не подменять решение владельца Publish/TestFlight.",
    "acceptance": "Технические основания подтверждены, ограничения и версия указаны",
    "returns": "Конкретный дефект/недостающий документ обратно ENG.REG.7",
}
receivers["management-action-impact"] = {
    "id": "management-action-impact", "code": "PRD.REG.3",
    "role": "product-manager-specialist", "inputSources": ["oncall-action-scope-out"],
    "procedure": "Сверить границы карты с текущим продуктом и ожиданиями; "
                 "принять область контроля или вернуть P.OPS конкретный разрыв. "
                 "Принятие карты не доказывает подключённые источники/активное дежурство.",
    "acceptance": "Явный вердикт о достаточности карты, версия и ограничения",
    "returns": "Конкретные пропущенные режимы/ожидания, приёмку не имитировать",
}
packet["receivingActions"] = list(receivers.values())

form = copy.deepcopy(original_form)
form.update({"version": 2, "documentId": FORM,
             "status": "Кандидат после прохода; не применено и не принято"})
form["header"].update({"timezone": "America/Denver", "deliveryHour": "08:00",
                       "periodRule": "Предыдущий календарный день [00:00,00:00), DST; не фиксированные 24 часа"})
form["shortReport"] = {
    "systemTrafficLight": [],
    "openIncidents": [],
    "released": [],
    "missing": [],
}
form["shortReportRules"] = {
    "blocks": ["Светофор по системам", "Открытые инциденты", "Что выпущено", "Чего не хватает"],
    "detailLink": None,
    "criticalLimitations": "Всегда видны в shortReport.missing, не только по ссылке",
    "planFact": "В detailRows; общую бизнес-сводку компании не дублировать",
}
form["rules"] = [
    "Письмо — 4 блока; детали, план-факт, расчёты и источники по ссылке.",
    "Неизвестное=null+причина, не 0. SENT не прочитано/принято.",
    "Час принят; активация расписания отдельная. Локальный день может длиться 23/25 часов.",
    "100% только с известным положительным знаменателем утверждённой карты.",
]
form["coverageMap"] = {
    "ownerRoleId": ROLE, "scopeActionId": "oncall-action-scope",
    "approved": False, "approvedAt": None, "approvedBy": None,
    "statusVocabulary": ["работало", "сбой", "задержка", "выключено", "нет данных", "не проверено"],
    "eventRow": {
        "expectedActionId": None, "resultId": None, "expectedEvent": None,
        "supplierRoleId": None, "source": None, "environment": None, "build": None,
        "expectedAt": None, "actualAt": None, "observedAt": None,
        "threshold": None, "thresholdBasis": None, "status": "не проверено",
        "evidence": None, "received": False,
    },
    "systems": [{"name": name, "status": "не проверено", "sourceConnected": None,
                 "lastObservedAt": None, "evidence": None,
                 "codeEvidence": "server/callLab/watchdog.ts" if name == "Hint" else None,
                 "limitation": "Код не доказывает активный production-контроль"}
                for name in ["Hint", "Катя", "Translator", "Prepare", "History",
                             "Copilot", "web", "iOS", "лаборатории", "crew"]],
    "domains": packet["documentationInputs"],
    "greenPolicy": "Только актуальные доказательства всех ожидаемых звеньев утверждённой "
                   "карты данного периода/окружения; иначе частично/не проверено",
    "technicalThresholds": {
        "source": "server/callLab/watchdog.ts:7-10",
        "pollMs": 15000, "missingEventMs": 60000, "queuedMs": 120000,
        "analysisMs": 660000, "mailMs": 120000,
        "status": "Прочитанный код Dev Hint, не новые нормативы и не проверка runtime",
    },
    "externalFallback": {"resourceId": "oncall-resource-external",
                         "state": "не подключён", "requestId": "OWNER-OPS-EXTERNAL-CONTROL"},
}
form["metricDefinitions"] = [
    {"name": "Покрытие контроля",
     "numerator": "Ожидаемые звенья утверждённой карты с актуальной фактической проверкой",
     "denominator": "Все ожидаемые звенья той же карты, периода и окружения",
     "formula": "100*n/d", "unit": "%", "target": None,
     "targetProposal": 100, "targetStatus": "предложено, не утверждено"},
    {"name": "Сигналы владельцу",
     "numerator": "Уникальные инциденты с подтверждённым SENT",
     "denominator": "Все обнаруженные уникальные инциденты, требующие сигнала в периоде",
     "formula": "100*n/d", "unit": "%", "target": None,
     "targetProposal": 100, "targetStatus": "предложено, не утверждено"},
    {"name": "План-факт завершений", "numerator": "Подтверждённые завершения",
     "denominator": "Ожидаемые завершения того же периода", "formula": "100*n/d",
     "unit": "%", "target": None},
    {"name": "Приёмка с первого раза",
     "numerator": "Явно принятые с первого рассмотрения результаты без возврата",
     "denominator": "Результаты с завершённым первым рассмотрением; ожидание отдельно",
     "formula": "100*n/d", "unit": "%", "target": None},
    {"name": "Открытые разрывы", "unit": "шт.", "target": None,
     "fields": ["incidentId", "age", "supplier", "lastStep", "nextAction", "evidence"],
     "rule": "Инциденты и недостающие входы отдельно; возраст, не фиктивный %"},
]
form["calculationRules"] = {
    "percent": "Если d неизвестен/0 или карта не утверждена — null+причина; не 0%/100%",
    "latency": "Обнаружение→сигнал и сигнал→восстановление отдельно, по timestamp",
    "deduplication": "resultId+version+environment; incidentId; дневные проценты не суммировать",
    "periods": "Сопоставимые периоды и границы America/Denver; DST",
}
form["periodicReports"] = {
    "commonFields": ["periodStart", "periodEnd", "timezone", "environment", "sourceRevision",
                     "uniqueResultIds", "plan", "fact", "accepted", "returned",
                     "unknown", "evidence", "decisions", "next"],
    "week": {"source": "oncall-action-period-out",
             "receivingActionId": "management-action-report-engineering-week",
             "extra": ["Отклонения/повторы", "Сравнение с сопоставимой предыдущей неделей",
                       "Решения", "Следующая неделя"], "submissionTime": None},
    "month": {"source": "oncall-action-period-out",
              "receivingActionId": "management-action-report-engineering-month",
              "extra": ["Изменения продукта/качества", "Нововведения/предложения",
                        "Пробелы ресурсов", "Финансовые входы либо неизвестно",
                        "Ссылки на выводы бенчмарка", "Прогноз с допущениями"],
              "submissionTime": None},
    "company": "Прежние T07 → координатор → общая сводка; P.OPS не выполняет чужую аналитику",
}
external_request = {
    "id": "OWNER-OPS-EXTERNAL-CONTROL", "status": "проект запроса, не отправлен/не исполнен",
    "what": "Разрешить регистрацию независимого внешнего монитора и канал тревоги",
    "why": "Локальный watchdog не может гарантировать сигнал при отказе своего сервера/БД/Gmail",
    "candidate": {"name": "UptimeRobot", "url": "https://uptimerobot.com/pricing/",
                  "checkedAt": packet["metadata"]["snapshotAt"],
                  "evidence": "sources/UptimeRobot_pricing_excerpt.txt",
                  "publicOffer": "На странице Free $0 и интервал 5 минут, SMS/voice за отдельные кредиты",
                  "limits": "Страница описывает Free как personal monitoring; применимость "
                            "для TalkHint/возможности каналов ещё не подтверждены",
                  "approved": False},
    "preconditionsByHead07": [
        "Проверить применимость бесплатного тарифа к проекту; не обещать бесплатный SMS",
        "Получить фактический production URL/health-проверку и проверить права/безопасность",
        "Владелец прохода упомянул talkhint.app; это не проверка актуального published URL",
        "/health и /api/health в production защищены: нельзя считать вход/401 исправностью",
        "Не расширять публичный доступ; если нужен токен, только Secrets и отдельное разрешение",
        "Подобрать независимый резерв при отказе Gmail; email в тот же ящик не решает его отказ",
    ],
    "ownerStepsAfterPreflight": [
        "Получить от HEAD.07 готовую рекомендацию, URL и ограничения",
        "Дать да/нет; при да зарегистрироваться самому на выбранном разрешённом тарифе",
        "Указать разрешённый канал тревоги и вернуть подтверждение без секретов",
    ],
    "cost": "Free заявлен $0; покупка SMS/подписки не разрешена, стоимость резерва неизвестна",
    "targets": [{"url": None, "suppliedBy": "head-engineering", "verified": False}],
    "answer": None, "resourceIssued": False,
}
packet["ownerRequests"] = [external_request]
packet["internalRequests"] = [
    {"id": "OPS-INPUT-COVERAGE", "toRole": "head-engineering",
     "receivingActionId": "engineering-chief-incident",
     "question": "Дать версионную карту ожидаемых событий/порогов, production URL, разрешённые источники "
                 "и доказательства доступа Hint; прочие режимы отдельно",
     "status": "проект передачи", "response": None},
    {"id": "OPS-INPUT-PRODUCT-SCOPE", "toRole": "product-manager-specialist",
     "receivingActionId": "management-action-impact",
     "question": "Сверить/утвердить границы карты с текущей книгой; неизвестные режимы не зелёные",
     "status": "проект передачи", "response": None},
    {"id": "OPS-INPUT-QA", "toRole": "lg-qa-role",
     "receivingActionId": "management-action-qa",
     "question": "Дать реальные QA-артефакты и независимые вердикты по относящимся версиям",
     "status": "проект передачи", "response": None},
]

# Propose changes on existing nodes only. No duplicate roles/results/catalogues.
node_changes = {}


def stage_node(node_id, after):
    if node_id in node_changes:
        node_changes[node_id]["after"] = after
    elif after != nodes[node_id]:
        node_changes[node_id] = {"id": node_id, "before": nodes[node_id], "after": after}


for action in packet["actions"]:
    if action["code"] == "LAB.MAIL.SEND":
        continue
    before = nodes[action["id"]]
    after = copy.deepcopy(before)
    after.update({
        "procedure": action["procedure"], "inputs": [
            {"name": i["name"], "sourceId": i["sourceId"], "freshness": i["freshness"]}
            for i in action["inputs"]],
        "nextId": action["nextAction"],
        "success": action["acceptance"], "exceptions": action["returns"],
        "clientId": action["client"], "recipientId": (
            "head-engineering" if action["code"] == "OPS.PERIOD" else action["recipient"]),
        "acceptorId": (
            None if action["acceptor"] is None else
            action["acceptor"].split(":")[0]),
    })
    after["schedule"] = {**after.get("schedule", {}), "trigger": action["trigger"],
                         "timezone": action["timezone"] or "",
                         "deadline": action["deadline"] or ""}
    if after.get("reporting", {}).get("templateDocumentId") == FORM:
        after["reporting"]["templateVersion"] = "2"
    stage_node(after["id"], after)
for receiver in packet["receivingActions"]:
    if receiver["id"] not in ["oncall-action-receive-daily",
                              "engineering-chief-release-review",
                              "management-action-impact",
                              "management-action-report-engineering-week",
                              "management-action-report-engineering-month"]:
        continue
    after = copy.deepcopy(nodes[receiver["id"]])
    after["procedure"] += "\nКандидат исправлений P.OPS v3: " + receiver["procedure"]
    for result_id in receiver["inputSources"]:
        if not any(i.get("sourceId") == result_id for i in after["inputs"]):
            after["inputs"].append({"sourceId": result_id, "name": nodes[result_id]["name"],
                                    "freshness": "Версия/период/окружение/доказательства"})
    stage_node(after["id"], after)
after_role = copy.deepcopy(nodes[ROLE])
after_role["questions"] = "; ".join(packet["openDecisions"])
after_role["referenceIds"] = list(dict.fromkeys(after_role["referenceIds"] + [PACKET, FORM]))
stage_node(ROLE, after_role)

proposed_links = copy.deepcopy(data["links"])
for change in node_changes.values():
    old, new = change["before"], change["after"]
    if old.get("kind") != "action":
        continue
    old_next = old.get("nextId")
    if old_next and old_next != new.get("nextId"):
        proposed_links = [l for l in proposed_links if not
                          (l["from"] == old["id"] and l["to"] == old_next and
                           l["kind"] in ["next", "sequence"])]
    # Remove obsolete requires on a role instead of an actual result.
    valid_sources = {i.get("sourceId") for i in new["inputs"]} | set(new["resourceIds"])
    proposed_links = [l for l in proposed_links if not (
        l["from"] == old["id"] and l["kind"] == "requires" and
        l["to"] not in valid_sources)]
    for i in new["inputs"]:
        source_id = i["sourceId"]
        if not any(l["from"] == old["id"] and l["to"] == source_id and
                   l["kind"] == "requires" for l in proposed_links):
            proposed_links.append({"id": f"pops-v3:requires:{old['id']}:{source_id}",
                                   "from": old["id"], "to": source_id, "kind": "requires",
                                   "reason": "Кандидат P.OPS: конкретный результат, применимость по событию"})
for code, recipient in [
    ("OPS.SCOPE", "management-action-operations"), ("OPS.ALERT", "oncall-action-route"),
    ("OPS.ROUTE", "engineering-chief-incident"), ("OPS.DAILY", "oncall-action-send"),
    ("OPS.PERIOD", "management-action-report-engineering-week"),
    ("OPS.PERIOD", "management-action-report-engineering-month"),
    ("ENG.REG.7", "engineering-chief-release-review"),
]:
    source_id = actions[code]["results"][0]
    if not any(l["from"] == source_id and l["to"] == recipient and
               l["kind"] == "handoff" for l in proposed_links):
        proposed_links.append({"id": f"pops-v3:handoff:{source_id}:{recipient}",
                               "from": source_id, "to": recipient, "kind": "handoff",
                               "reason": "Кандидат передачи; событие/ответ ещё не получены"})

patch = {
    "format": "talkhint.ops.review-patch", "version": 2, "status": "не применено",
    "guards": {"revision": state["revision"], "operatingVersion": operating["version"],
               "sourceSnapshotSha256": sha(BASE.read_bytes()),
               "documents": {i: sha(documents[i]["text"].encode()) for i in [PACKET, FORM]}},
    "documentUpdates": [
        {"id": PACKET, "fromVersion": 2, "toVersion": 3,
         "candidateFile": "P-OPS_work_package_v3_CANDIDATE.json"},
        {"id": FORM, "fromVersion": 1, "toVersion": 2,
         "candidateFile": "P-OPS_daily_report_v2_CANDIDATE.json"}],
    "nodeUpdates": list(node_changes.values()),
    "linkUpdates": {
        "removed": [l for l in data["links"] if l not in proposed_links],
        "added": [l for l in proposed_links if l not in data["links"]],
    },
    "application": "Только после да: перечитать модель, сверить guards; при расхождении "
                   "пересобрать diff. Сохранить прежние ID, полную историю и исходный проход "
                   "через штатный версионированный импорт. Никаких расписаний/почты/production.",
}
write("P-OPS_work_package_v3_CANDIDATE.json", packet)
write("P-OPS_daily_report_v2_CANDIDATE.json", form)
write("ops.review.patch.json", patch)
write("OWNER-OPS-EXTERNAL-CONTROL.json", external_request)

# Resolve shared inputs once instead of repeating their long descriptions in
# every action. The candidate remains executable without fetching chat history.
packet["inputCatalog"] = {}
for action in packet["actions"]:
    if action["code"] == "LAB.MAIL.SEND":
        continue  # Preserve this pre-existing transport contract byte-for-byte.
    refs = []
    for source in action["inputs"]:
        source_id = source["sourceId"]
        if source_id not in packet["inputCatalog"]:
            record = copy.deepcopy(source)
            if "supplierRoleId" not in record:
                if nodes[source_id]["kind"] == "result":
                    action_id, role_id = supplier(source_id)
                    record.update({"supplierActionId": action_id, "supplierRoleId": role_id})
                else:
                    record.update({"supplierActionId": None,
                                   "supplierRoleId": nodes[source_id].get("roleId", source_id)})
            record["freshness"] = "Версия, период, окружение и источник; см. commonProcedure"
            packet["inputCatalog"][source_id] = record
        refs.append({"sourceId": source_id, "inputRef": f"#/inputCatalog/{source_id}"})
    action["inputs"] = refs
for receiver in packet["receivingActions"]:
    if receiver["id"] in ["engineering-chief-incident", "management-action-qa",
                           "management-action-report-engineering-day"]:
        # These unchanged receiving procedures are already in the model. Keep
        # concrete operating instructions here, not a second copy of all of T07.
        receiver["existingProcedureRef"] = receiver["id"]
        receiver["procedure"] = (
            "Принять относящийся вход, проверить версию/окружение и доказательства; "
            "вернуть конкретный недостаток поставщику либо записать фактический ответ. "
            "Не подменять чужой вердикт, не блокировать оперативный сигнал владельцу."
        )
        receiver["acceptance"] = "Фактический ответ/вердикт с доказательством"
        receiver["returns"] = "Конкретное поле и адресный возврат; молчание не приёмка"
# The existing form also owns the coverage map and its input register. Keeping
# their single canonical definition avoids exceeding the model's 50k text limit.
form["inputCatalog"] = packet.pop("inputCatalog")
packet["inputCatalogRef"] = {
    "documentId": FORM, "version": 2, "pointer": "/inputCatalog",
    "reviewFile": "P-OPS_daily_report_v2_CANDIDATE.json",
}
packet["documentationInputs"] = {
    "documentId": FORM, "pointer": "/coverageMap/domains",
    "rule": "Все 10 реальных поставщиков и ID их результатов в единственной карте контроля",
}
form["coverageMap"]["resourceRegister"] = packet["resourceRequirements"]
packet["resourceRequirements"] = {
    "documentId": FORM, "pointer": "/coverageMap/resourceRegister",
    "rule": "Назначение, выдающий, доступность и проверка каждого прежнего ресурса",
}
for action in packet["actions"]:
    for source in action["inputs"]:
        if "inputRef" in source:
            source["inputRef"] = FORM + source["inputRef"]
write("P-OPS_work_package_v3_CANDIDATE.json", packet)
write("P-OPS_daily_report_v2_CANDIDATE.json", form)

for filename, before, after in [
    ("P-OPS_work_package.diff", original, packet),
    ("P-OPS_daily_report.diff", original_form, form),
]:
    write(filename, "".join(difflib.unified_diff(
        json.dumps(before, ensure_ascii=False, indent=2).splitlines(True),
        json.dumps(after, ensure_ascii=False, indent=2).splitlines(True),
        fromfile="stored", tofile="candidate")))

write("sources/UptimeRobot_pricing_excerpt.txt",
      "Источник: https://uptimerobot.com/pricing/\nПроверено: " +
      packet["metadata"]["snapshotAt"] +
      "\nКраткие наблюдения: Free указан $0, интервал 5 минут; "
      "SMS/voice-кредиты отдельно. Free описан как personal monitoring. "
      "Коммерческая применимость/резервный канал ещё не подтверждены. "
      "Это сведения страницы, не выбранный тариф и не договор.\n")

# Offline checks, including failure cases and local calendar boundaries.
checks = []


def check(name, condition):
    assert condition, name
    checks.append({"name": name, "passed": True})


check("Все 15 ID сохранены в прежнем порядке",
      [a["id"] for a in packet["actions"]] == [a["id"] for a in original["actions"]])
check("Старый проход сохранён, v3 не принят",
      review["manualPass"]["verdict"] == "принять с исправлениями" and
      packet["manualPass"]["verdict"] is None)
check("Нет самоприёмки ENG.REG.7", actions["ENG.REG.7"]["acceptor"] == "head-engineering")
check("LAB.MAIL.SEND не изменён", actions["LAB.MAIL.SEND"] == next(
    a for a in original["actions"] if a["code"] == "LAB.MAIL.SEND"))
check("Три потока", len(packet["flows"]) == 3)
check("Нет QUALITY→ALERT и PERIOD→SELF как обязательных next",
      actions["OPS.QUALITY"]["nextAction"] is None and actions["OPS.PERIOD"]["nextAction"] is None)
check("Нет общих входов head-engineering",
      not any(i["sourceId"] == "head-engineering" for a in packet["actions"] for i in a["inputs"]))
check("Источники всех действий существуют", all(
    i["sourceId"] in nodes for a in packet["actions"] for i in a["inputs"]))
check("Все новые связи ссылаются на прежние узлы",
      all(l["from"] in nodes and l["to"] in nodes for l in proposed_links))
check("Форма не дублируется в рабочем пакете",
      set(packet["dailyReportForm"]).isdisjoint({"shortReport", "detailRows"}))
check("Не присвоены ресурсы/приёмки",
      not any(r["issuedToRole"] for r in form["coverageMap"]["resourceRegister"]) and
      not any(a["recipientResponse"] for a in packet["trialProtocol"]))
check("Сигнал напрямую владельцу без шлюза инженерии",
      actions["OPS.ALERT"]["recipient"] == "owner" and actions["OPS.ALERT"]["acceptor"] is None)
check("У каждой недельной/месячной передачи есть принимающее действие",
      all(f"management-action-report-engineering-{p}" in receivers for p in ["week", "month"]))
check("Размер обоих документов <=50k символов",
      len(encoded(packet)) <= 50000 and len(encoded(form)) <= 50000)


def pct(n, d, approved):
    return 100 * n / d if approved and n is not None and d is not None and d > 0 else None


check("Нет карты/нулевой знаменатель/нет данных не 100%",
      pct(0, 0, True) is None and pct(4, 4, False) is None and pct(None, 4, True) is None)
check("Частичный охват 3/4 = 75%, не общий зелёный", pct(3, 4, True) == 75)
tz = ZoneInfo("America/Denver")
durations = []
for day in ["2026-03-08", "2026-11-01"]:
    start = datetime.fromisoformat(day).replace(tzinfo=tz)
    end = start + timedelta(days=1)
    durations.append((end.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds() / 3600)
check("Денверские сутки DST 23/25 часов", durations == [23, 25])
write("VALIDATION.json", {
    "checks": checks, "passed": len(checks),
    "documentSizesChars": {PACKET: len(encoded(packet)), FORM: len(encoded(form))},
    "runtimeChecked": False, "independentQA": False, "applied": False,
})
write("README.md", f"""# P.OPS — отдельный пакет исправлений после прохода rev800

Основание: актуальная Dev-модель rev{state['revision']}, операционная версия {operating['version']}.
Сохранено в модели сейчас: P.OPS v2 и форма v1. Здесь только кандидаты P.OPS v3 / форма v2.
Ни одна запись модели, код продукта, production, расписание и почта этим пакетом не меняются.

## Что читать
1. `01_Ответ_на_проход.md` — ответ по всем восьми пунктам.
2. `P-OPS_work_package_v3_CANDIDATE.json` — все 15 прежних действий.
3. `P-OPS_daily_report_v2_CANDIDATE.json` — единственная предлагаемая форма, карта и KPI.
4. Два `.diff` и `ops.review.patch.json` — точные изменения существующих записей.
5. `history/` — неизменённый входящий проход и прежние пакеты.

`trialProtocol` v3 пустой: повторный ручной проход ещё не выполнен. Это не независимая QA.
Файл `ops.review.patch.json` НЕ применён и не равен ранее отклонённому `ops.proposed.patch.json`.
Новый каталог ролей/документов не создаётся: файлы — снимок для сверки и однократного импорта.

## Контроль
{len(checks)} offline-проверок; все 15 ID и прежний LAB.MAIL.SEND сохранены.
Состояние runtime здесь не проверялось. Наличие кода Hint не подтверждает активацию.
Внешнего контроля нет; вопрос ресурса не закрыт и не выдан исполнителю.

## Применение — только после отдельного «да»
Перечитать Dev-модель и сравнить guards. Если ревизия изменилась — пересобрать diff,
не перезаписывать новую работу. Через штатный архивирующий импорт обновить прежние два
документа и перечисленные существующие узлы/связи. Проход v2 хранить как исторический,
не заменять им приёмку v3. Не менять книгу/roadmap/P.LAB без отдельного основания.
После применения перечитать через MCP оба документа и сверить с JSON.
Активация, регистрация сервиса, отправка письма и Publish не входят в это согласование.
""")
write("01_Ответ_на_проход.md", """# Ответ P.OPS на восемь замечаний

Все исправления ниже — в кандидате, а не в действующей модели.

1. **Цепочка и входы.** Три потока: наблюдение (SCOPE→ENG.REG.8, QUALITY/SELF
параллельно), авария (только сбой→ALERT→ROUTE→RECOVERY), отчёт
(DAILY→SEND→FEEDBACK; PERIOD отдельно→T07). DOCUMENTS/INPUTS — обеспечение,
не обязательное последовательное ожидание. Входы заменены конкретными прежними
ID результатов с производящим действием и ролью. Общих head-engineering больше нет.
Точные внешние heartbeat/health/mail-источники ещё предстоит выдать, это не результат роли.

2. **Самоприёмка.** ENG.REG.7 готовит P.OPS; техническую готовность принимает
HEAD.07 через прежнее ENG.CHIEF.7, Publish/TestFlight решает владелец. Сигнал об
инциденте напрямую владельцу, без приёмки инженером. HEAD.07 получает исправление
и проводит выборочный последующий контроль отчёта. QA восстановления остаётся независимой.

3. **Внешний канал.** OWNER-OPS-EXTERNAL-CONTROL — проект адресного запроса.
Кандидат UptimeRobot: на официальной странице Free $0 / 5 минут; SMS/voice
покупаются отдельно. Применимость условий/резервного канала ещё должна быть проверена
HEAD.07; покупки не разрешены. Production URL не установлен этим проходом.
Защищённые /health и /api/health нельзя открыть наружу или принять 401 за здоровье.
Владелец нужен на регистрации/решении, не на технической подготовке.

4. **Час.** Уже согласован владельцем: 08:00 America/Denver за предыдущий
местный календарный день. Это решение, не открытый вопрос. DST учтён;
расписание не устанавливалось.

5. **Зелёный свет.** ENG.REG.8 явно выдаёт таблицу каждого звена и шесть
статусов с доказательством/временем/окружением. Без утверждённой карты или свежих
данных — частично/не проверено. Матрица десяти систем и T01–T10 в прежней форме.

6. **Короткий отчёт.** Четыре блока: светофор, открытые инциденты, выпущенное,
недостающее. detailRows и план-факт только по ссылке; критические ограничения
обязательно видны в письме. Дневная/недельная/месячная формы в одном документе
DOC-POPS-DAILY-REPORT v2, не отдельные копии.

7. **Нормативы.** Покрытие 100% и уведомления 100% сохранены как предложения,
не утверждённые KPI. Явный знаменатель, нулевой/неизвестный→null с причиной.
Открытые разрывы — количество, возраст, поставщик без выдуманной цели.

8. **Ресурсы.** Порядок выдачи: чтение Hint, Gmail self-mail, документы/другие
режимы по подключению. Доступ лаборатории не равен доступу P.OPS; ни один ресурс
не отмечен выданным. Все реальные ответы/приёмки v3 пока пусты.

## Что остаётся
Независимый проход v3; подтверждение карты/порогов и выдачи источников; исполнитель;
внешний монитор/резерв; применить после «да»; затем отдельно разрешить активацию.
Ни одного фактического инцидента, отчёта, письма или ответа другой роли не имитировано.
""")
subprocess.run(["npx", "--no-install", "tsx", "scripts/validate-pops-review.ts"], check=True)
manifest = {str(p.relative_to(OUT)): sha(p.read_bytes())
            for p in sorted(OUT.rglob("*")) if p.is_file() and p.name != "FILES.sha256"}
write("FILES.sha256", "\n".join(f"{h}  {p}" for p, h in manifest.items()) + "\n")
target = OUT.parent / f"P-OPS_review_v3_base_rev{state['revision']}.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(OUT.rglob("*")):
        if file.is_file():
            archive.write(file, str(file.relative_to(OUT)))
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
print(encoded({"zip": str(target), "checksPassed": len(checks), "revision": state["revision"],
               "nodesProposed": len(node_changes), "actions": len(packet["actions"]),
               "packetChars": len(encoded(packet)), "formChars": len(encoded(form)),
               "applied": False}))
