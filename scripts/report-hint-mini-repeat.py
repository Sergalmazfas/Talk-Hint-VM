"""Offline report. Refuses incomplete runs; never calls any API."""
import json
import math
import statistics
from collections import Counter
from pathlib import Path

out = Path("generated-artifacts/hint-mini-repeat")
x = json.loads((out / "results.json").read_text())
assert (out / "execution-complete.json").exists(), "Wait for the single authorized run"
assert len(x["results"]) == 54 and len(x["judges"]) == 9
assert len({(v["fixtureId"], v["variantId"], v["repeat"]) for v in x["results"]}) == 54
assert all(v["retries"] == 0 for v in x["results"] + x["judges"])
manual = json.loads((out / "engineering-review.json").read_text())
assert manual["outputsRead"] == sum(r["status"] == "completed" for r in x["results"])
reviews = {}
semantic_rejections = []
for j in x["judges"]:
    if j["status"] == "completed":
        scope_errors = []
        for r in j["reviews"]:
            mapping = j["mapping"][r["candidateId"]]
            generated = next(g for g in x["results"] if g["fixtureId"] == j["fixtureId"]
                             and g["variantId"] == mapping["variantId"] and g["repeat"] == mapping["repeat"])
            s = generated["output"]["suggestion"]
            owner_texts = [s.get("en", ""), s.get("translation", ""), s.get("native_helper", "")]
            owner_texts += [o.get(k, "") for o in s.get("options", []) for k in ["en", "translation"]]
            for issue in r["issues"]:
                if not any(issue["quote"] in text for text in owner_texts):
                    scope_errors.append(dict(candidateId=r["candidateId"], quote=issue["quote"],
                                             reason="Цитата не принадлежит ответу/инструкции Owner"))
        if scope_errors:
            semantic_rejections.append(dict(fixtureId=j["fixtureId"], issues=scope_errors))
            continue
        for r in j["reviews"]:
            m = j["mapping"][r["candidateId"]]
            reviews[(j["fixtureId"], m["variantId"], m["repeat"])] = r


def quantile(values, q):
    return round(sorted(values)[max(0, math.ceil(len(values) * q) - 1)]) if values else None


table = []
for v in x["variants"]:
    generated = [r for r in x["results"] if r["variantId"] == v["id"] and r["status"] == "completed"]
    judged = [reviews[(r["fixtureId"], v["id"], r["repeat"])] for r in generated
              if (r["fixtureId"], v["id"], r["repeat"]) in reviews]
    goal = Counter(r["goalRetention"] for r in judged)
    categories = {c: sum(any(i["category"] == c for i in r["issues"]) for r in judged)
                  for c in ["unsupported_fact", "speaker_error", "omission", "irrelevant", "ambiguity"]}
    table.append(dict(variant=v["id"], completed=len(generated), scheduled=27,
        p50Ms=quantile([r["completeJsonMs"] for r in generated], .5),
        p95Ms=quantile([r["completeJsonMs"] for r in generated], .95),
        firstDeltaP50Ms=quantile([r["firstDeltaMs"] for r in generated if r.get("firstDeltaMs") is not None], .5),
        judged=len(judged), qualityUnknown=len(generated)-len(judged),
        goal={k: goal[k] for k in ["yes", "partial", "no", "unknown"]},
        issuesPerOutput=categories,
        goalOpportunities=sum(r["goalFactOpportunity"] for r in judged),
        timelyGoal=sum(r["goalFactOpportunity"] and r["goalFactUsedTimely"] for r in judged),
        wordsMedian=statistics.median([r["totalEnglishWords"] for r in generated]) if generated else None,
        wordsMax=max((r["totalEnglishWords"] for r in generated), default=None),
        cardsMedian=statistics.median([r["cardCount"] for r in generated]) if generated else None,
        cardsMax=max((r["cardCount"] for r in generated), default=None),
        oneCardOutputs=sum(r["cardCount"] == 1 for r in generated),
        shortSingleOutputs=sum(r["cardCount"] == 1 and r["totalEnglishWords"] <= 12 for r in generated)))

pair_ids = ["call3-turn1", "call3-turn2", "call3-turn3", "call1-turn3", "call2-turn1"]
pairs = []
for fid in pair_ids:
    f = next(f for f in x["fixtures"] if f["id"] == fid)
    rows = [next(r for r in x["results"] if r["fixtureId"] == fid and r["repeat"] == 1 and r["variantId"] == vid)
            for vid in ["mini_baseline", "mini_combined"]]
    pairs.append(dict(fixtureId=fid, repeat=1, call=f["label"], guest=f["guest"],
                      before=rows[0].get("output"), after=rows[1].get("output"),
                      beforeMs=round(rows[0].get("completeJsonMs", 0)), afterMs=round(rows[1].get("completeJsonMs", 0)),
                      note="Заранее фиксированный первый повтор; не подбор лучших ответов"))
usage = Counter()
reported = 0
for row in x["results"] + x["judges"]:
    if row.get("usage"):
        reported += 1
        for name in ["prompt_tokens", "completion_tokens"]:
            usage[name] += row["usage"].get(name, 0)
