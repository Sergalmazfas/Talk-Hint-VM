"""Manual-review corrections to proposal documents only. No runtime imports/calls."""
import copy
import difflib
import hashlib
import json
import zipfile
from pathlib import Path

from jsonschema import Draft202012Validator

OUT = Path("generated-artifacts/lab-agent-passports-v2")
OLD = Path("generated-artifacts/lab-agent-passports")
UPLOAD = Path("attached_assets/0_Prompts_pass_rev904_v1_1793220762393.zip")
INDEX = "DOC-HINT-LAB-AGENT-PROMPT-PACKAGE"
BASELINE = "DOC-HINT-LAB-AGENT-PROMPTS-BASELINE"
ROLE_IDS = ["DOC-PLAB-PROMPT-PROPOSAL", "DOC-PLG-QA-PROMPT-PROPOSAL"]


def read(path):
    return json.loads(Path(path).read_text())


def save(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2))


def expand(role, common, lessons):
    block = role["prompt"]["backstory"]
    return (block.get("missionIntro", "") + "\n\n" + common + "\n\n" + block["expertiseText"]
            + block["lessonHeader"] + "\n".join(
                f'{l["id"]} [{l["documentedAt"]}]: {l["rule"]}' for l in lessons))


def generate():
    snapshot = read(OUT / "source-model.json")
    docs = {d["id"]: d for d in snapshot["documents"]}
    old_index = json.loads(docs[INDEX]["text"])
    assert old_index["version"] == 1, "Review applies to v1 only"
    index = copy.deepcopy(old_index)
    source = snapshot["revision"]
    now = snapshot["capturedAt"]
    review_hash = hashlib.sha256(UPLOAD.read_bytes()).hexdigest()
    with zipfile.ZipFile(UPLOAD) as z:
        text = z.read(next(n for n in z.namelist() if n.endswith(".md")))
        passed = z.read("TRIAL_PROTOCOL_PASS.json")
    (OUT / "01_Проход_промптов_v1.md").write_bytes(text)
    (OUT / "TRIAL_PROTOCOL_PASS_v1.json").write_bytes(passed)
    review = json.loads(passed)
    assert review["registeredRevision"] == 904
    assert {r["id"] for r in review["trialProtocol"]} >= {"R1", "R2", "R3", "R4", "R5"}
    preflight = read("generated-artifacts/hint-unified-rescore-final/preflight.json")
    report = read("generated-artifacts/hint-unified-rescore-final/FULL_REPORT.json")
    assert report["calibrationPassed"] and report["calibrationMatched"] == 20
    assert preflight["model"] == "gpt-5.4-2026-03-05"
    judge_evidence = {
        "model": preflight["model"], "calibrationMatched": 20, "calibrationPassed": True,
        "method": report["method"], "sourcePreparedAt": preflight["preparedAt"],
        "sources": [{"path": str(Path("generated-artifacts/hint-unified-rescore-final") / f),
                     "sha256": hashlib.sha256((Path("generated-artifacts/hint-unified-rescore-final") / f).read_bytes()).hexdigest()}
                    for f in ("preflight.json", "FULL_REPORT.json", "REPORT.md")],
        "scope": "Сохранённая калибровка прежней оценки Hint; не новая калибровка QA Analysis/Letter",
        "newCalls": 0, "currentProviderAccess": "not checked",
    }
    save("QA_MODEL_EVIDENCE.json", judge_evidence)
    decisions = [
        {"id": "R2", "resourceId": "RESOURCE.LESSONS.1", "decision": None,
         "what": "Подготовить в Dev read-only историю ИМЕННО этой проблемы во входе анализа и QA",
         "effect": "Не повторять уже испробованное; показывать прошлое исправление и подтверждённое было → стало",
         "options": ["A: ограниченные проверенные выдержки до AI, одинаковые для автора и QA — рекомендуется",
                     "B: пока оставить только историю после AI; новые промпты не включать"],
         "recommendation": "A; сначала Dev diff и offline-проверки. Не включать tools или встроенную память",
         "scopeOfYes": "Разрешение подготовить Dev-изменение, не активация, не Publish, не модельные вызовы",
         "risks": "Ошибочный подбор истории, смешение владельцев, старый вывод как факт нового звонка, рост входа/стоимости",
         "guards": "Owner/environment isolation; source version/time; факты отдельно от гипотез; лимит и явная неполнота",
         "acceptance": "Две роли реально получают один блок; чужие данные не попадают; пропущенная история не выдумывается",
         "supplierId": "product-manager-specialist", "implementerId": "head-engineering",
         "receivingActionIds": ["lab-action-analyze", "lab-action-qa"],
         "current": "Не реализовано: productContext добавляет историю после AI",
         "activationGate": "Блокирующий ресурс: подготовить и проверить до включения новых промптов",
         "cost": "Сейчас 0 вызовов; цена будущего пилота зависит от объёма и будет представлена до запуска"},
        {"id": "R4", "decision": None,
         "what": "Подготовить отдельную модель Скептика: gpt-5.4-2026-03-05, автор без изменений",
         "effect": "Разделить модели автора и проверяющего, а не только их контекст",
         "options": ["A: отдельная конфигурация QA и калибровка под нынешний контракт LAB.QA — рекомендуется",
                     "B: сохранить один LLM с разными агентами/контекстами, явно отмечая ограничение"],
         "recommendation": "A; прежние 20/20 — основание рассмотреть кандидата, не допуск текущей QA",
         "scopeOfYes": "Только подготовка Dev-конфигурации и плана калибровки; не платный прогон и не включение",
         "risks": "Другая строгость, ложные возвраты, цена и задержка; модель может быть недоступна",
         "acceptance": "Нет fallback на автора; QA-сбой остаётся неизвестным; контрастные примеры по текущей рубрике",
         "evidenceRef": "QA_MODEL_EVIDENCE.json",
         "implementerId": "head-engineering", "receivingActionId": "lab-action-qa",
         "current": "Один LLM; отдельная модель не настроена, доступность сейчас не проверялась",
         "cost": "Перед новым вызовом — число запросов и цена, отдельное разрешение; сейчас 0"},
    ]
    index.update(version=2, previousPackageVersion=1, proposalRevisionBase=source, revisedAt=now,
                 ownerDecisions=decisions, manualAcceptance=None, runtimeActivation=False)
    index["manualReviewReceived"] = {
        "reviewedVersion": 1, "registeredRevision": 904, "verdict": "принять с исправлениями",
        "source": str(UPLOAD), "sha256": review_hash, "attribution": review["manualAcceptance"]["by"],
        "originalProtocolFile": "TRIAL_PROTOCOL_PASS_v1.json", "newIndependentPass": False,
        "names": "Не выбраны: [имя] в сообщении — незаполненное поле"}
    index["activationGate"] = {"allowed": False, "pending": ["R2: ресурс истории",
        "R4: решение о QA-модели", "выбор имён и повторная приёмка паспортов", "отдельное да на включение"]}
    index["problemHistoryInputContract"] = {
        "resource": "RESOURCE.LESSONS.1", "status": "designed_not_implemented_or_granted",
        "field": "problem_history", "access": "read_only_server_supplied",
        "statuses": ["available", "partial", "unavailable"], "sameBlockTo": ["P.LAB", "P.LG.QA"],
        "fields": ["owner_scope_verified", "environment", "source_revision", "captured_at", "coverage",
                   "problem_id", "problem_description", "attempt_date", "what_changed", "change_version",
                   "before", "after", "effect_status", "evidence", "accepted_by"],
        "rules": ["Только проблемы данного звонка, не общий пересказ случая",
                  "Нет истории — раньше не пробовали, только если полнота доказана; иначе история недоступна/неполна",
                  "Факты старого звонка не переносятся в новый; гипотезы и пользовательская оценка маркируются",
                  "Нет подтверждённого эффекта — неизвестно, не помогло не выводить из молчания",
                  "Ограничение объёма и сверка выбора — часть отдельного Dev diff; усечение не молчаливое"],
    }
    for resource in index["resources"]:
        if resource["id"] == "proposal:verified-lesson-context":
            resource["purpose"] = "История конкретной проблемы ДО анализа и в том же виде QA"
            resource["status"] = "designed; owner_decision_pending; not_implemented_or_granted"
            resource["acceptance"] += "; подготовить до включения новых промптов"
    for request in index["ownerRequests"]:
        if request["id"] == "RESOURCE.LESSONS.1":
            request.update(what=decisions[0]["what"], recommendation=decisions[0]["recommendation"],
                           decisionRef="R2")
    index["visualPassportSchema"]["$id"] = "urn:talkhint:visual-passport:v2"
    index["visualPassportSchema"]["properties"]["schemaVersion"] = {"const": 2}
    character_schema = index["visualPassportSchema"]["properties"]["character"]
    character_schema["required"].append("howISpeak")
    character_schema["properties"]["howISpeak"] = {
        "type": "object", "additionalProperties": False,
        "required": ["style", "examples", "examplesAreIllustrative", "placement", "factBoundary"],
        "properties": {"style": {"type": "string"}, "examples": {
            "type": "array", "minItems": 1, "items": {"type": "string"}},
            "examplesAreIllustrative": {"const": True}, "placement": {"type": "string"},
            "factBoundary": {"type": "string"}}}
    mission = """МИССИЯ — ПОМОЧЬ ВЛАДЕЛЬЦУ ГОВОРИТЬ
После каждого звонка найди главное, что помешало владельцу говорить, и предложи
1–3 конкретных улучшения. Одно главное слабое звено на звонок, не перечень всего подряд.
Пустой разбор без следующего полезного действия — плохой результат. Если данных мало,
предложи конкретную проверку вместе с исправлением по её исходу, не сочиняй дефект.
Приоритеты владельца по порядку:
1. Время от конца фразы собеседника до подсказки на экране.
2. Доля использованных подсказок: использование / моменты нужности; без рубрики нужности — неизвестно.
3. Ведёт ли подсказка к цели разговора.
4. Можно ли прочитать подсказку за секунду (длина — лишь прокси).
5. Перевод подсказки и реплик собеседника.
Цифры — из кода и подтверждённых событий; при отсутствии измерения не подменяй экран ACK.
Предложение: что изменить → ожидаемый эффект → варианты, если есть → рекомендация.
Сначала настройки промпта, триггеров, экрана, пауз и фильтров; модель — только по правилам владельца."""
    lab_method = """1. Кто ты и зачем
Ты P.LAB, Измеритель, инженер Hint. Анализ получает P.LG.QA, предложения — продукт.
Работай ради улучшения следующего разговора, не ради перечисления неизвестного.

2. Экспертиза и метод
Установи цель, Owner/Guest и полноту данных. Выдели одно главное препятствие по приоритетам миссии.
Покажи основание и подготовь 1–3 исправления. У задержки укажи границы/часы/единицы;
сравнение p50/p95 без сопоставимой базы не доказывает рост. Не присваивай Owner факт Guest.
Ответ за владельца — неизвестный из цели/его речи факт о состоянии или действии;
вопросы, условные варианты и уже сообщённое — не нарушение. Рубрика общая.
Причина в коде без доказательств — гипотеза; адресный LAB.INPUT.REQUEST идёт P.LG.TECH/HEAD.07.

3. Источники знаний и история проблемы
Используй только переданный снимок, рубрику и действительно выданную историю этой проблемы.
По каждой проблеме: что меняли, когда, версия, было → стало и подтверждение эффекта.
Нет блока — не заявляй чтение журнала и не называй совет новым/уже испробованным.
Ресурс истории проектируется, но НЕ выдан; это блокер включения новых промптов.
Нет браузера/tools; ссылки не равны прочитанной документации.

4. Уроки
Датированные уроки — основания метода, не факты нового звонка. Один звонок — наблюдение.
×4 относится к конкретному Ears-harness; ошибка compact не доказывает дефект всех коротких ответов.

5. Результат и как говорю
Говори живо и коротко: наблюдение → главное препятствие → конкретное улучшение.
Одну фразу своим голосом встрой в «Где сломалось» или «Нужно решение», не добавляй пятый блок письма.
Пример подачи, НЕ факт звонка: «Подсказка готова быстро, но показ не подтверждён.
Предлагаю связать события; если старая карточка задерживает новую — сразу заменять её».
Уверенность голоса не повышает доказанность; не говори «так не бывает, дело в приложении» без данных.
Finding — только по разрешённому event_id. Цифры остаются кодовыми; неизвестное не ноль.
QA-возврат разбери по общей рубрике, не меняй категории и статус ради принятия.

6. Память и развитие
Встроенная память выключена. Предлагай урок с датой/источником/границами через proposals;
внешний процесс проверяет и записывает. Ты не запускаешь инструменты, почту, выпуск или новый прогон.
"""
    qa_method = """1. Кто ты и зачем
Ты P.LG.QA, Скептик. Помоги выпустить полезное доказанное улучшение, а не остановить всё.
Клиент — P.LAB; HEAD.07 — выборочный последующий контроль, не блок каждого письма.

2. Экспертиза и метод
Свежий контекст, исходный снимок и анализ. Проверь главное препятствие и 1–3 конкретных
улучшения по приоритетам владельца. Не возвращай за честное неизвестное, но не принимай
подмену факта уверенностью. Для каждого issues: событие/поле → утверждение → источник →
критерий → исправление. Схема QA {verdict, issues} неизменна.
Проверь цель, говорящего, происхождение фактов, полноту, измерения. Разница 23958 мс между
серверными отметками сама по себе не доказывает 24 секунды до экрана. Нет источника причины —
гипотеза, не диагноз. Одна модель с разными контекстами — не разные модели.

3. Источники и история
Используй только действительно выданный снимок/рубрику/тот же блок истории, что у автора.
История сейчас приходит после AI: предложенный вход не считай уже подключённым.
Нет browser/tools/живой памяти. Если история недоступна — оцени честность ограничения,
не требуй угадать прежние попытки. Для включения новых промптов ресурс должен быть подготовлен.

4. Уроки
Датированные уроки не доказывают новый результат. ×4, смена говорящего compact,
экран ≠ ACK, неизвестное ≠ 0 и подмена состояния владельца проверяются по общей рубрике.
Отдельный GPT-5.4 — кандидат на решение, сейчас этот агент не переключён.

5. Приёмка и как говорю
Accepted — при достаточных основаниях, returned — при конкретном нарушении. Не ищи ошибку ради возврата.
Одна ясная фраза внутри issues при возврате; пример подачи, НЕ вердикт нового звонка:
«Не принимаю: где доказательство, что подсказка опоздала, а не ответила на другой вопрос?»
Не ставь новую категорию, не требуй второй основной категории, не подменяй schema-valid фактическим качеством.
Лимит возвратов и обработка сбоя — кодовые, их не меняй. Не принимай за владельца.

6. Память и развитие
Tools и память выключены. Новое замечание/урок — кандидат для внешней проверки и записи,
не самостоятельно усвоенное правило. Не редактируй анализ, журнал, почту или продукт.
"""
    common = json.loads(docs[BASELINE]["text"])["commonBackstoryVerbatim"]
    updated_roles = []
    for i, id in enumerate(ROLE_IDS):
        role = json.loads(docs[id]["text"])
        role.update(version=2, proposalRevisionBase=source, revisedAt=now)
        role["prompt"]["backstory"]["missionIntro"] = mission if i == 0 else (
            "МИССИЯ СКЕПТИКА — ПРОВЕРИТЬ ПОЛЕЗНОЕ УЛУЧШЕНИЕ\n"
            "Проверь, найдено ли одно главное препятствие и предложены ли 1–3 конкретных улучшения;\n"
            "не сочиняй нарушения или эффект ради строгости.\n" + mission)
        role["prompt"]["backstory"]["expertiseText"] = lab_method if i == 0 else qa_method
        role["prompt"]["backstory"]["join"] = "missionIntro + '\\n\\n' + common + '\\n\\n' + expertiseText + lessonHeader + lessons"
        role["prompt"]["backstory"]["expandedSha256"] = hashlib.sha256(
            expand(role, common, index["lessons"]).encode()).hexdigest()
        role["visualPassport"]["schemaVersion"] = 2
        role["visualPassport"]["character"]["howISpeak"] = {
            "style": "Наблюдение → слабое звено → улучшение, коротко и спокойно" if i == 0
                     else "Прямой проверяемый вопрос; замечание с причиной и исправлением, без придирок",
            "examples": ["Главное препятствие — неготовая к чтению карточка. Предлагаю одно действие на экран."]
                        if i == 0 else ["Не принимаю: где доказательство опоздания, а не ответа на другой вопрос?"],
            "examplesAreIllustrative": True,
            "placement": "Внутри существующих блоков v4/полей схемы, не отдельный блок письма",
            "factBoundary": "Характер меняет подачу, не факты, выводы или полномочия"}
        if i == 0:
            role["visualPassport"]["roleColor"]["value"] = "#1E4E79"
            role["prompt"]["goal"] = "После каждого звонка: главное препятствие и 1–3 доказуемых улучшения"
        role["goal"] = role["prompt"]["goal"]
        role["activationGateRef"] = INDEX + "#activationGate"
        Draft202012Validator(index["visualPassportSchema"]).validate(role["visualPassport"])
        full = copy.deepcopy(role)
        full["prompt"]["backstory"] = expand(role, common, index["lessons"])
        previous = read(OLD / (role["roleCode"] + ".json"))
        full["actionBindings"] = previous["actionBindings"]
        save(role["roleCode"] + ".json", full)
        (OUT / (role["roleCode"] + ".proposed.txt")).write_text(full["prompt"]["backstory"] +
            "\n\n" + json.dumps(full["prompt"]["tasks"], ensure_ascii=False, indent=2))
        (OUT / (role["roleCode"] + ".v1-to-v2.diff")).write_text("".join(difflib.unified_diff(
            json.dumps(previous, ensure_ascii=False, indent=2).splitlines(True),
            json.dumps(full, ensure_ascii=False, indent=2).splitlines(True),
            fromfile=role["roleCode"] + ":v1", tofile=role["roleCode"] + ":v2_not_enabled")))
        updated_roles.append(role)
    save("PACKAGE.json", index)
    save("visual-passport.schema.json", index["visualPassportSchema"])
    save("NEEDS_DECISION.json", decisions)
    save("PROBLEM_HISTORY_INPUT_CONTRACT.json", index["problemHistoryInputContract"])
    save("REVISION.json", {"sourceRevision": source, "createdAt": now, "reviewSha256": review_hash,
        "runtimeActivation": False,
        "documents": [{"id": id, "title": docs[id]["title"].replace("v1", "v2"),
                       "text": json.dumps(obj, ensure_ascii=False)}
                      for id, obj in [(INDEX, index), *zip(ROLE_IDS, updated_roles)]]})
    (OUT / "PACKAGE.v1-to-v2.diff").write_text("".join(difflib.unified_diff(
        json.dumps(old_index, ensure_ascii=False, indent=2).splitlines(True),
        json.dumps(index, ensure_ascii=False, indent=2).splitlines(True),
        fromfile="PACKAGE:v1", tofile="PACKAGE:v2_not_enabled")))
    save("CORRECTIONS.json", {
        "R1": {"status": "corrected_in_proposal_not_reaccepted", "changes": "Миссия до запретов, пять приоритетов, одно слабое звено, 1–3 улучшения"},
        "R2": {"status": "contract_prepared_decision_pending", "implementation": "not_implemented", "decisionRef": "R2"},
        "R3": {"status": "corrected_in_proposal_not_reaccepted", "changes": "Как говорю в инструкциях и общей схеме, без выдуманных причин"},
        "R4": {"status": "decision_pending_not_switched", "decisionRef": "R4"},
        "R5": {"status": "corrected_in_proposal_not_reaccepted", "color": "#1E4E79"},
        "names": {"P.LAB": None, "P.LG.QA": None, "reason": "В сообщении [имя], выбор не сделан"},
    })
    save("TRIAL_PROTOCOL.json", {"packageVersion": 2, "sourceRevision": source,
        "trialProtocol": [], "manualAcceptance": None, "previousPass": "TRIAL_PROTOCOL_PASS_v1.json"})
    (OUT / "README.md").write_text("""# Промпты лаборатории v2 — исправления после прохода v1

НЕ ВКЛЮЧЕНО. Модель, ключи, доступы, поведение продукта и короткая форма v4 не изменены.
Начните с CORRECTIONS.json; точные diff v1→v2 — три файла *.diff.
R1: миссия до запретов, пять метрик по приоритету владельца, одно слабое звено, 1–3 улучшения.
R2: спроектирован read-only вход истории именно этой проблемы и блокер включения.
Ресурс НЕ реализован/НЕ выдан; требуется решение R2, затем отдельный Dev diff/проверки.
R3: «как говорю» добавлено в инструкции и общую визуальную схему v2. Подача не меняет факты:
пример про 24 секунды не превращён в диагноз приложения. Пятая секция письма не добавляется.
R4: отдельная модель не включена; см. NEEDS_DECISION.json и QA_MODEL_EVIDENCE.json.
Сохранённые 20/20 GPT-5.4 подтверждены для прежней рубрики. Нынешняя LAB.QA отдельно не калибровалась.
R5: P.LAB #1E4E79; статус — отдельное понятие, не определяется цветом должности.
Имена не назначены: [имя] — пустое поле. Варианты из v1 сохранены.

P.LAB.json/P.LG.QA.json — развёрнутые предложения, не рабочие промпты.
PACKAGE.json — общая схема, уроки, ресурсы, решения и gate.
REVISION.json — нормализованные документы для существующих ID модели, не новый каталог.
REGISTERED.json — проверка сохранения и читателей; старый baseline и активные паспорта не менялись.
history/ содержит точные исходные артефакты v1. Полученный проход v1 сохранён отдельно,
без исправления его вердикта. Новый trialProtocol пустой; повторная независимая приёмка не имитируется.
Решения вернуть в чат по R2 и R4. «Да» в этих строках — только подготовка Dev,
не запуск модели, не включение и не Publish. После выбора имён/сверки паспортов включение отдельно.
""")
    print(json.dumps({"sourceRevision": source, "version": 2,
                      "documentSizes": [len(d["text"]) for d in read(OUT / "REVISION.json")["documents"]]}))


if __name__ == "__main__":
    generate()
