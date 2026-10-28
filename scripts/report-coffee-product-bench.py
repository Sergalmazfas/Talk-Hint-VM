"""Calculate code metrics, expose actual separate-model judgments, package evidence."""
import json
import math
from pathlib import Path
from datetime import datetime, timezone

out = Path("generated-artifacts/coffee-product-decisions")
assert (out / "execution-complete.json").exists(), "Wait for bounded run to finish"
x = json.loads((out / "results.json").read_text())
fixtures = {f["id"]: f for f in x["fixtures"]}
reviews = {}
for j in x["judges"]:
    if j["status"] == "completed":
        for r in j["reviews"]:
            reviews[(j["fixtureId"], j["mapping"][r["candidateId"]])] = r


def quantile(values, p):
    values = sorted(values)
    return None if not values else round(values[max(0, math.ceil(p * len(values)) - 1)])


table = []
for v in x["variants"]:
    allrows = [r for r in x["results"] if r["variantId"] == v["id"]]
    rows = [r for r in allrows if r["status"] == "completed"]
    rated = [(r, reviews[(r["fixtureId"], v["id"])]) for r in rows
             if (r["fixtureId"], v["id"]) in reviews]
    latency = [r["completeJsonMs"] for r in rows]
    words = [r["totalEnglishWords"] for r in rows]
    cards = [r["cardCount"] for r in rows]
    opportunity = [q for _, q in rated if q["goalFactOpportunity"]]
    table.append(dict(
        variantId=v["id"], label=v["name"], model=v["model"],
        success=len(rows), scheduled=len(allrows), failed=len(allrows)-len(rows),
        completeJsonP50Ms=quantile(latency, .5), completeJsonP95Ms=quantile(latency, .95),
        firstDeltaP50Ms=quantile([r["firstDeltaMs"] for r in rows if r.get("firstDeltaMs") is not None], .5),
        judged=len(rated), goalRetained=sum(q["goalRetention"] == "yes" for _, q in rated),
        goalPartial=sum(q["goalRetention"] == "partial" for _, q in rated),
        goalNo=sum(q["goalRetention"] == "no" for _, q in rated),
        goalUnknown=sum(q["goalRetention"] == "unknown" for _, q in rated),
        hintsWithInventedFacts=sum(bool(q["inventedFacts"]) for _, q in rated),
        speakerErrors=sum(q["speakerRoleError"] for _, q in rated),
        goalOpportunities=len(opportunity),
        goalUsedTimely=sum(q["goalFactUsedTimely"] for q in opportunity),
        totalEnglishWordsP50=quantile(words, .5), maxEnglishWords=max(words, default=None),
        jsonCardsP50=quantile(cards, .5), maxJsonCards=max(cards, default=None),
        unknownQuality=len(rows)-len(rated),
    ))
by = {(r["fixtureId"], r["variantId"]): r for r in x["results"] if r["status"] == "completed"}
candidates = []
for f in x["fixtures"]:
    baseline = by.get((f["id"], "baseline_terra"))
    if not baseline:
        continue
    for variant in ["single_terra", "goal_terra", "grounded_terra", "baseline_mini", "baseline_luna"]:
        r = by.get((f["id"], variant))
        q = reviews.get((f["id"], variant))
        if not r or not q or q["speakerRoleError"] or q["inventedFacts"] or q["goalRetention"] not in ["yes", "partial"]:
            continue
        if r["output"]["suggestion"] == baseline["output"]["suggestion"]:
            continue
        candidates.append(dict(
            fixtureId=f["id"], call=f["label"], variantId=variant,
            guest=f["guest"], goalOrigin=f["goalOrigin"],
            before=baseline["output"]["suggestion"], after=r["output"]["suggestion"],
            beforeMs=round(baseline["completeJsonMs"]), afterMs=round(r["completeJsonMs"]),
            beforeCards=baseline["cardCount"], afterCards=r["cardCount"],
            judge=q, baselineJudge=reviews.get((f["id"], "baseline_terra")),
            kind="Два результата текущего текстового стенда, не историческая подсказка и не внедрённое улучшение",
        ))
        break
chosen = []
for fid, variant in [
    ("call3-turn1", "grounded_terra"),
    ("call3-turn2", "baseline_luna"),
    ("call3-turn3", "single_terra"),
    ("call2-turn1", "baseline_mini"),
    ("call1-turn3", "single_terra"),
]:
    before, after = by.get((fid, "baseline_terra")), by.get((fid, variant))
    if not before or not after:
        continue
    f = fixtures[fid]
    chosen.append(dict(
        fixtureId=fid, call=f["label"], variantId=variant, guest=f["guest"],
        goalOrigin=f["goalOrigin"], before=before["output"]["suggestion"],
        after=after["output"]["suggestion"],
        beforeMs=round(before["completeJsonMs"]), afterMs=round(after["completeJsonMs"]),
        beforeCards=before["cardCount"], afterCards=after["cardCount"],
        judge=reviews.get((fid, variant)),
        baselineJudge=reviews.get((fid, "baseline_terra")),
        kind="Пара стенда: не внедрённое улучшение; показаны и компромиссы",
    ))

