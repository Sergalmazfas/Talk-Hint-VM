"""Build an approval-only ZIP from a read-only snapshot; never connects to services."""
from __future__ import annotations

import argparse
import copy
import hashlib
import html
import json
import re
import shutil
import zipfile
from collections import Counter
from pathlib import Path

SOURCE = Path("docs/reviews/operating-rules-v3")
OPS = "DOC-POPS-WORK-PACKAGE"
FORM = "DOC-POPS-DAILY-REPORT"
BOOK = "DOC-TALKHINT-PRODUCT-PASSPORT"
HINT = "DOC-TALKHINT-CHAPTER-HINT"
ROADMAP = "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d"
FEEDBACK = "DOC-HINT-OWNER-FEEDBACK-001"
FACTS = "DOC-HINT-FAST-DIALOGUE-FACTS"
DIAGNOSTIC = "DOC-HINT-COFFEE-DIAGNOSTIC"
JOURNAL = "DOC-TALKHINT-IMPROVEMENT-JOURNAL"
STATUSES = ["работало", "сбой", "задержка", "выключено", "нет данных", "не проверено"]


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def stored_text_size(value) -> int:
    """Match compact JSON.stringify and its UTF-16 string-size limit."""
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return len(text.encode("utf-16-le")) // 2


def apply_patch(document, operations):
    """Small RFC6902 subset for testing the proposed document deltas offline."""
    result = copy.deepcopy(document)
    for op in operations:
        parts = [p.replace("~1", "/").replace("~0", "~") for p in op["path"].split("/")[1:]]
        parent = result
        for key in parts[:-1]:
            parent = parent[int(key)] if isinstance(parent, list) else parent[key]
        key = int(parts[-1]) if isinstance(parent, list) else parts[-1]
        if op["op"] == "test":
            assert parent[key] == op["value"], op["path"]
        elif op["op"] in ("replace", "add"):
            if op["op"] == "replace":
                assert (isinstance(parent, list) and key < len(parent)) or key in parent
            parent[key] = copy.deepcopy(op["value"])
        else:
            raise ValueError("Unsupported operation")
    return result


