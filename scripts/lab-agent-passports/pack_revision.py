"""Deliver the corrected proposal and actual received pass without overwriting v1."""
import hashlib
import html
import json
import zipfile
from pathlib import Path

OUT = Path("generated-artifacts/lab-agent-passports-v2")
OLD = Path("generated-artifacts/lab-agent-passports")


def load(file):
    return json.loads(Path(file).read_text())


receipt = load(OUT / "REGISTERED.json")
assert receipt["version"] == 2 and receipt["readerVerified"] and not receipt["runtimeActivation"]
assert all(receipt[k] for k in ("operatingModelUnchanged", "activePassportsUnchanged", "oldCasesPreserved"))
test_log = Path("/tmp/lab-prompts-v2-tests.log").read_text()
assert "Ran 8 tests" in test_log and test_log.rstrip().endswith("OK")
(OUT / "offline-tests.log").write_text(test_log)
roles = [load(OUT / (code + ".json")) for code in ("P.LAB", "P.LG.QA")]
index = load(OUT / "PACKAGE.json")
for code in ("P.LAB", "P.LG.QA"):
    full = load(OUT / (code + ".json"))
    assert full["trialProtocol"] == [] and full["manualAcceptance"] is None
old_archive = OLD / "P_LAB_P_LG_QA_passports_v1.zip"
source_review = Path("attached_assets/0_Prompts_pass_rev904_v1_1793220762393.zip")
(OUT / "VALIDATION.json").write_text(json.dumps({
    **receipt, "offlineTests": {"passed": 8, "failed": 0, "socket": "forbidden"},
    "typeScript": "npm run check passed", "externalCalls": 0, "mail": 0, "productionWrites": 0,
    "independentReacceptanceOfV2": False, "newProtocolEmpty": True, "namesSelected": False,
    "historicalReviewPreserved": True, "runtimeFilesUnchanged": True,
    "qaModel": "not switched; gpt-5.4 historical calibration is not current LAB.QA calibration",
    "historyInput": "designed; not implemented or granted", "activation": "blocked",
    "v1ArchiveSha256": hashlib.sha256(old_archive.read_bytes()).hexdigest(),
    "receivedReviewSha256": hashlib.sha256(source_review.read_bytes()).hexdigest(),
    "visualVerification": "existing public landing only; no screen changes; signed-in UI not verified",
}, ensure_ascii=False, indent=2))
(OUT / "README.md").write_text((OUT / "README.md").read_text() +
    f"\nСохранено в существующей модели rev{receipt['revision']}, правки от rev{receipt['sourceRevision']}. "
    "Те же ID документов, тот же случай журнала; прежние версии — в истории модели и history/ архива. "
    "Повторная независимая приёмка v2 ещё не выполнена.\n")
diff_sections = ""
for role in roles:
    code = role["roleCode"]
    lines = (OUT / (code + ".v1-to-v2.diff")).read_text().splitlines()
    rendered = "\n".join('<span class="' + ("add" if s.startswith("+") else "del" if s.startswith("-") else "") +
                         '">' + html.escape(s) + "</span>" for s in lines)
    diff_sections += (
        f'<h2>{html.escape(code)}</h2><p>Имя ещё не выбрано: '
        f'{html.escape(", ".join(role["visualPassport"]["nameOptions"]))}.</p>'
        f'<details><summary>Точный diff JSON v1 → v2</summary><pre>{rendered}</pre></details>'
        f'<details><summary>Полная новая инструкция — предложение</summary><pre>'
        f'{html.escape(role["prompt"]["backstory"])}</pre></details>')
decision_rows = "".join(
    f'<tr><td>{d["id"]}</td><td>{html.escape(d["what"])}<br><small>{html.escape(d["recommendation"])}</small></td>'
    f'<td>{html.escape(d["effect"])}</td><td>Ждёт да/нет</td></tr>' for d in index["ownerDecisions"])
