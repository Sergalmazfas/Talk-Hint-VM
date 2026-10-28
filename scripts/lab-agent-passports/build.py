"""Build a review package from the existing model and unchanged worker; no network."""
import copy
import difflib
import hashlib
import html
import json
import subprocess
from pathlib import Path

from content import CHARACTERS, LAB_METHOD, QA_METHOD, SOURCES, STYLE

ROOT = Path("generated-artifacts/lab-agent-passports")
INDEX = "DOC-HINT-LAB-AGENT-PROMPT-PACKAGE"
BASELINE = "DOC-HINT-LAB-AGENT-PROMPTS-BASELINE"
ROLE_DOCS = {"P.LAB": "DOC-PLAB-PROMPT-PROPOSAL", "P.LG.QA": "DOC-PLG-QA-PROMPT-PROPOSAL"}


def load(path):
    return json.loads(Path(path).read_text())


def write(name, value):
    (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2))


def build():
    model = load(ROOT / "source-model.json")
    baseline = load(ROOT / "CURRENT.json")
    docs = {d["id"]: d for d in model["documents"]}
    nodes = {n["id"]: n for n in model["operatingModel"]["data"]["nodes"]}
    at = model["capturedAt"]
    method = json.loads(docs["DOC-PLAB-METHOD-RESPONSE"]["text"])
    method1 = next(r for r in method["requests"] if r["id"] == "PLAB-METHOD-1")
    trial = json.loads(docs["DOC-HINT-FAST-DIALOGUE-TRIAL"]["text"])
    historical = load("generated-artifacts/coffee-product-decisions/model-results.json")
    assert historical["revision"] == 837
    old_trial = next((d for d in historical.get("documents", [])
                      if d["id"] == "DOC-HINT-FAST-DIALOGUE-TRIAL"), None)
    old_review = json.loads(old_trial["text"]).get("manualEngineeringReview") if old_trial else None
    compact_review = old_review or trial["manualEngineeringReview"]
    compact_issue = compact_review["issues"][0]
    assert "photos" in compact_issue["text"]
    assert "REALTIME_ACCEL = 4" in Path("server/benchmark/earsHarness.ts").read_text()

    def lesson(id, title, rule, refs, date=None, scope="Hint; только при достаточном входе"):
        return {"id": id, "title": title, "documentedAt": date or at,
                "dateMeaning": "Дата источника, если известна; иначе дата документирования предложения",
                "rule": rule, "sources": refs, "scope": scope,
                "verification": "source_checked; not new experiment or independent QA",
                "ownerAcceptedAsNewLesson": False, "runtimeInjected": False}

    lessons = [
        lesson("ACK-SCREEN", "Получение не равно показу",
               "WS sent, ACK и диагностический ui_visibility — разные события. Последнее не доказывает чтение; "
               "23958 мс между отметками не считать доказанной задержкой экрана.",
               [{"file": "replit.md", "section": "6–7"},
                {"file": "workers/hint_lab/pipeline.py", "symbol": "BASE"}]),
        lesson("EARS-X4", "Ускоренный replay не real-time",
               "В описанном Ears-harness 160 байт mulaw8k = 20 мс аудио отправляются каждые 5 мс, ×4. "
               "Такие latency нельзя выдавать за реальные без отдельного замера. Не переносить вывод на все стенды.",
               [{"documentId": "DOC-PLAB-METHOD-RESPONSE", "requestId": "PLAB-METHOD-1",
                 "version": method["version"], "quote": method1["answer"], "status": method1["status"]},
                {"file": "server/benchmark/earsHarness.ts", "symbols": ["REALTIME_ACCEL", "FRAME_BYTES_MULAW"]}],
               method["checkedAt"], "Конкретный Ears harness; исторические config отдельных run неизвестны"),
        lesson("COMPACT-SPEAKER", "Скорость не оправдывает смену говорящего",
               "Компактный вариант ответил за кофейню, что фотографии получены, хотя владелец их отправлял. "
               "Проверять субъект факта и цель до продвижения варианта.",
               [{"documentId": "DOC-HINT-FAST-DIALOGUE-TRIAL", "historicalRevision": 837,
                 "historicalDocumentFound": bool(old_trial), "currentVersion": trial["version"],
                 "quote": compact_issue["text"], "reason": compact_issue["reason"],
                 "independentQA": False},
                {"file": ".agents/memory/hint-lab-release-boundary.md",
                 "section": "Граница текстового стенда быстрого диалога"}],
               trial["at"], "Ручная инженерная находка text-only coffee bench; не полная QA всех ответов"),
        lesson("QA-INDEPENDENCE", "Нельзя принимать собственный анализ за независимую QA",
               "Автор и проверяющий — отдельные агенты со свежим контекстом. Это не доказывает разные модели: "
               "текущий worker передаёт им один LLM. При сравнении кандидатов судью выбирать вне набора "
               "кандидатов; этот принцип не выдавать за уже выполненную новую проверку.",
               [{"file": "workers/hint_lab/pipeline.py", "symbols": ["run", "single_pass"]},
                {"file": "attached_assets/Pasted--CrewAI--1793216312833_1793216312833.txt",
                 "scope": "Нормативный принцип владельца; исторический стенд не перепроверен"}]),
        lesson("OWNER-STATE", "Неизвестное состояние владельца не утверждать",
               "Ответ за владельца — факт о его состоянии/действии, которого нет в цели или его репликах. "
               "Варианты на выбор, вопросы и уже сообщённые факты не являются этим нарушением.",
               [{"file": "replit.md", "section": "7"},
                {"file": "attached_assets/Pasted--CrewAI--1793216312833_1793216312833.txt",
                 "scope": "Урок, указанный владельцем; точное определение — решение владельца 27.10 в чате"}]),
        lesson("INPUT-PROVENANCE", "Путь к доказательству не заменяет его содержимое",
               "Недоступные код/скриншот/документ нельзя объявлять прочитанными. Адресный вопрос технику "
               "содержит событие, вход, нужное доказательство и получателя; вывод о причине до ответа — гипотеза.",
               [{"file": ".agents/memory/hint-lab-release-boundary.md",
                 "section": "Доказательства для независимого QA"},
                {"documentId": "DOC-PLAB-WORK-PACKAGE", "action": "LAB.INPUT.REQUEST"}]),
        lesson("UNKNOWN-SCHEMA", "Неизвестное не ноль; рубрика общая",
               "Нет проверенного reference — WER неизвестен. Нет полного usage — цена неизвестна. "
               "Нехватка данных не делает JSON невалидным. Невалидную категорию не чинить подменой на неизвестно; "
               "QA не добавляет категории, не требует вторую основную категорию и не принимает схему за факт.",
               [{"file": "workers/hint_lab/pipeline.py", "symbols": ["RUBRIC_TEXT", "BASE", "validate_findings"]}]),
        lesson("TEXT-SPEED", "Первый токен не готовая подсказка",
               "First delta и длина текста — прокси, не готовая карточка и не доказанное секундное чтение. "
               "Для переноса результата в продукт требуются проверка роли/цели, потом фактическая доставка и UX.",
               [{"file": ".agents/memory/hint-lab-release-boundary.md",
                 "section": "Граница текстового стенда быстрого диалога"}]),
    ]

    visual_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "urn:talkhint:visual-passport:v1", "title": "Общий визуальный паспорт должности",
        "type": "object", "additionalProperties": False,
        "required": ["schemaVersion", "roleId", "roleCode", "nameOptions", "selectedName", "character",
                     "portrait", "roleColor", "reportsTo", "reviewedBy", "learnedLessons", "status"],
        "properties": {
            "schemaVersion": {"const": 1}, "roleId": {"type": "string", "minLength": 1},
            "roleCode": {"type": "string", "minLength": 1},
            "nameOptions": {"type": "array", "minItems": 2, "uniqueItems": True, "items": {"type": "string"}},
            "selectedName": {"type": ["string", "null"]},
            "character": {"type": "object", "additionalProperties": False,
                          "required": ["archetype", "traits", "motto"],
                          "properties": {"archetype": {"type": "string"}, "motto": {"type": "string"},
                              "traits": {"type": "array", "minItems": 3, "maxItems": 3,
                                         "uniqueItems": True, "items": {"type": "string"}}}},
            "portrait": {"type": "object", "additionalProperties": False,
                         "required": ["image", "attributes", "styleId", "status", "asset"],
                         "properties": {"image": {"type": "string"}, "attributes": {
                             "type": "array", "minItems": 1, "items": {"type": "string"}},
                             "styleId": {"const": STYLE["id"]}, "status": {"const": "proposed"},
                             "asset": {"type": "null"}}},
            "roleColor": {"type": "object", "additionalProperties": False, "required": ["value", "status"],
                          "properties": {"value": {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"},
                                         "status": {"const": "proposed"}}},
            "reportsTo": {"$ref": "#/$defs/relationship"},
            "reviewedBy": {"type": "array", "items": {"$ref": "#/$defs/relationship"}},
            "learnedLessons": {"type": "object", "additionalProperties": False,
                              "required": ["documentId", "lessonIds"],
                              "properties": {"documentId": {"type": "string"},
                                  "lessonIds": {"type": "array", "items": {"type": "string"}, "uniqueItems": True}}},
            "status": {"const": "proposed_not_active"},
        },
        "$defs": {"relationship": {
            "type": "object", "additionalProperties": False,
            "required": ["roleId", "roleCode", "actionId", "kind", "source", "status"],
            "properties": {"roleId": {"type": ["string", "null"]}, "roleCode": {"type": ["string", "null"]},
                           "actionId": {"type": ["string", "null"]}, "kind": {"type": "string"},
                           "source": {"type": "string"}, "status": {"enum": ["model_declared", "unknown"]}},
        }},
    }
    resources = [
        {"id": "lab-resource-materials", "purpose": "Разрешённый Hint-снимок текста/телеметрии",
         "ownerId": "head-engineering", "supplier": "server/callLab/source.ts",
         "status": "implemented_source_path; production_run_not_verified_in_this_task",
         "access": "stdin JSON, owner_verified + processing_authorized; не БД из агента",
         "limits": "100000 символов сериализованного входа; неполная история, без нового аудио/видео"},
        {"id": "lab-resource-runtime", "purpose": "Модель через self-hosted CrewAI",
         "ownerId": "head-engineering", "supplier": "server/callLab/process.ts",
         "status": "implemented; no provider call in this task",
         "access": "Существующий защищённый ключ только через сервер; значение не экспортируется",
         "limits": "pin 1.15.30; max_iter=1, retries=0; два QA-возврата; схема и окончание контролируются кодом"},
        {"id": "model-resource", "purpose": "Паспорта/журнал/история прошлых попыток",
         "ownerId": "product-manager-specialist", "supplier": "Существующая модель new-country / HEAD.07",
         "status": "model_reader_verified_for_this_export; not directly granted to agents",
         "access": "Сейчас Node productContext читает журнал после AI; browser/files/DB у агентов отсутствуют",
         "limits": "Не заявлять живую память или полный доступ к документам"},
        {"id": "lab-resource-qa", "purpose": "Независимая проверка анализа",
         "ownerId": "head-engineering", "supplier": "lg-qa-role",
         "status": "implemented_separate_agent; new_independent_review_not_run",
         "access": "Снимок + результат автора; отдельный Crew, один выбранный LLM",
         "limits": "Два возврата; недоступность/разногласия не accepted"},
        {"id": "lab-resource-mail", "purpose": "Отправка владельцу",
         "ownerId": "management-role-operations-specialist", "supplier": "server outbox",
         "status": "server_only; not tested_or_used_this_task",
         "access": "Не инструмент агента; Gmail inbox не выдан",
         "limits": "Форма v4 остаётся в коде; неопределённая доставка не повторяется вслепую"},
        {"id": "proposal:verified-lesson-context", "purpose": "Ограниченный проверенный контекст из журнала",
         "ownerId": "head-engineering", "supplier": "P.PRODUCT → P.LG.QA → Node-сборщик снимка",
         "status": "proposed_not_granted", "access": "Read-only выдержки с датой/источником/версией/хешем",
         "limits": "Предложение: до 16000 символов, без молчаливого усечения и без memory=True; требует решения",
         "acceptance": "Два независимых агента получили один и тот же проверенный блок; нет чужих звонков/секретов/команд"},
        {"id": "proposal:public-doc-reader", "purpose": "Чтение документации и форумов",
         "ownerId": "head-engineering", "supplier": "Будущий ограниченный серверный reader / P.TECH",
         "status": "proposed_not_granted; availability_unchecked",
         "access": "Рекомендация: сервер получает разрешённые публичные HTTPS-страницы и передаёт выдержки, tools=[] сохраняется",
         "limits": "Предложение: allowlist, public-only DNS/IP/redirect проверки, 10с/200KB на документ, без JS, "
                   "форм, cookies, аккаунтов и платежей; содержимое недоверенное",
         "alternatives": ["A: серверные проверенные выдержки — рекомендуется",
                          "B: ограниченный fetch-tool в агенте — отдельное расширение полномочий, сейчас не разрешено"],
         "sources": [{**s, "availability": "not_fetched", "authority":
                      "secondary_unverified" if "forums" in s["url"] or "community" in s["url"] or "issues" in s["url"]
                      else "official_documentation_candidate"} for s in SOURCES],
         "budget": "В этой задаче 0 внешних вызовов; будущие API/модельные расходы и сервис не утверждены",
         "acceptance": "Источник/дата/версия/выдержка/hash доступны получателю; форум не считается спецификацией провайдера"},
    ]
    owner_requests = [{
        "id": "RESOURCE.DOCS.1", "status": "proposed_not_approved",
        "what": "После прохода паспортов одобрить подготовку ограниченного чтения публичной документации",
        "why": "Сейчас инструменты выключены, ссылка в промпте не выдаёт знания",
        "recommendation": "A — серверные выдержки + проверяемое происхождение, без браузера у агента",
        "options": ["A: подготовить reader и выдачу проверенных выдержек",
                    "B: пока HEAD.07/P.TECH готовят выдержки вручную, агенты читают только выданное"],
        "steps": ["В ручном проходе отметить A или B", "Вернуть выбранную строку в чат",
                  "HEAD.07 подготовит отдельный Dev diff/проверки; включение и расходы — отдельное решение"],
        "consequences": "Сейчас доступа/подписок/аккаунтов не прибавляется; новые регистрации и ключи не запрашиваются",
        "recipientRoleId": "head-engineering", "returnAction": "LAB.INPUT.RECEIVE",
        "budget": "Нет расходов сейчас; платный инструмент не выбран и не подключён",
    }, {
        "id": "RESOURCE.LESSONS.1", "status": "proposed_not_approved",
        "what": "После сверки одобрить отдельную подготовку read-only контекста проверенных уроков",
        "why": "История сейчас добавляется после AI; оба агента должны реально получать один блок источников",
        "recommendation": "Журнал остаётся истиной; снимок содержит только принятые подходящие выдержки",
        "steps": ["Вернуть да/нет по строке в чат", "HEAD.07 подготовит Dev diff с изоляцией владельца и версиями"],
        "consequences": "Без автоматического самозапоминания и memory=True; runtime не меняется до отдельного разрешения",
        "recipientRoleId": "head-engineering", "returnAction": "LAB.INPUT.RECEIVE",
    }]

    def relationship(role_id, action=None, kind="manager", source="operatingModel.nodes.managerId"):
        return {"roleId": role_id, "roleCode": nodes.get(role_id, {}).get("code"),
                "actionId": action, "kind": kind, "source": source,
                "status": "model_declared" if role_id in nodes else "unknown"}

    roles = []
    for code, role_id, method_text, agent_index in [
        ("P.LAB", "laboratory-engineer-role", LAB_METHOD, 0),
        ("P.LG.QA", "lg-qa-role", QA_METHOD, 1),
    ]:
        node = nodes[role_id]
        character = CHARACTERS[code]
        active_actions = ["lab-action-analyze", "lab-action-letter"] if code == "P.LAB" else ["lab-action-qa"]
        actions = [n for n in nodes.values() if n.get("kind") == "action" and n.get("roleId") == role_id]
        qa = nodes["lab-action-qa"]
        reviewed = relationship("lg-qa-role", qa["id"], "independent_analysis_review",
                                "lab-action-qa.roleId") if code == "P.LAB" else relationship(
                                    qa.get("acceptorId"), qa["id"], "selective_subsequent_control",
                                    "lab-action-qa.acceptorId; not blocking every letter")
        visual = {
            "schemaVersion": 1, "roleId": role_id, "roleCode": code,
            "nameOptions": character["nameOptions"], "selectedName": None,
            "character": {k: character[k] for k in ("archetype", "traits", "motto")},
            "portrait": character["portrait"], "roleColor": {"value": character["color"], "status": "proposed"},
            "reportsTo": relationship(node.get("managerId")), "reviewedBy": [reviewed],
            "learnedLessons": {"documentId": INDEX, "lessonIds": [l["id"] for l in lessons]},
            "status": "proposed_not_active",
        }
        lesson_text = "\n".join(f'{l["id"]} [{l["documentedAt"]}]: {l["rule"]}' for l in lessons)
        backstory = baseline["commonBackstoryVerbatim"] + "\n\n" + method_text + (
            "\nДАТИРОВАННЫЙ БЛОК УРОКОВ ЭТОГО ПРЕДЛОЖЕНИЯ\n"
            "Источники — общий пакет; это прочитанные документальные основания, не новая QA и не факты текущего звонка.\n"
        ) + lesson_text
        tasks = {
            "analysis": {
                "descriptionTemplate": "{{backstory}}\n{{author_brief}}\nВходные данные:\n{{source_json}}\n"
                    "В findings разрешены только эти event_id: {{hint_ids_json}}. Ограничения полноты/reference/latency "
                    "писать только в limitations.\nПредыдущие замечания QA:\n{{qa_feedback_json}}",
                "schemaRef": "CURRENT.json#/schemas/Analysis"},
            "qa": {
                "descriptionTemplate": "{{backstory}}\n{{qa_brief}}\nНезависимо проверь исходные данные и разбор.\n"
                    "Снимок:\n{{source_json}}\nLAB.8:\n{{replay_json}}\nРазбор:\n{{analysis_json}}",
                "schemaRef": "CURRENT.json#/schemas/QA"},
            "letter": {
                "descriptionTemplate": "{{backstory}}\nПодготовь краткие поля Letter, не SMTP-письмо. Не меняй статус QA. "
                    "Конкретное улучшение → ожидаемый эффект → варианты, если есть → рекомендация; если нужна проверка, "
                    "назови последующее исправление. Не угадывай прежние попытки без выданного журнала.\n"
                    "Разбор:\n{{analysis_json}}\nQA: {{qa_status}}\nОграничения QA:\n{{qa_issues_json}}\n"
                    "LAB.8: не выполнен. WER и цена неизвестны.",
                "schemaRef": "CURRENT.json#/schemas/Letter"},
        }
        selected_tasks = {k: tasks[k] for k in (("analysis", "letter") if code == "P.LAB" else ("qa",))}
        for t in selected_tasks.values():
            t["expectedOutput"] = baseline["expectedOutputVerbatim"]
            t["appendSchemaSuffix"] = baseline["schemaSuffixVerbatim"]
            t["nativeResponseModelRequired"] = True
        roles.append({
            "format": "talkhint.role-prompt-proposal", "version": 1, "status": "proposed_not_active",
            "documentId": ROLE_DOCS[code], "sourceRevision": model["revision"], "roleId": role_id, "roleCode": code,
            "passportRef": "DOC-PLAB-WORK-PACKAGE" if code == "P.LAB" else "operatingModel:lg-qa-role + lab-action-qa",
            "scope": "Hint-only authorised owner snapshot; existing role's broader actions are not new agent abilities",
            "goal": "Проверяемый разбор и конкретное улучшение Hint без выдуманных фактов" if code == "P.LAB"
                    else "Независимо принять доказанный разбор или вернуть конкретные нарушения",
            "clientId": "lg-qa-role" if code == "P.LAB" else "laboratory-engineer-role",
            "prompt": {"role": baseline["roles"][agent_index]["role"],
                       "goal": "Проверяемый разбор и письмо владельцу" if code == "P.LAB"
                               else "Беспристрастно проверить основания и соблюдение общей рубрики",
                       "backstory": backstory, "tasks": selected_tasks,
                       "configuration": baseline["agentConfiguration"]},
            "visualPassport": visual,
            "inputs": [
                {"name": "Разрешённый снимок", "supplierId": "head-engineering", "source": "server/callLab/source.ts",
                 "status": "implemented_path; production_not_verified"},
                *([{"name": "Результат LAB.2", "supplierId": "laboratory-engineer-role",
                    "actionId": "lab-action-analyze", "status": "per_input"}] if code == "P.LG.QA" else []),
                {"name": "Рубрика и схемы", "supplierId": "head-engineering", "source": BASELINE,
                 "status": "exported_verbatim"},
                {"name": "Проверенные уроки", "supplierId": "product-manager-specialist",
                 "source": INDEX, "status": "static_draft_here; runtime_not_injected"},
            ],
            "outputs": [
                {"name": "Analysis" if code == "P.LAB" else "QA",
                 "recipientId": "lg-qa-role" if code == "P.LAB" else "laboratory-engineer-role",
                 "acceptorId": "lg-qa-role" if code == "P.LAB" else "head-engineering",
                 "control": "Independent pass" if code == "P.LAB" else "Selective subsequent HEAD.07; not per-letter gate"},
                *([{"name": "Letter fields", "recipientId": "management-role-operations-specialist",
                    "acceptorId": "management-role-operations-specialist",
                    "control": "Transport/format only; outbox never decides QA"}] if code == "P.LAB" else []),
            ],
            "acceptance": ["Нативный JSON по неизменной схеме", "Факты имеют реально переданные основания",
                           "Неизвестное и ограничения сохранены", "Нет принятия владельцем или эффекта без его оценки"],
            "returnCriteria": ["Выдуманный факт/роль/причина", "Недопустимая категория или чужой event_id",
                               "ACK выдан за экран", "Ссылка выдана за прочитанное доказательство"],
            "knowledgeSourcesRef": INDEX + "#resources",
            "resourceIds": node.get("resourceIds", []),
            "activePipelineActionIds": active_actions,
            "actionBindings": [{
                **{k: n.get(k) for k in ("id", "code", "name", "roleId", "clientId", "recipientId", "acceptorId",
                                         "inputs", "resourceIds", "success", "schedule")},
                "scope": "existing_pipeline_stage" if n["id"] in active_actions else "declared_role_action_not_activated_here",
            } for n in actions],
            "trialProtocol": [], "manualAcceptance": None, "runtimeActivation": False,
        })
        (ROOT / f'{code}.proposed.txt').write_text(backstory + "\n\n" + json.dumps(selected_tasks, ensure_ascii=False, indent=2))
        before_prompt = {**baseline["roles"][agent_index],
                         "tasks": {k: {**v, "descriptionTemplate": baseline["taskTemplates"][k]}
                                   for k, v in selected_tasks.items()},
                         "configuration": baseline["agentConfiguration"]}
        diff = "".join(difflib.unified_diff(
            json.dumps(before_prompt, ensure_ascii=False, indent=2).splitlines(True),
            json.dumps(roles[-1]["prompt"], ensure_ascii=False, indent=2).splitlines(True),
            fromfile=f"{code}:current", tofile=f"{code}:proposal_not_active"))
        (ROOT / f"{code}.diff").write_text(diff)
        write(f"{code}.json", roles[-1])

    index = {
        "format": "talkhint.lab-agent-prompt-package", "version": 1, "status": "proposed_not_active",
        "sourceRevision": model["revision"], "operatingVersion": model["operatingModel"]["version"],
        "sourceGitRevision": baseline["sourceGitRevision"], "workerSha256": baseline["sha256"],
        "createdAt": at, "documentId": INDEX, "baselineRef": BASELINE,
        "roles": [{"roleId": r["roleId"], "roleCode": r["roleCode"], "documentId": r["documentId"]} for r in roles],
        "visualPassportSchema": visual_schema, "portraitStyle": STYLE,
        "lessons": lessons, "resources": resources, "ownerRequests": owner_requests,
        "trialProtocol": [], "manualAcceptance": None, "runtimeActivation": False,
        "trialProtocolRowSchema": {
            "fields": ["id", "roleId", "actionId", "inputVersion", "check", "expected", "actual", "evidence",
                       "status", "missingInputOrResource", "supplierId", "reviewerId", "returnReason", "ownerDecision"],
            "statusValues": ["not_started", "passed", "returned", "blocked"],
            "meaning": "Пустой trialProtocol заполняет независимый человек; offline-тесты не его замена"},
        "manualPassChecklist": [
            "Текущие role/goal/backstory и задачи совпадают с исходниками",
            "У двух ролей разные методы и характеры, одна рубрика",
            "Три черты, девиз, варианты имени, общий стиль и статус предложено",
            "Подчинение отдельно от проверяющего; нет самоприёмки",
            "Схема общая; только два заполненных визуальных паспорта",
            "Каждый урок имеет дату, источник и ограничения",
            "Ни чтение интернета, ни память не обещаны без ресурса",
            "Стандартный и диагностический контекст не потеряны",
            "Возвраты QA, неизвестное, отсутствие replay и модель неизменны",
            "Серверный v4 renderer не заменён AI-письмом",
            "Отдельное разрешение на будущую активацию явно требуется"],
        "newLessonForm": {
            "id": None, "date": None, "caseId": None, "callOrRunId": None, "roleId": None,
            "statement": None, "evidence": [], "scope": None, "limitations": [],
            "proposedBy": None, "reviewerId": "lg-qa-role", "acceptedBy": None,
            "status": "proposed", "supersedesId": None, "runtimeInjected": False},
        "handoffForm": {
            "caseId": None, "fromRoleId": None, "toRoleId": None, "receivingActionId": None,
            "inputVersion": None, "resultDocumentId": None, "question": None,
            "receiptEvidence": None, "acceptance": None, "returnReason": None},
        "futureStages": [
            {"stage": "Manual pass", "gate": "Владелец/Claude проходит пакет; исправления → явная приёмка",
             "currentTask": True},
            {"stage": "Resources", "gate": "Отдельное да на подготовку доступа/контекста; Dev diff + offline изоляция",
             "currentTask": False},
            {"stage": "Execution pilot", "gate": "Отдельное да на включение/прогон; реальные вход/передача/приёмка",
             "currentTask": False},
            {"stage": "Team view", "gate": "Принятые паспорта; доработка существующего раздела, без второго каталога",
             "currentTask": False},
            {"stage": "Other roles", "gate": "Работающий контур Hint и отдельная сверка следующих ролей",
             "currentTask": False}],
        "knownGaps": [
            "Production, фактическая доступность почты, модель окружения и последние исполнения не проверялись.",
            "Ролевой узел executorId=null и исторический gate пакета workerStarted=false не доказывают "
            "выключение production; наличие worker не доказывает включение. Слои состояния сохранены отдельно.",
            "Справочники/память Replit не являются памятью агента. История добавляется в Node после AI.",
            "Публичные URL — кандидаты; доступность и актуальные версии документации не проверены.",
            "Новый независимый проход QA и оценка владельца не выполнены.",
            "Имена/цвета/портреты не выбраны. Изображения и экран не создавались.",
        ],
    }
    write("PACKAGE.json", index)
    write("visual-passport.schema.json", visual_schema)
    write("LESSONS.json", lessons)
    write("RESOURCES.json", {"resources": resources, "ownerRequests": owner_requests})
    evidence = {
        "method": {"documentId": "DOC-PLAB-METHOD-RESPONSE", "version": method["version"],
                   "checkedAt": method["checkedAt"], "status": method["status"],
                   "requests": [r for r in method["requests"] if r["id"] in ("PLAB-METHOD-1", "PLAB-METHOD-5")]},
        "compact": {"documentId": "DOC-HINT-FAST-DIALOGUE-TRIAL", "revision": 837,
                    "historicalDocumentFound": bool(old_trial), "currentVersion": trial["version"],
                    "at": trial["at"], "manualEngineeringReview": compact_review,
                    "historicalIndependentQa": False},
        "journalCases": [c for c in json.loads(docs["DOC-TALKHINT-IMPROVEMENT-JOURNAL"]["text"])["cases"]
                         if c.get("caseId") in ("HINT-UI-VISIBILITY", "HINT-WAIT-STATE", "HINT-CURRENT-QUESTION")],
        "sourceFiles": {},
    }
    for file in ("workers/hint_lab/pipeline.py", "workers/hint_lab/README.md",
                 "server/callLab/source.ts", "server/callLab/process.ts", "server/callLab/service.ts",
                 "server/callLab/productContext.ts", ".agents/memory/hint-lab-release-boundary.md",
                 "server/benchmark/earsHarness.ts"):
        path = Path(file)
        evidence["sourceFiles"][file] = hashlib.sha256(path.read_bytes()).hexdigest()
    evidence["earHarnessExcerpt"] = "\n".join(
        l for l in Path("server/benchmark/earsHarness.ts").read_text().splitlines()
        if any(s in l for s in ("REALTIME_ACCEL = ", "FRAME_BYTES_MULAW =", "await sleep(20 / REALTIME_ACCEL)")))
    evidence["memoryExcerpt"] = Path(".agents/memory/hint-lab-release-boundary.md").read_text().split("---")[0]
    evidence["productContextVerbatim"] = Path("server/callLab/productContext.ts").read_text()
    evidence["sourceBuilderVerbatim"] = Path("server/callLab/source.ts").read_text()
    write("EVIDENCE.json", evidence)

    existing_actions = []
    for n in nodes.values():
        if n.get("roleId") in ("laboratory-engineer-role", "lg-qa-role") and n.get("kind") == "action":
            existing_actions.append(n)
    relevant_resources = {r for a in existing_actions for r in a.get("resourceIds", [])}
    write("MODEL_LINKS.json", {
        "revision": model["revision"], "operatingVersion": model["operatingModel"]["version"],
        "roles": [nodes[r["roleId"]] for r in roles], "actions": existing_actions,
        "resources": [nodes[r] for r in relevant_resources if r in nodes],
        "readDocuments": [{"id": d["id"], "title": d["title"],
                           "sha256": hashlib.sha256(d["text"].encode()).hexdigest()}
                          for d in model["documents"]],
        "note": "Версионный экспорт существующей модели, не новый реестр действий; не все обязанности подключены к worker.",
    })
    # Canonical draft stores shared blocks once, not several copies of BASE and lessons.
    baseline_document = {k: baseline[k] for k in (
        "format", "version", "sourceFile", "sha256", "sourceGitRevision", "sourceScope",
        "framework", "model", "commonBackstoryVerbatim", "schemas", "taskTemplates",
        "agentConfiguration", "crewConfiguration", "expectedOutputVerbatim", "schemaSuffixVerbatim",
        "qaReturns", "nativeResponseModelRequired", "hiddenModelRepair", "replay")}
    baseline_document["roles"] = [{k: r[k] for k in ("role", "goal")} for r in baseline["roles"]]
    baseline_document["fullUnchangedSnapshot"] = {
        "file": "CURRENT.json", "sha256": hashlib.sha256((ROOT / "CURRENT.json").read_bytes()).hexdigest(),
        "sourceArchive": "P_LAB_P_LG_QA_passports_v1.zip",
        "note": "Full source/run/factories/captures are in the downloadable snapshot; source file unchanged."}
    role_documents = []
    for r, methods in zip(roles, (LAB_METHOD, QA_METHOD)):
        compact = copy.deepcopy(r)
        compact["storageFormat"] = "shared-block-references-v1"
        compact["prompt"]["backstory"] = {
            "commonRef": BASELINE + "#commonBackstoryVerbatim", "expertiseText": methods,
            "lessonRef": INDEX + "#lessons",
            "lessonHeader": "\nДАТИРОВАННЫЙ БЛОК УРОКОВ ЭТОГО ПРЕДЛОЖЕНИЯ\n"
                            "Источники — общий пакет; это прочитанные документальные основания, не новая QA и не факты текущего звонка.\n",
            "join": "common + '\\n\\n' + expertiseText + lessonHeader + newline-joined ID [documentedAt]: rule",
            "expandedSha256": hashlib.sha256(r["prompt"]["backstory"].encode()).hexdigest(),
        }
        compact["actionBindings"] = {
            "sourceModel": "new-country", "revision": model["revision"],
            "operatingVersion": model["operatingModel"]["version"],
            "nodeIds": [a["id"] for a in r["actionBindings"]],
            "expandedFile": "MODEL_LINKS.json",
            "meaning": "Exact unchanged source nodes; live bindings must be rechecked after model revision changes"}
        role_documents.append(compact)
    all_documents = [
        {"id": BASELINE, "title": "Hint — текущие промпты лаборатории: неизменённый снимок",
         "text": json.dumps(baseline_document, ensure_ascii=False), "url": "",
         "elementIds": docs["DOC-PLAB-WORK-PACKAGE"]["elementIds"]},
        {"id": INDEX, "title": "Hint — промпты, характеры и визуальные паспорта: предложение v1, не включено",
         "text": json.dumps(index, ensure_ascii=False), "url": "",
         "elementIds": docs["DOC-PLAB-WORK-PACKAGE"]["elementIds"]},
        *[{"id": r["documentId"], "title": f'{r["roleCode"]} — промпт и визуальный паспорт: проект v1',
           "text": json.dumps(r, ensure_ascii=False), "url": "",
           "elementIds": docs["DOC-PLAB-WORK-PACKAGE"]["elementIds"]} for r in role_documents],
    ]
    for d in all_documents:
        assert len(d["text"]) <= 50_000, (d["id"], len(d["text"]))
    write("REGISTRATION.json", {
        "sourceRevision": model["revision"], "createdAt": at,
        "caseId": "HINT-LAB-AGENT-PASSPORTS", "indexDocumentId": INDEX,
        "runtimeActivation": False, "documents": all_documents,
    })
    (ROOT / "README.md").write_text(f"""# P.LAB / P.LG.QA — пакет на ручной проход v1

СТАТУС: ПРЕДЛОЖЕНО, НЕ ВКЛЮЧЕНО. Источник new-country rev{model['revision']},
operatingModel v{model['operatingModel']['version']}; снимок {at}.
Прочитаны книга, глава Hint, пакет P.LAB, узел/действия QA, журнал, LAB.METHOD и стенд кофейни.
Даты и хеши — MODEL_LINKS.json. Текущий worker CrewAI 1.15.30 не изменён.

## Что читать и вернуть
1. CURRENT.json / pipeline.current.py — роль, цель, общая backstory, рубрика, схемы, конфигурация,
   полный исходный run и сборка Task. Всё как есть, не пересказ. CURRENT_TASK_CAPTURES.json —
   развернутые задачи на искусственном входе: штатно, D1–D5, два возврата и отказ QA.
   Это offline-перехват, не новый разбор реального звонка и не приёмка.
2. P.LAB.json / P.LG.QA.json и два .proposed.txt — полные предлагаемые инструкции;
   два .diff показывают изменения. Лимиты, инструменты, модель и схемы не расширяются.
3. visual-passport.schema.json — единая схема, два заполнения находятся в JSON ролей.
   Имена не назначены; цвет, образ и стиль — предложения. Портретов и нового экрана нет.
4. LESSONS.json / EVIDENCE.json — датированные уроки с источниками и границами.
   ×4 относится к конкретному Ears-harness. Ошибка compact — инженерная находка, не новая QA.
   Показ ≠ чтение; разрыв между серверными отметками ≠ доказанная задержка экрана.
5. RESOURCES.json — что реально выдаётся и что пока предлагается. tools=[] и memory=False.
   Node читает прошлые попытки ПОСЛЕ AI. Общий журнал не становится памятью агента от ссылки.
6. PACKAGE.json — формы передачи/нового урока, checklist и пустой trialProtocol.
   Заполните protocol по trialProtocolRowSchema, приложите evidence, вердикт и выбранные имена.
   Результат верните ZIP в чат. Claude/владелец — независимый ручной проход, не инженер за них.

## Границы
Нет внешних модельных запросов, почты, звонков, новых записей, публикации или изменения
рабочих промптов. Ролевые паспорта/операционная модель остаются активными как раньше.
В Dev-модели регистрируются ТОЛЬКО новые документы-предложения со связями к прежним ID
и один документальный случай журнала. REGISTERED.json подтверждает сохранение старых данных.
Новый независимый QA-проход не выполнен; качество/живой эффект не проверены.
Само назначение «Скептик» не даёт права придумывать замечания ради возврата.

## После вашего прохода — не выполняется сейчас
1. Исправления → явная приёмка паспортов. Включение требует отдельного «да».
2. RESOURCE.LESSONS.1 / RESOURCE.DOCS.1: отдельные решения о подготовке источников,
   границах доступа и Dev-проверках; регистраций/ключей сейчас не требуется.
3. Ограниченный пилот исполнения: вход → действие → независимый результат/возврат → передача.
4. Отдельная доработка существующего раздела «Команда»: принятые поля, отчёты, реальные
   передачи и блокировки; портреты только по выбранным описаниям.
5. Остальные роли — по готовности Hint и прежней очередности, не все сразу.

## Проверки
VALIDATION.json — offline-валидация схемы/ссылок/неизменности.
Python tests — заглушки и запрет socket, а не вызов модели.
Хеши файлов пакета — SHA256SUMS.json. Секретов и текущих реальных снимков звонков здесь нет.
""")
    cards = "".join(
        f'<section><h2>{html.escape(r["roleCode"])} — {html.escape(r["visualPassport"]["character"]["archetype"])}</h2>'
        f'<p>{html.escape(r["visualPassport"]["character"]["motto"])}</p><p>'
        f'Имена на выбор: {html.escape(", ".join(r["visualPassport"]["nameOptions"]))}. Не выбрано.</p>'
        f'<p>Три черты: {html.escape(", ".join(r["visualPassport"]["character"]["traits"]))}</p>'
        f'<p>Образ: {html.escape(r["visualPassport"]["portrait"]["image"])}</p>'
        f'<p>Руководитель: HEAD.07. Проверяет: {html.escape(r["visualPassport"]["reviewedBy"][0]["roleCode"] or "неизвестно")}'
        f' — {html.escape(r["visualPassport"]["reviewedBy"][0]["kind"])}</p>'
        f'<details><summary>Полная предлагаемая инструкция</summary><pre>{html.escape(r["prompt"]["backstory"])}</pre></details>'
        '</section>' for r in roles)
    (ROOT / "READ_FIRST.html").write_text(
        '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Паспорта P.LAB и P.LG.QA — проект v1</title><style>'
        'body{margin:0;font:16px/1.55 system-ui;background:#f4f7f7;color:#17212b}main{max-width:900px;padding:20px;margin:auto}'
        'section,aside{background:white;border:1px solid #dce5e5;border-radius:12px;padding:18px;margin:18px 0}'
        'aside{background:#fff4d8}h1{font-size:25px}h2{font-size:22px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}'
        '</style><main><h1>Лаборатория Hint: паспорта специалистов</h1>'
        f'<aside>Предложено, не включено. Основа: модель rev{model["revision"]}, снимок {html.escape(at)}. '
        'Это документ для чтения, не новый экран «Команда». Портреты не создавались; имена выбирает владелец.</aside>'
        + cards + '<section><h2>Чему научились — источники, не новая приёмка</h2><ul>' +
        "".join(f'<li><b>{html.escape(l["title"])}</b> [{html.escape(l["documentedAt"])}]<br>'
                f'{html.escape(l["rule"])}</li>' for l in lessons) +
        '</ul></section><section><h2>Что пока не выдано</h2><p>Нет браузера и встроенной памяти. '
        'Проверенные выдержки и чтение документации требуют отдельной подготовки и разрешения. '
        'Пакет содержит адресные запросы и пустой протокол ручного прохода.</p></section></main></html>')
    print(json.dumps({"sourceRevision": model["revision"],
                      "documents": {d["id"]: len(d["text"]) for d in all_documents},
                      "externalModelCalls": 0, "runtimeActivation": False}))


if __name__ == "__main__":
    build()