def prepare(state, origin):
    docs = {d["id"]: d for d in state["documents"]}
    data = state["operatingModel"]["revisions"][-1]["data"]
    nodes = {n["id"]: n for n in data["nodes"]}
    by_code = {n["code"]: n for n in data["nodes"]}
    packet = json.loads(docs[OPS]["text"])
    form = json.loads(docs[FORM]["text"])
    feedback = json.loads(docs[FEEDBACK]["text"])
    facts = json.loads(docs[FACTS]["text"])
    diagnostic = json.loads(docs[DIAGNOSTIC]["text"])
    assert packet["version"] == 2 and form["version"] == 1, "Review baseline changed"
    assert state["revision"] == 822, "Reconcile rather than silently rebasing"
    assert by_code["P.OPS"]["id"] == "management-role-operations-specialist"

    def link(id):
        return f"{origin}/api/product-crew/documents/{id}/download?format=json"

    # The only home for report extensions is the existing P.OPS form document.
    coverage = []
    for row in packet["documentationInputs"]:
        action = nodes[row["supplierActionId"]]
        coverage.append({
            "supplierActionId": action["id"], "supplierRoleId": row["supplier"],
            "resultIds": [l["to"] for l in data["links"]
                          if l["from"] == action["id"] and l["kind"] == "produces"],
            "destinationActionId": row["destinationActionId"],
            "status": "не проверено", "receivedAt": None, "evidence": None,
            "missing": "Нужны фактические входы и выданный доступ, а не описание",
        })
    systems = []
    for name in ["Hint", "Катя", "Translator", "Prepare", "History", "Copilot",
                 "web", "iOS", "лаборатории", "crew"]:
        systems.append({
            "system": name, "status": "не проверено",
            "source": "server/callLab/watchdog.ts" if name == "Hint" else None,
            "evidenceKind": "код, не наблюдение runtime" if name == "Hint" else None,
            "scope": "owner Hint, только после активации" if name == "Hint" else "Источник контроля не подтверждён",
            "sourceConnected": None, "lastObservedAt": None,
            "supplierRoleId": "head-engineering", "requestToActionId": "engineering-chief-incident",
        })
    period_common = {
        "rowTemplateRef": "#/detailRows", "dailySourceRef": "#/shortReport",
        "fields": ["periodStart", "periodEnd", "timezone", "environment",
                   "uniqueResultIds", "plan", "fact", "accepted", "returned",
                   "unknown", "deviation", "evidence", "decisions", "next"],
        "deduplication": "По resultId+version+environment; сумма дневных процентов запрещена",
        "unknownRule": "Нет входа = null+поставщик; не 0 и не выполнено",
    }
    form_ops = [
        {"op": "test", "path": "/version", "value": 1},
        {"op": "replace", "path": "/version", "value": 2},
        {"op": "replace", "path": "/status", "value": "Кандидат доработки P.OPS, не утверждено"},
        {"op": "add", "path": "/periodicReports", "value": {
            "common": period_common,
            "week": {"sourceActionId": "oncall-action-period",
                     "recipientActionId": "management-action-report-engineering-week",
                     "extraFields": ["weekDecisions", "nextWeekPlan", "trendWithComparablePreviousPeriod"]},
            "month": {"sourceActionId": "oncall-action-period",
                      "recipientActionId": "management-action-report-engineering-month",
                      "extraFields": ["roadmapChanges", "qualityChanges", "financialInputsOrUnknown",
                                      "competitorFindingsRefs", "forecastAssumptions"]},
        }},
        {"op": "add", "path": "/coverageMap", "value": {
            "ownerRoleId": by_code["P.OPS"]["id"], "scopeActionId": "oncall-action-scope",
            "statusVocabulary": STATUSES, "domains": coverage, "systems": systems,
            "technicalPolicyEvidence": {
                "path": "server/callLab/watchdog.ts:7-10",
                "pollMs": 15000, "missingEventMs": 60000, "queuedMs": 120000,
                "analysisMs": 660000, "mailMs": 120000,
                "meaning": "Пороги имеющегося кода Hint, не новые нормативы и не доказательство работы",
            },
            "externalFallback": {"state": "не подключён", "resourceId": "oncall-resource-external"},
        }},
        {"op": "add", "path": "/metricDefinitions", "value": [
            {"name": "Покрытие", "numerator": "Ожидаемые события с проверенным источником за период",
             "denominator": "Все ожидаемые события утверждённой карты того же периода"},
            {"name": "План-факт", "numerator": "Подтверждённые завершения",
             "denominator": "Ожидаемые завершения того же периода"},
            {"name": "Приёмка с первого раза", "numerator": "Результаты с явной первой приёмкой без возврата",
             "denominator": "Результаты с завершённой первой проверкой; ожидающие показывать отдельно"},
            {"name": "Оповещение", "numerator": "Инциденты с подтверждённым SENT",
             "denominator": "Обнаруженные инциденты, требующие уведомления"},
        ]},
        {"op": "add", "path": "/calculationRules", "value": {
            "percent": "100*numerator/denominator только при известном denominator>0; иначе null с причиной",
            "latency": "Время обнаружения, уведомления и восстановления отдельно; известные timestamp и окружение",
            "target": None, "deliveryHour": None, "timezoneProposal": "America/Denver",
            "companyConsolidation": "P.OPS → T07 day/week/month → существующий координатор; источники T01–T10 по ссылкам",
            "shortLetter": "Один экран, но сбой AI/QA и ограничения доказательств не скрывать",
        }},
    ]
    packet_ops = [
        {"op": "test", "path": "/version", "value": 2},
        {"op": "replace", "path": "/version", "value": 3},
        {"op": "replace", "path": "/dailyReportForm", "value": {
            "documentId": FORM, "version": 2, "read": link(FORM),
            "sections": ["shortReport", "detailRows", "periodicReports", "coverageMap", "metricDefinitions"],
            "rule": "Канонические формы здесь; встроенная копия убрана из рабочего пакета",
        }},
        {"op": "add", "path": "/reviewBasis", "value": {
            "baseRevision": state["revision"], "ownerRequestedPassVersion": 2,
            "storedManualPassFound": bool(packet["manualPass"].get("verdict")),
            "externalManualPassSource": None,
            "status": "Проход v2 упомянут владельцем; в сохранённом manualPass результат не внесён",
            "newIndependentReviewPerformed": False,
        }},
    ]
    patched_packet = apply_patch(packet, packet_ops)
    patched_form = apply_patch(form, form_ops)
    assert patched_packet["manualPass"] == packet["manualPass"]
    assert patched_packet["trialProtocol"] == packet["trialProtocol"]
    assert stored_text_size(patched_packet) <= 50000
    assert stored_text_size(patched_form) <= 50000

    node_changes = []
    for id in ["oncall-action-scope", "oncall-action-daily", "oncall-action-period",
               "oncall-action-receive-daily"]:
        node = nodes[id]
        changes = {}
        if node.get("reporting", {}).get("templateDocumentId") == FORM:
            changes["reporting.templateVersion"] = {"before": node["reporting"]["templateVersion"], "after": "v2"}
        addition = (" Карта и общие формы: DOC-POPS-DAILY-REPORT v2, разделы coverageMap/periodicReports; "
                    "источники и неизвестные показывать явно; отдельную копию форм не вести.")
        changes["procedure"] = {"before": node["procedure"], "after": node["procedure"] + addition}
        node_changes.append({"id": id, "code": node["code"], "changes": changes})
    # Existing T07 receivers, not a parallel reporting branch or fictitious employee.
    graph_additions = []
    for period in ["week", "month"]:
        id = f"management-action-report-engineering-{period}"
        node = nodes[id]
        source = "oncall-action-period-out"
        addition = (
            " Принять периодический вклад P.OPS из oncall-action-period-out: проверить период, "
            "окружение, доказательства, числитель/знаменатель и неизвестные. При достаточности "
            "включить в прежнюю общую сводку и записать решение; иначе вернуть P.OPS "
            "конкретный вопрос, не считать ожидание приёмкой."
        )
        node_changes.append({
            "id": id, "code": node["code"],
            "changes": {"procedure": {"before": node["procedure"], "after": node["procedure"] + addition}},
            "inputAdditions": [] if any(i.get("sourceId") == source for i in node["inputs"]) else [{
                "name": "Проверяемый вклад P.OPS за соответствующий период",
                "sourceId": source,
                "freshness": "Сопоставимые границы периода, версия, окружение, ссылки и неизвестные; ответ либо адресный возврат",
            }],
        })
        for from_id, to_id, kind in [(source, id, "handoff"), (id, source, "requires"),
                                     (id, "oncall-action-period", "return")]:
            if not any(l["from"] == from_id and l["to"] == to_id and l["kind"] == kind for l in data["links"]):
                graph_additions.append({
                    "id": f"rules-review:{kind}:{from_id}:{to_id}",
                    "from": from_id, "to": to_id, "kind": kind,
                    "reason": "Проект исправления передачи P.OPS → прежний T07; не автоматический цикл",
                })

    cases = []
    for call in facts["calls"]:
        lat = call["latency"]
        cases.append({
            "caseId": feedback["id"] if "Кофейня" in call["label"] else call["callSid"],
            "sourceCallId": call["callSid"], "label": call["label"],
            "eventAt": call["startedAt"], "eventTimezoneCaveat": "Исходные timestamp без offset; локальная дата сохранена в label",
            "discoveredAt": None, "registeredAt": facts["at"],
            "registeredAtMeaning": "Дата документа фактов, не доказанная дата первого обнаружения",
            "sourceDocumentId": FACTS, "sourceVersion": facts["version"],
            "evidence": {"attempts": call["attempts"], "sentAck": lat["hintsSent"],
                         "suppressed": lat["hintsDropped"], "uiClaims": call["uiHintCount"],
                         "sttFinalToAckP50Ms": lat["e2eP50Ms"], "sttFinalToAckP95Ms": lat["e2eP95Ms"]},
            "limits": ["ACK не доказывает прочтение или использование",
                       "Нет полного аудио/STT/UI replay", "Runtime-модель звонка не устанавливалась этим пакетом"],
            "ownerUsedHints": 0 if "Кофейня" in call["label"] else None,
            "ownerEvaluationOfImplementedChange": "ждёт",
            "acceptance": None, "newRunPerformed": False,
        })
    cases.append({
        "caseId": "PROPOSED-HINT-OPENING-MANUAL-HIDE", "identityStatus": "Перед созданием найти совпадение в существующих случаях",
        "source": "ios/TalkHint/UI/InCallViewController.swift:171-172,460",
        "claim": "В Dev есть обработчик ручного скрытия первой фразы",
        "state": {"described": True, "implementedInSource": True, "verifiedOnOwnerBuild": None, "accepted": None},
        "ownerEvaluationOfImplementedChange": "ждёт", "newRunPerformed": False,
    })
    journal = {
        "format": "talkhint.improvement-journal.proposal", "version": 1,
        "status": "На согласовании, НЕ сохранено в модели",
        "proposedDocumentId": JOURNAL, "baseRevision": state["revision"],
        "role": "P.PRODUCT", "canonicalFeedbackDocumentId": FEEDBACK,
        "cases": cases, "existingWorkflow": feedback["steps"],
        "historicalDiagnostic": diagnostic,
        "commonReports": {"owner": "P.OPS", "documentId": FORM, "link": link(FORM)},
        "decisionsOrAcceptancesCreated": False, "runtimeChanged": False,
    }
    modifications = {
        "format": "talkhint.ops.proposed-patch", "version": 1,
        "status": "Не применено", "baseRevision": state["revision"],
        "baseOperatingVersion": state["operatingModel"]["revisions"][-1]["version"],
        "documents": [
            {"id": OPS, "baseTextSha256": digest(docs[OPS]["text"].encode()), "jsonPatch": packet_ops},
            {"id": FORM, "baseTextSha256": digest(docs[FORM]["text"].encode()), "jsonPatch": form_ops},
        ],
        "nodeChanges": node_changes, "linkAdditions": graph_additions,
        "preserveOtherNodesAndLinks": True,
        "copyOfReportFormsInGeneralPackage": False,
    }
    doc_ids = [OPS, FORM, BOOK, HINT, ROADMAP, FEEDBACK, FACTS, DIAGNOSTIC]
    references = [{"id": id, "title": docs[id]["title"], "url": link(id),
                   "requires": "Существующий Dev Product Crew доступ; новых доступов не создавалось",
                   "sha256": digest(docs[id]["text"].encode())} for id in doc_ids]
    return modifications, journal, references