summary = dict(
    generations=sum(r["status"] == "completed" for r in x["results"]), scheduledGenerations=54,
    judgeGroups=sum(j["status"] == "completed" for j in x["judges"]), scheduledJudgeGroups=9,
    semanticallyRejectedJudgeGroups=len(semantic_rejections),
    judgedOutputs=len(reviews), unknownQuality=sum(r["status"] == "completed" for r in x["results"])-len(reviews),
    table=table, retries=0, productionChanged=False, ownerAcceptance=None,
    qualityGate="Не пройден: сохранены ошибки кандидатов и/или ограничения проверки; не разрешение выпуска",
    modelJudgeScoresAreGroundTruth=False,
    usage=dict(reportedForRequests=reported, tokens=dict(usage), monetaryCost=None,
               note="Usage API не счёт; стоимость и расход при сбоях неизвестны"))
limitations = list(x["limitations"]) + [
    "Три повтора на девяти моментах не являются 27 независимыми диалогами.",
    "AI-судья проверяет шесть кандидатов в одной группе; его ошибки могут коррелировать.",
    "Усиленный промпт содержит прямые запреты; их наличие не доказывает исполнение.",
    "Ручной обзор HEAD.07 — не независимая QA и не проверка аудио/экрана.",
]
recommendation = {
    "role": "P.PRODUCT", "status": "Предложение; запуск и перенос в продукт не разрешены",
    "decision": "Не переносить ни один вариант в рабочий Hint по этим данным",
    "nextStep": "Сначала оформить текстовый контракт безопасных ответов для неизвестных действий/выбора и эталонную проверку; затем отдельное решение о следующем стенде",
    "scope": "Без новых API-вызовов в этом пакете, без изменения продукта",
}
report = dict(version=1, caseId="HINT-OWNER-FEEDBACK-001",
    sourceDecision="HINT-OWNER-FEEDBACK-001/NEED-DECISION/2",
    design=x["design"], summary=summary, beforeAfterPairs=pairs,
    engineeringReview=manual, semanticJudgeRejections=semantic_rejections,
    limitations=limitations, recommendation=recommendation,
    evidence=dict(raw="results.json", reference="fact-reference.json", reservation="reservation.json"),
    productionChanged=False, ownerAcceptance=None)
(out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
lines = ["# P.LAB → P.PRODUCT: повторный стенд Mini", "",
    "**Только Dev и сохранённый текст; продукт не менялся. QA-гейт не пройден.**", "",
    f"Ответы {summary['generations']}/54; протоколы отдельного судьи {summary['judgeGroups']}/9; "
    f"после offline-проверки адресата цитат доступно {summary['judgedOutputs']} оценок; "
    f"отклонено групп {len(semantic_rejections)}, ответов без пригодной оценки {summary['unknownQuality']}. "
    "Повторов запросов: 0.", "",
    "| Вариант | Ответы | p50 / p95, мс | Цель: да / частично / нет / ? | Выдумки, AI | Слов: медиана / max | Карточек: медиана / max |",
    "|---|---|---|---|---|---|---|"]
for t in table:
    g = t["goal"]
    lines.append(f"| {t['variant']} | {t['completed']}/27 | {t['p50Ms']} / {t['p95Ms']} | "
                 f"{g['yes']} / {g['partial']} / {g['no']} / {g['unknown']} из {t['judged']} | "
                 f"{t['issuesPerOutput']['unsupported_fact']}/{t['judged']} | "
                 f"{t['wordsMedian']} / {t['wordsMax']} | {t['cardsMedian']} / {t['cardsMax']} |")
lines += ["", "Метки выдумок — оценки AI, не подтверждённый эталон. Пропуски ответа и неоднозначность считаются отдельно.",
          "Время — до полного JSON, не до экрана. Число карточек — структура ответа, не iPhone.", "",
          "## Проверка источников HEAD.07 (не независимая QA)", ""]
for f in manual["findings"]:
    lines.append("- " + f["finding"])
lines += ["", "## Пять пар «было → стало»", ""]
for p in pairs:
    def phrase(v):
        if v is None: return "Нет успешного ответа"
        s = v["suggestion"]
        return " / ".join(o["en"] for o in s["options"]) if s["type"] == "choice" else s["en"]
    lines += [f"### {p['call']} · {p['fixtureId']} · первый повтор",
              f"Собеседник: {p['guest']}", f"- Было: {phrase(p['before'])}",
              f"- Стало: {phrase(p['after'])}", f"- Время: {p['beforeMs']} → {p['afterMs']} мс.", ""]
lines += ["## Ограничения", ""] + ["- " + l for l in limitations]
lines += ["", "## Передача продукту", recommendation["decision"], recommendation["nextStep"],
          "", "Фактическая приёмка владельца: отсутствует. Никакие функции продукта не получили статус внедрения.",
          f"Usage в {reported}/63 запросах: {usage['prompt_tokens']} входных и {usage['completion_tokens']} выходных токенов. "
          "Сумма расходов неизвестна; это не счёт."]
(out / "REPORT.md").write_text("\n".join(lines))
print(json.dumps(summary, ensure_ascii=False))