engineering_review = dict(
    role="HEAD.07 — проверка источников и результатов, НЕ независимая QA",
    performedBy="Replit в текущем запросе",
    sourceRule="Только история до выбранной реплики и явная цель; шумный STT не эталон аудио",
    findings=[
        dict(fixtureId="call3-turn2", variants=["baseline_terra", "baseline_mini", "single_terra"],
             category="Неподтверждённая конкретизация",
             outputQuotes=["the lid doesn’t fit well", "was not fitting well", "didn’t fit properly"],
             sourceQuote='Owner: "the glasses did the the caps, it\'s not good"',
             conclusion="До этого момента сказано, что с крышками проблема, но не что причина в посадке/размере. AI-судья пропустил конкретизацию у всех трёх вариантов.",
             blocksRelease=True),
        dict(fixtureId="call3-turn2", variants=["grounded_terra"],
             category="Спорная метка судьи",
             outputQuote="the lid on the coffee cup was not good",
             conclusion="Фраза близка к явному caps, it's not good в истории. Метка «выдумка» не выглядит обоснованной; не переписываем исходный вердикт задним числом.",
             blocksRelease=False),
        dict(fixtureId="call3-turn3", variants=["goal_terra"],
             category="Неверная категория замечания судьи",
             conclusion="Пропущенный вопрос о размере — вопрос полезности/полноты, не выдуманный факт. Исходную оценку сохраняем отдельно.",
             blocksRelease=False),
        dict(fixtureId="call3-turn3", variants=["single_terra"],
             category="Компромисс читаемости",
             conclusion="Сохранились две карточки. Не выбирать неизвестный размер за владельца правильно, но задача чтения за секунду этим не доказана.",
             blocksRelease=True),
        dict(fixtureId="call1-turn2", variants="все шесть",
             category="Неполный протокол независимого судьи",
             conclusion="Ответ содержал одну оценку вместо шести. Контракт отклонён, все шесть оценок неизвестны. Без повтора.",
             blocksRelease=True),
    ],
    fullManualAnnotation=False,
    note="Проверка явных расхождений, не независимая сплошная разметка всех 53 ответов. Нельзя утверждать ноль выдумок по одной модельной оценке.",
)

tokens = {"prompt_tokens": 0, "completion_tokens": 0}
with_usage = 0
for r in x["results"] + x["judges"]:
    u = r.get("usage")
    if isinstance(u, dict):
        with_usage += 1
        for k in tokens:
            tokens[k] += u.get(k) or 0
summary = dict(
    generationsCompleted=sum(r["status"] == "completed" for r in x["results"]),
    scheduledGenerations=len(x["results"]),
    judgesCompleted=sum(j["status"] == "completed" for j in x["judges"]),
    scheduledJudges=len(x["judges"]),
    judgedOutputs=len(reviews), independentModel="gpt-5.2",
    ownerAcceptance=None, productionChanged=False,
    qualityGateStatus="не пройдена: неполный QA-протокол и расхождения судьи с источниками",
    modelJudgeCountersAreGroundTruth=False,
    generatedOutputsWithoutValidJudge=sum(r["status"] == "completed" for r in x["results"]) - len(reviews),
    table=table,
    usage=dict(reportedForRequests=with_usage, tokens=tokens, monetaryCost=None,
               limit="Не счёт: ошибки/неполная usage могут расходовать средства; цена в этом опыте не вычислялась."),
)
result = dict(format="talkhint.hint-product-lab-review", version=1,
              at=datetime.now(timezone.utc).isoformat(), sourceCaseId="HINT-OWNER-FEEDBACK-001",
              sourceModelRevision=835, authorizationRef="owner_authorization.json",
              summary=summary, pairs=chosen, limitations=x["limitations"],
              rawResults="results.json", artifactPath="generated-artifacts/coffee-product-decisions",
              next="Новое «Нужно решение»; до него не менять продукт",
              acceptsPreviousQa=False,
              engineeringReview=engineering_review,
              nextDecisionRequest=dict(
                  id="HINT-OWNER-FEEDBACK-001/NEED-DECISION/2", version=1,
                  status="ожидает решения владельца", ownerAnswer=None,
                  rows=[dict(
                      rowId="COFFEE-NEXT-1",
                      proposal="Следующий только текстовый стенд: Mini с проверенными фактами и короткой основной фразой против того же Mini без усилений; три повтора на девяти моментах.",
                      reason="Mini быстрее в этой выборке, но тоже добавила неподтверждённый факт. Комбинация Mini + усиления ещё не проверялась.",
                      beforeRun="Зафиксировать эталон фактов/неизвестного по каждому моменту, исправить категории и контракт проверки качества; не подгонять ответы под судью.",
                      maximumCalls=dict(generation=54, separateJudge=9, retries=0),
                      scope="Только Dev и те же сохранённые тексты; никакого продукта, аудио, звонков, публикации или включения P.PRODUCT.",
                      cost="Существующий API; сумма неизвестна, новые подписки не нужны.",
                      ownerAnswer=None, acceptedBy=None)]),
              note="Самостоятельная модельная экспертиза этого опыта не закрывает прежний QA-возврат разбора кофейни.")
