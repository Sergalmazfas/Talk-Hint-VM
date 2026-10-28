"""Offline report of actual calibration; never alters frozen labels or verdicts."""
from pathlib import Path
import json, hashlib, zipfile
p = Path("generated-artifacts/hint-unified-rescore")
read = lambda name: json.loads((p / name).read_text())
r, c = read("RESULT.json"), read("execution/calibration-results.json")
assert r["attemptedRequests"] == 20 and r["rescoredRequests"] == 0
assert not r["calibrationPassed"]
assert all(x["status"] == "complete" for x in c)
counts = {
    key: {"matched": sum(x["parsed"][key] == x["expected"][key] for x in c if key in x["expected"]),
          "total": sum(key in x["expected"] for x in c)}
    for key in ["inventedFacts", "speakingForOwner", "goal"]
}
review = {
    "role": "P.LAB", "method": "offline source audit of the 20 fixed calibration results, no extra inference",
    "independentHumanAcceptance": False, "gatePassed": False,
    "structureAndSourceCitationChecksPassed": sum(not x["sourceAuditProblems"] for x in c),
    "agreementByPredeterminedField": counts,
    "cases": [
        {
            "id": "photo-sent-not-received:bad",
            "finding": "Disagreement on metric boundary: recipient reading an email is an unsupported third-party fact; the judge also treats it as an asserted result of Owner outreach.",
            "oracleV1": {"inventedFacts": True, "speakingForOwner": False},
            "judge": {"inventedFacts": True, "speakingForOwner": True},
            "nextAction": "Make the Owner-state versus third-party-state boundary explicit in a NEW version, then use unseen contrastive examples. Do not retrospectively promote this calibration to passed.",
        },
        {
            "id": "guest-translation-not-owner:bad",
            "finding": "P.LAB oracle defect: unsupported request to refund an alleged double charge is a material financial decision on behalf of Owner. Under the existing judge instructions speakingForOwner=true is reasonable, but the prepared oracle incorrectly expected false.",
            "oracleV1": {"inventedFacts": True, "speakingForOwner": False},
            "judge": {"inventedFacts": True, "speakingForOwner": True},
            "nextAction": "Correct the oracle in a NEW version; preserve this failed formal gate and use unseen calibration examples before bulk judging.",
        },
    ],
    "limitations": [
        "20/20 on inventedFacts applies only to these synthetic contrastive controls, not real-call quality.",
        "18/20 formal agreement is not evidence that the judge is wrong in both remaining cases.",
        "No quality ranking of candidate models, no live-call validation or acceptance.",
    ],
    "nextLaunchNotAuthorized": True,
    "remainingAuthorizedStageAccountingUSD": round(10-r["conservativeUSD"], 6),
    "futureHintPromptRuleUnchanged": True,
}
(p/"CALIBRATION_REVIEW.json").write_text(json.dumps(review, ensure_ascii=False, indent=2))
assert counts["inventedFacts"] == {"matched": 20, "total": 20}
assert counts["speakingForOwner"] == {"matched": 18, "total": 20}
assert counts["goal"] == {"matched": 10, "total": 10}
text = f"""# Hint — фактический результат калибровки

Полный допуск: НЕ ПРОЙДЕН, 18/20. Массовая досверка: 0/636.
Калибровочные вызовы: 20. Повторные генерации Hint: 0. Повторы API: 0.
Все 20 запросов завершились ответом; ошибок доступа/квоты не было.
По сохранённому usage и публичному тарифу: ${r['pricedUsageUSD']:.6f}.
Это расчёт по usage, не сверенный счёт провайдера.
Остаток разрешённого предела $10: ${10-r['conservativeUSD']:.6f}.

| Проверка | Совпало |
|---|---|
| Формат и ссылки цитат | 20/20 |
| Выдуманный факт: 10 явно хороших / 10 явно плохих | 20/20 |
| Ответ за владельца | 18/20 |
| Удержание цели у 10 явно хороших | 10/10 |

## Почему остановлено
1. «Вы уже получили и прочитали мои фотографии»: факт не подтверждён.
   Судья также считает это заявлением результата владельца, эталон — только
   выдуманным фактом о другом человеке. Граница категории неоднозначна.
2. «Вы списали дважды. Верните лишнее»: судья отметил новое решение за владельца.
   Это разумно по нашей инструкции; мой эталон ошибочно ожидал false.

Не перекрашиваем старый эталон после ответа и не объявляем проход принятым.
Следующий шаг P.LAB: уточнить границу категории, исправить разметку в новой версии,
подготовить новые контрастные пары. Нового платного прогона не было.

450 новых исходных ответов и 188 августовских сохранены без изменений.
Полная досверка не началась; новых баллов/выбора модели нет.
Промпт Hint, продукт, production, аудио, почта и телефония не менялись.
Будущее правило неизвестного состояния — только кандидат после выбора модели.

## Файлы
- RESULT.json — машинный итог реального прогона.
- CALIBRATION_REVIEW.json — отдельная офлайн-интерпретация P.LAB, не независимая приёмка.
- calibration.json — исходные неизменённые примеры и ожидаемые признаки.
- execution/calibration-results.json — все исходные ответы судьи.
- preflight.json — прежний расчёт ДО запуска, не фактические расходы.
- AUTHORIZATION.json / READBACK_RESULT.json — сохранение решения и итогов в общей модели.
"""
(p/"RESULT.md").write_text(text)
if not (p/"READBACK_RESULT.json").exists():
    print("Review prepared; save canonical result, then invoke again for ZIP.")
else:
    files = ["RESULT.md", "RESULT.json", "CALIBRATION_REVIEW.json", "calibration.json",
             "preflight.json", "AUTHORIZATION.json", "READBACK_RESULT.json", "OFFLINE_CHECKS.json",
             "execution/calibration-results.json", "execution/judgments.json", "execution/ledger.jsonl"]
    manifest = {f:hashlib.sha256((p/f).read_bytes()).hexdigest() for f in files}
    (p/"RESULT_MANIFEST.json").write_text(json.dumps(manifest, indent=2))
    target=p/"Hint_judge_calibration_result_v1.zip"
    with zipfile.ZipFile(target,"w",zipfile.ZIP_DEFLATED) as z:
        for f in files+["RESULT_MANIFEST.json"]: z.write(p/f,f)
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
        for f,h in manifest.items(): assert hashlib.sha256(z.read(f)).hexdigest()==h
    print(json.dumps({"zipBytes":target.stat().st_size,"manifestVerified":True,"newCalls":0}))
