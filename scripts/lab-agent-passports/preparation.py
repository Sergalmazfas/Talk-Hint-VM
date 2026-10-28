"""Record the owner's preparation-only decisions and build a non-activated review bundle."""
import copy
import difflib
import hashlib
import html
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

from jsonschema import Draft202012Validator
from revise import expand

OUT = Path("generated-artifacts/lab-agent-preparation")
PREVIOUS = Path("generated-artifacts/lab-agent-passports-v2")
INDEX = "DOC-HINT-LAB-AGENT-PROMPT-PACKAGE"
NAMES = {"P.LAB": "Замир Хинтович", "P.LG.QA": "Фома Хинтович"}


def load(path):
    return json.loads(Path(path).read_text())


def save(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2))


def capture_diff():
    diff = subprocess.run(["git", "diff", "--", "server/callLab/process.ts",
                           "workers/hint_lab/pipeline.py"], capture_output=True, text=True, check=True).stdout
    for path in ("server/callLab/preparedAnalysis.ts", "server/callLab/preparedAnalysis.test.ts",
                 "workers/hint_lab/test_prepared_qa.py"):
        diff += subprocess.run(["git", "diff", "--no-index", "--", "/dev/null", path],
                               capture_output=True, text=True).stdout
    (OUT / "DEV.diff").write_text(diff)