(out / "review-results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))


def display(s):
    if s["type"] == "choice":
        return " / ".join(o["en"] for o in s["options"])
    return s.get("en") or f"[Нужен ответ владельца: {s.get('native_helper', '')}]"


lines = [
    "# P.LAB → P.PRODUCT · кофейня №1 · согласованные проверки 1–4",
    "",
    "Только Dev и сохранённые тексты. Ничего не перенесено в продукт. Аудио отложено.",
    f"Получено {summary['generationsCompleted']} из {summary['scheduledGenerations']} результатов; "
    f"отдельный gpt-5.2 выполнил {summary['judgesCompleted']} из {summary['scheduledJudges']} проверок.",
    "",
    "## Таблица вариантов",
    "",
    "| Вариант | Ответы | JSON p50/p95, мс | Цель: да / частично / нет / ? | С выдумкой / оценено | Ошибка роли / оценено | Факты вовремя / возможности | EN слов p50/max | Карточки p50/max |",
    "|---|---:|---:|---|---|---|---|---:|---:|",
]
for r in table:
    lines.append(
        f"| {r['label']} | {r['success']}/{r['scheduled']} | {r['completeJsonP50Ms']}/{r['completeJsonP95Ms']} "
        f"| {r['goalRetained']}/{r['goalPartial']}/{r['goalNo']}/{r['goalUnknown']} из {r['judged']} "
        f"| {r['hintsWithInventedFacts']}/{r['judged']} | {r['speakerErrors']}/{r['judged']} "
        f"| {r['goalUsedTimely']}/{r['goalOpportunities']} "
        f"| {r['totalEnglishWordsP50']}/{r['maxEnglishWords']} | {r['jsonCardsP50']}/{r['maxJsonCards']} |")
lines += ["", "Цель/выдумки/роль — отдельная AI-оценка с пояснениями в JSON, не факт использования владельцем.",
          "**QA-гейт не пройден:** судья вернул неполный протокол одного момента и пропустил неподтверждённые факты. Его счётчики — не эталон истины.",
          "Слова/карточки/время считает код. Карточки — структура JSON, не проверенный экран iPhone.",
          "p95 при 8–9 наблюдениях — верхний край этой маленькой выборки, не обещание скорости.",
          "", "## Пары «было → стало»",
          "", "«Было» = реконструкция Dev-промпта; «стало» = вариант стенда. Ни одна пара не доказывает внедрение."]
for i, c in enumerate(chosen, 1):
    lines += ["", f"### {i}. {c['call']} · {c['variantId']}",
              f"Собеседник: {c['guest']}", f"- Было: {display(c['before'])}",
              f"- Стало: {display(c['after'])}",
              f"- Время текста: {c['beforeMs']} → {c['afterMs']} мс; карточки {c['beforeCards']} → {c['afterCards']}.",
              f"- Отдельная модельная оценка: {c['judge']['explanation']}"]
lines += ["", "## Проверка источников HEAD.07 — не независимая QA"]
for finding in engineering_review["findings"]:
    lines.append(f"- {finding['fixtureId']}: {finding['conclusion']}")
lines.append(engineering_review["note"])
lines += ["", "## Ограничения"] + [f"- {s}" for s in x["limitations"]]
lines += ["", "## Реальные сбои"]
for r in x["results"] + x["judges"]:
    if r["status"] != "completed":
        lines.append(f"- {r.get('fixtureId')} / {r.get('variantId', 'judge')}: {r['status']} {r.get('errorCode', '')}; без повтора и подмены модели.")
lines += ["", "## Стоимость", f"Сообщённые API токены: {tokens['prompt_tokens']} входных и {tokens['completion_tokens']} выходных. "
          "Денежная сумма неизвестна; это не invoice и не подтверждение нулевых расходов.",
          "", "## Передача", "P.LAB передал факты P.PRODUCT в текущем запросе. Принятия владельцем улучшения нет. "
          "Прежний QA-возврат разбора кофейни этим опытом не закрывается."]
(out / "REPORT.md").write_text("\n".join(lines) + "\n")
print(json.dumps({"summary": summary, "pairs": len(chosen)}, ensure_ascii=False))