def build(snapshot: Path, out: Path, origin: str):
    assert origin.startswith("https://") and origin.endswith(".replit.dev"), "Existing Dev origin required"
    state = json.loads(snapshot.read_text())
    before = snapshot.read_bytes()
    modifications, journal, references = prepare(state, origin)
    out.mkdir(parents=True, exist_ok=True)
    for path in SOURCE.glob("*.md"):
        shutil.copyfile(path, out / path.name)
    source_inputs = [
        Path("attached_assets/replit_md_TalkHint_rules_v2_1793142488197.pdf"),
        Path("attached_assets/Pasted--2-3--1793142494436_1793142494436.txt"),
    ]
    for i, path in enumerate(source_inputs, 1):
        shutil.copyfile(path, out / f"source-{i}{path.suffix}")
    def write_json(name, value):
        (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    write_json("ops.proposed.patch.json", modifications)
    write_json("journal.proposed.json", journal)
    write_json("canonical-links.json", references)
    docs = {d["id"]: d for d in state["documents"]}
    nodes = {n["id"]: n for n in state["operatingModel"]["revisions"][-1]["data"]["nodes"]}
    fragment = (
        "\n\n## Операционные правила и журнал улучшений\n"
        "Предлагаемый регламент replit.md v3: HEAD.07/P.PRODUCT/P.LAB/P.OPS. "
        "Единый журнал: DOC-TALKHINT-IMPROVEMENT-JOURNAL; факты и приёмка раздельно.\n"
        "Отчётность и карта дежурного — существующие DOC-POPS-WORK-PACKAGE и "
        "DOC-POPS-DAILY-REPORT; бланки здесь не копируются. "
        "Этап — согласование; применение, выдача ресурсов и запуск отдельно. "
        "Критерий: явное согласование, связность, JSON-проверки, реальные ответы принимающих. "
        "Срок/час отчёта не утверждён.\n"
    )
    linked = {
        "status": "Предложение; не записано", "baseRevision": state["revision"],
        "newDocument": {"id": JOURNAL, "title": "TalkHint — журнал улучшений — v1 — на согласовании",
                        "contentFile": "journal.proposed.json", "onlyIfNoEquivalentExistsAtApply": True},
        "roleReferences": [{
            "roleId": id, "existingIds": nodes[id]["referenceIds"],
            "addReferenceIds": [JOURNAL] if JOURNAL not in nodes[id]["referenceIds"] else [],
        } for id in ["head-engineering", "product-manager-specialist",
                     "laboratory-engineer-role", "management-role-operations-specialist"]],
        "documentAppendices": [{
            "documentId": id, "baseTextSha256": digest(docs[id]["text"].encode()),
            "baseTitle": docs[id]["title"], "appendText": fragment,
            "note": "После согласования обновить заголовок/версию и историю штатно; сам журнал не встраивать",
        } for id in [BOOK, ROADMAP]],
    }
    for item in linked["documentAppendices"]:
        assert len((docs[item["documentId"]]["text"] + item["appendText"]).encode("utf-16-le")) // 2 <= 50000
    write_json("model.proposed.links.json", linked)
    facts = json.loads(next(d for d in state["documents"] if d["id"] == FACTS)["text"])
    lab = [
        "# P.LAB — сохранённые факты, без нового выполнения",
        "",
        "Источник: DOC-HINT-FAST-DIALOGUE-FACTS v1. Это повторная выдача сохранённого "
        "снимка, не новый SELECT production, новый тест или новая QA.",
        "",
        "| Звонок | События | sent/ACK | подавлено | UI claims | p50/p95 STT final→ACK, мс |",
        "|---|---:|---:|---:|---:|---|",
    ]
    for call in facts["calls"]:
        lat = call["latency"]
        lab.append(f'| {call["label"]} | {call["attempts"]} | {lat["hintsSent"]} | '
                   f'{lat["hintsDropped"]} | {call["uiHintCount"]} | '
                   f'{lat["e2eP50Ms"]}/{lat["e2eP95Ms"]} |')
    lab += ["", "## Что установлено и что нельзя заключать", ""]
    lab.extend("- " + finding for finding in facts["findings"])
    lab += [
        "", "## Подавления по сохранённым событиям", "",
        "Ниже только события из документального снимка, не вся история сервера:",
    ]
    for call in facts["calls"]:
        reasons = Counter(h.get("dropReason", "причина отсутствует")
                          for h in call["hints"] if h.get("outcome") == "dropped")
        lab.append(f'- {call["label"]}: ' + json.dumps(reasons, ensure_ascii=False))
    lab += [
        "", "## Передача", "",
        "Получатель фактов: P.PRODUCT, прежние actions из journal.proposed.json/existingWorkflow. "
        "Вопросы причин кода — HEAD.07/P.LG.TECH; дежурство — P.OPS. "
        "Нет нового ответа получателя и нет новой приёмки.",
        "",
        "Вопросы остаются открытыми: акустическое окно быстрого ответа; полнота UI-телеметрии; "
        "причина прежнего MODEL_FAILURE. Runtime-модель звонков из default исходников не выводится.",
        "",
        "Последующий ручной диагностический проход кофейни сохранён с LAB_ANALYSIS_FAILED, "
        "QA не выполнена, новое письмо не отправлено. Он не исправляет исторический baseline.",
    ]
    (out / "LAB-evidence.md").write_text("\n".join(lab) + "\n")
    # Include a reproducible before/after diff, not a second live replit.md.
    import difflib
    old = Path("replit.md").read_text().splitlines(keepends=True)
    new = (SOURCE / "replit.candidate.md").read_text().splitlines(keepends=True)
    (out / "replit.proposed.diff").write_text("".join(difflib.unified_diff(old, new, "replit.md (current)", "replit.md (candidate v3)")))
    cards = "".join(
        f'<li><a href="{html.escape(r["url"])}">{html.escape(r["title"])}</a><br><small>{r["id"]}</small></li>'
        for r in references
    )
    (out / "links.html").write_text(
        '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        '<title>TalkHint — материалы согласования</title><style>body{font:17px system-ui;max-width:760px;'
        'margin:24px auto;padding:0 16px;line-height:1.5}li{margin:20px 0}a{display:inline-block;padding:10px;'
        'background:#e6f6f2;color:#075e52;border-radius:10px}small{overflow-wrap:anywhere}</style>'
        '<h1>TalkHint · согласование v3</h1><p>Снимок модели: rev822. Это ссылки на текущие канонические документы,'
        'не уже применённый кандидат. Они могут измениться после снимка. Новые доступы не создавались.</p>'
        '<p>P.OPS v2 и форма v1 пока действующие; предлагаемые доработки — в ops.proposed.patch.json. '
        'Нового журнала в модели пока нет.</p><ul>' + cards + '</ul></html>'
    )
    protected = [Path("replit.md"), *sorted(Path(".agents/memory").glob("*.md"))]
    operational = (SOURCE / "replit.candidate.md").read_text().split("## Краткий технический обзор")[0]
    manifest = {
        "packageVersion": "v3-review-1", "status": "На согласовании, не применено",
        "sourceRevision": state["revision"], "operatingVersion": state["operatingModel"]["revisions"][-1]["version"],
        "sourceSnapshotSha256": digest(before), "roles": ["HEAD.07", "P.OPS", "P.PRODUCT", "P.LAB"],
        "operationalWords": len(operational.split()), "operationalCharacters": len(operational),
        "pageBudget": "Около двух A4 страниц, обычный шрифт 11–12; это оценка, не измеренный PDF",
        "protectedSourceHashes": {str(p): digest(p.read_bytes()) for p in protected},
        "inputHashes": {str(p): digest(p.read_bytes()) for p in source_inputs},
        "baselineDocuments": references,
        "runtimeRuns": 0, "mailSent": False, "modelWritten": False,
        "activeRulesChanged": False, "manualPassImported": False,
    }
    write_json("manifest.json", manifest)
    assert snapshot.read_bytes() == before
    archive = out.parent / "TalkHint_rules_v3_review_rev822.zip"
    pack(out, archive)
    return archive


def pack(out, archive):
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(out.iterdir()):
            if path.is_file():
                z.write(path, path.name)
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--origin", required=True)
    args = parser.parse_args()
    print(build(args.snapshot, args.out, args.origin))