def prepare():
    source = load(OUT / "source-model.json")
    docs = {d["id"]: d for d in source["documents"]}
    old = json.loads(docs[INDEX]["text"])
    index = copy.deepcopy(old)
    decision = {"R2": "prepare_dev_only", "R4": "prepare_dev_only", "names": NAMES,
                "executionAuthorized": False, "modelCallsAuthorized": False}
    decision_hash = hashlib.sha256(json.dumps(decision, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    index["revisionLabel"] = "2.1"
    index["proposalRevisionBase"] = source["revision"]
    index["revisedAt"] = source["capturedAt"]
    index["manualReviewReceived"]["names"] = "Выбраны владельцем; активные роли не переименованы"
    index["devPreparation"] = {
        "R2": "server/callLab/preparedAnalysis.ts: read-only bounded input; not wired into service",
        "R4": "explicit runHintLab qaModel option + separate reviewer LLM; default unchanged",
        "executionAuthorized": False, "calibrationRun": False,
    }
    index["activationGate"]["pending"] = [
        "Проверенная серверная привязка владельца к модели и подключение R2",
        "Калибровка нынешней LAB.QA после цены/разрешения", "повторная приёмка", "отдельное да на включение"]
    index["problemHistoryInputContract"]["status"] = "implemented_dev_unwired_not_granted"
    for row in index["ownerDecisions"]:
        row["decision"] = "prepare_dev_only"
    for request in index["ownerRequests"]:
        if request["id"] == "RESOURCE.LESSONS.1":
            request["status"] = "preparation_authorized_not_granted"
    for resource in index["resources"]:
        if resource["id"] == "proposal:verified-lesson-context":
            resource["status"] = "implemented_dev_unwired_not_granted"
    common = json.loads(docs[index["baselineRef"]]["text"])["commonBackstoryVerbatim"]
    updates = []
    for id in ("DOC-PLAB-PROMPT-PROPOSAL", "DOC-PLG-QA-PROMPT-PROPOSAL"):
        role = json.loads(docs[id]["text"])
        role.update(revisionLabel="2.1", proposalRevisionBase=source["revision"], revisedAt=source["capturedAt"])
        role["visualPassport"]["selectedName"] = NAMES[role["roleCode"]]
        role["prompt"]["role"] += " · " + NAMES[role["roleCode"]]
        Draft202012Validator(index["visualPassportSchema"]).validate(role["visualPassport"])
        full = copy.deepcopy(role)
        full["prompt"]["backstory"] = expand(role, common, index["lessons"])
        full["actionBindings"] = load(PREVIOUS / (role["roleCode"] + ".json"))["actionBindings"]
        save(role["roleCode"] + ".json", full)
        updates.append((id, role))
    updates.insert(0, (INDEX, index))
    save("PACKAGE.json", index)
    save("OWNER_DECISION.json", decision)
    save("REVISION.json", {
        "sourceRevision": source["revision"], "createdAt": source["capturedAt"],
        "reviewSha256": decision_hash, "preparationDecision": decision, "runtimeActivation": False,
        "documents": [{"id": id, "title": docs[id]["title"].replace("v2", "v2.1"),
                       "text": json.dumps(obj, ensure_ascii=False)} for id, obj in updates],
    })
    for id, obj in updates:
        (OUT / (id + ".diff")).write_text("".join(difflib.unified_diff(
            json.dumps(json.loads(docs[id]["text"]), ensure_ascii=False, indent=2).splitlines(True),
            json.dumps(obj, ensure_ascii=False, indent=2).splitlines(True),
            fromfile=id + ":v2", tofile=id + ":v2.1_not_active")))
    pairs = [
        "Подтверждённое состояние владельца / выдуманное состояние",
        "Вопрос собеседнику / факт без источника",
        "Условные варианты / ответ за владельца",
        "Цель удержана / подмена цели",
        "Owner и Guest верны / перепутан говорящий",
        "Неизвестный экран / ACK выдан за экран",
        "Ограничения часов / выдуманное опоздание",
        "Текущий вопрос / устаревший ответ",
        "Общая рубрика / несуществующая категория",
        "Нет reference, WER неизвестен / выдуманный WER",
        "История этой проблемы с доказательством / неподтверждённое помогло",
        "Конкретное улучшение / пустое проверить без дальнейшего действия",
    ]
    save("CALIBRATION_PLAN.json", {
        "status": "prepared_not_run", "model": "gpt-5.4-2026-03-05", "proposedQACalls": 24,
        "authorCalls": 0, "letterCalls": 0, "retries": 0, "repairCalls": 0, "pairs": pairs,
        "goldens": "Подготовить два контраста на строку, независимая сверка разметки до запуска",
        "runner": "QA single_pass only; NOT pipeline.run, который создаст ещё анализ и письмо",
        "proposedGate": "24/24 по контрастным случаям; порог и эталон подтвердить до платной проверки",
        "priceUSD": None, "priceStatus": "До запуска — отрендеренные входы, лимиты токенов и актуальный тариф",
        "historical20of20": "Другая рубрика, не новая калибровка LAB.QA",
        "requiresSeparateBudgetAuthorization": True, "providerAvailability": "not checked", "executedCalls": 0,
    })
    capture_diff()
    save("TRIAL_PROTOCOL.json", {"version": "2.1", "trialProtocol": [], "manualAcceptance": None,
        "note": "Имена и подготовка согласованы; нового независимого прохода и включения нет"})
    print(json.dumps({"sourceRevision": source["revision"], "draftOnly": True,
                      "documents": [len(d["text"]) for d in load(OUT / "REVISION.json")["documents"]]}))


def pack():
    capture_diff()
    receipt = load(OUT / "REGISTERED.json")
    assert receipt["readerVerified"] and not receipt["runtimeActivation"]
    ts_log = Path("/tmp/lab-preparation-ts-tests.log").read_text()
    py_log = Path("/tmp/lab-preparation-python-tests.log").read_text()
    assert "Test Files" in ts_log and "passed" in ts_log and "FAIL" not in ts_log
    python_count = int(re.search(r"Ran (\d+) tests", py_log)[1])
    assert python_count >= 30 and py_log.rstrip().endswith("OK")
    (OUT / "typescript-tests.log").write_text(ts_log)
    (OUT / "python-tests.log").write_text(py_log)
    save("VALIDATION.json", {
        **receipt, "typeScript": "passed", "pythonOfflineTests": python_count, "externalModelCalls": 0,
        "mail": 0, "productionWrites": 0, "runtimeActivation": False,
        "currentDefault": "No caller supplies qaModel; preparedAnalysis not wired into service",
        "verifiedInOfflineTests": ["same history in both tasks", "separate QA LLM",
            "no fallback after QA failure", "owner/model/environment scope", "explicit size omissions"],
        "notVerified": ["provider access today", "model quality under new prompts", "live improvement"],
    })
    readme = f"""# Замир и Фома — подготовка v2.1, модель rev{receipt['revision']}

P.LAB — Замир Хинтович. P.LG.QA — Фома Хинтович.
Владелец разрешил ТОЛЬКО подготовить R2 и R4. Выполнение, расходы и включение не разрешены.

## R2
Подготовлен read-only prepareOwnerHintInput: явная проверенная серверная привязка
пользователя к модели, owner/environment SQL, только попытки по выбранной проблеме,
версия журнала, время, что меняли, было → стало, подтверждение эффекта или неизвестно.
История ограничена, отсутствие данных и исключение по размеру обозначаются явно.
Отбор до AI пока покрывает кодовые признаки trigger/ios_display/filter; новые семантические
проблемы могут потребовать адресного запроса. Полное покрытие не заявлено.
Нет верной привязки — отказ ДО SQL. Состояние service.ts не изменено: подготовленный
модуль не подключён к текущему обработчику. У сервера ещё нужно проверить реальное
соответствие ownerId и modelOwnerKey; не угадывать его по единственной строке модели.

## R4
runHintLab получил необязательную qaModel для подготовленного пути. Старые вызовы
её не передают. Только этот параметр передаёт частный override дочернему Python;
из глобальных настроек он не наследуется. Автор и письмо остаются на прежней модели.
Сбой QA не вызывает fallback на автора. Включённого переключения нет.
{python_count} Python-теста, включая прежние 23, используют только заглушки/запрет сети.
Новые позитивные промпты и имена ещё НЕ установлены в рабочие агенты.

## До включения
1. Сверить пакет/Dev.diff; подтвердить привязку владельца и фактическую выдачу истории.
2. Подготовить и независимо сверить эталон LAB.QA.
3. CALIBRATION_PLAN.json предлагает 24 QA-вызова без автора/письма; НЕ запускался.
   Цена ещё не рассчитана: нужен отрендеренный вход/лимит/тариф; затем отдельный бюджет.
4. Ручная приёмка и отдельное да на включение; Publish делает владелец.

REGISTERED.json — сохранение тех же документов и истории. DEV.diff — точные изменения.
TRIAL_PROTOCOL.json пустой: новый проход не имитируется. Старые пакеты — в history/.
"""
    (OUT / "README.md").write_text(readme)
    (OUT / "READ_FIRST.html").write_text(
        '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Замир и Фома — подготовка v2.1</title><style>body{font:16px/1.6 system-ui;max-width:950px;'
        'padding:20px;margin:auto;color:#17212b;background:#fafcfc}pre{white-space:pre-wrap;overflow-wrap:anywhere}'
        'summary{cursor:pointer;font-weight:bold}aside{padding:14px;background:#fff1d3}</style>'
        '<aside>Только Dev-подготовка. Никакого включения, платной проверки или публикации.</aside><pre>'
        + html.escape(readme) + '</pre><details><summary>Полный diff кода</summary><pre>'
        + html.escape((OUT / "DEV.diff").read_text()) + '</pre></details></html>')
    files = [p for p in OUT.iterdir() if p.suffix in (".json", ".md", ".html", ".diff", ".log")
             and p.name != "source-model.json" and p.name != "SHA256SUMS.json"]
    payloads = {p.name: p.read_bytes() for p in files}
    payloads["history/prompts_v2.zip"] = (PREVIOUS / "P_LAB_P_LG_QA_prompts_v2.zip").read_bytes()
    for p in ("server/callLab/preparedAnalysis.ts", "server/callLab/preparedAnalysis.test.ts",
              "server/callLab/process.ts", "workers/hint_lab/pipeline.py", "workers/hint_lab/test_prepared_qa.py"):
        payloads["dev/" + p] = Path(p).read_bytes()
    hashes = {k: hashlib.sha256(v).hexdigest() for k, v in payloads.items()}
    payloads["SHA256SUMS.json"] = json.dumps(hashes, indent=2).encode()
    target = OUT / "P_LAB_QA_preparation_v2_1.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in payloads.items():
            z.writestr(name, data)
        assert z.testzip() is None
        for name, digest in hashes.items():
            assert hashlib.sha256(z.read(name)).hexdigest() == digest
    print(json.dumps({"file": str(target), "bytes": target.stat().st_size, "revision": receipt["revision"]}))


if __name__ == "__main__":
    pack() if "--pack" in sys.argv else prepare()