(OUT / "DIFF_AND_DECISIONS.html").write_text(
    '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    '<title>P.LAB / P.LG.QA — исправления v2 и решения</title><style>'
    'body{margin:0;background:#f5f7f8;color:#17212b;font:16px/1.5 system-ui}main{max-width:1050px;margin:auto;padding:20px}'
    'aside,details{background:white;border:1px solid #d5dfe3;border-radius:8px;padding:14px;margin:16px 0}'
    'aside{background:#fff1d3}pre{font:13px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}'
    'pre span{display:inline}.add{background:#dff7e8;color:#075529}.del{background:#ffe1df;color:#852c25}'
    'table{border-collapse:collapse;min-width:680px;width:100%}td,th{border:1px solid #d5dfe3;padding:10px;vertical-align:top}'
    '.scroll{overflow:auto}summary{cursor:pointer;font-weight:600}h1{font-size:26px}small{color:#46535f}'
    '</style><main><h1>Промпты лаборатории — исправления v2</h1>'
    f'<aside>Сохранено rev{receipt["revision"]}, исходный проход rev904. Это предложения, не рабочие промпты. '
    'Ничего не включено. Имена не назначены. Новый ручной проход не имитировался.</aside>'
    '<h2>Короткий diff</h2><ul>'
    '<li><del>Ограничения перед миссией</del> → <ins>миссия первой, пять приоритетов владельца, одно слабое звено, 1–3 улучшения</ins>.</li>'
    '<li><del>История только после AI</del> → <ins>спроектирован вход истории конкретной проблемы; внедрение ждёт R2</ins>.</li>'
    '<li><del>Характер — три прилагательных</del> → <ins>«как говорю» в промптах и схеме; голос не заменяет факты</ins>.</li>'
    '<li><del>P.LAB #0F766E</del> → <ins>#1E4E79</ins>. Только цвет должности, не статус работы.</li>'
    '</ul><h2>Нужно решение</h2><p>«Да» — только подготовка Dev-изменения. Не запуск, не расходы и не Publish.</p>'
    '<div class="scroll"><table><thead><tr><th>ID</th><th>Что сделать</th><th>Эффект</th><th>Решение</th></tr></thead><tbody>'
    + decision_rows + '</tbody></table></div><p>20/20 GPT-5.4 подтверждены в сохранённой калибровке '
    'прежней рубрики. Это не готовая калибровка нынешнего Скептика и не проверка доступности модели сейчас.</p>'
    + diff_sections + '</main></html>')
files = [
    "README.md", "DIFF_AND_DECISIONS.html", "PACKAGE.json", "P.LAB.json", "P.LG.QA.json",
    "P.LAB.proposed.txt", "P.LG.QA.proposed.txt", "P.LAB.v1-to-v2.diff", "P.LG.QA.v1-to-v2.diff",
    "PACKAGE.v1-to-v2.diff", "visual-passport.schema.json", "NEEDS_DECISION.json",
    "PROBLEM_HISTORY_INPUT_CONTRACT.json", "QA_MODEL_EVIDENCE.json", "CORRECTIONS.json",
    "TRIAL_PROTOCOL.json", "TRIAL_PROTOCOL_PASS_v1.json", "01_Проход_промптов_v1.md",
    "REVISION.json", "REGISTERED.json", "VALIDATION.json", "offline-tests.log",
]
payloads = {f: (OUT / f).read_bytes() for f in files}
payloads["history/P_LAB_P_LG_QA_passports_v1.zip"] = old_archive.read_bytes()
payloads["history/Prompts_pass_rev904_v1.zip"] = source_review.read_bytes()
for file in ("CURRENT.json", "CURRENT_TASK_CAPTURES.json", "pipeline.current.py", "MODEL_LINKS.json", "EVIDENCE.json"):
    payloads[file] = (OLD / file).read_bytes()
manifest = {f: hashlib.sha256(b).hexdigest() for f, b in payloads.items()}
payloads["SHA256SUMS.json"] = json.dumps(manifest, indent=2).encode()
target = OUT / "P_LAB_P_LG_QA_prompts_v2.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in payloads.items():
        z.writestr(name, data)
    assert z.testzip() is None
    for name, digest in manifest.items():
        assert hashlib.sha256(z.read(name)).hexdigest() == digest
print(json.dumps({"file": str(target), "revision": receipt["revision"], "version": 2,
                  "bytes": target.stat().st_size, "runtimeActivation": False}))
