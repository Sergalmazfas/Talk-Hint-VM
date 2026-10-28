"""Offline aggregation only; all AI verdicts remain estimates with explicit denominators."""
import json, math, statistics, hashlib
from pathlib import Path
from collections import Counter
from html import escape

p = Path("generated-artifacts/hint-unified-preflight")
x = p / "execution"
gens = json.loads((x / "generations.json").read_text())
judges = json.loads((x / "judgments.json").read_text())
receipt = json.loads((x / "execution-complete.json").read_text())
ledger = [json.loads(s) for s in (x / "ledger.jsonl").read_text().splitlines()]
plan = json.loads((p / "preflight.json").read_text())
refs = json.loads((p / "frozen-reference-v1.json").read_text())
old = json.loads((p / "old-answers-preserved.json").read_text())
assert len(gens) == 450
assert receipt["attempted"] <= 1088 and receipt["chargedConservativeUSD"] <= 35
assert len(ledger) == receipt["attempted"]
assert abs(sum(r["chargedConservativeUSD"] for r in ledger) - receipt["chargedConservativeUSD"]) < .00001
jm = {j["sourceId"]: j for j in judges if j["group"] == "current"}
gmap = {g["id"]: g for g in gens}
refmap = {f["id"]: f for f in refs}
def percentile(vals, q):
    return round(sorted(vals)[max(0, math.ceil(len(vals)*q)-1)], 1) if vals else None
def mean(vals):
    return round(statistics.mean(vals), 3) if vals else None
def grades(rows, field, choices):
    counts = Counter()
    for r in rows:
        j = jm.get(r["id"])
        v = j["parsed"].get(field, "unknown") if j and j.get("qualityStatus") == "usable_ai_estimate" else "unknown"
        key = str(v).lower() if isinstance(v, bool) else v
        counts[key if key in choices else "unknown"] += 1
    return {k: counts[k] for k in choices}
def summary(rows):
    norm = [r for r in rows if r["status"] == "complete"]
    responded = [r for r in rows if r.get("rawOutput") and isinstance(r.get("fullOutputMs"), (int, float))]
    lat = [r["fullOutputMs"] for r in responded]
    card_words = [v for r in norm for v in r["codeMetrics"]["cardWords"]]
    return {
        "moments": len(rows), "parsedUsable": len(norm), "responded": len(responded),
        "failures": dict(Counter(r["status"] for r in rows if r["status"] != "complete")),
        "fullOutputP50Ms": percentile(lat, .5), "fullOutputP95Ms": percentile(lat, .95),
        "firstContentP50Ms": percentile([r["firstContentMs"] for r in responded if r.get("firstContentMs") is not None], .5),
        "firstContentP95Ms": percentile([r["firstContentMs"] for r in responded if r.get("firstContentMs") is not None], .95),
        "goal": grades(rows, "goal", ["yes", "partial", "no", "unknown"]),
        "inventedFacts": grades(rows, "inventedFacts", ["true", "false", "unknown"]),
        "speakingForOwner": grades(rows, "speakingForOwner", ["true", "false", "unknown"]),
        "goalFactsUse": grades(rows, "goalFactsUse", ["yes", "partial", "no", "not_needed", "unknown"]),
        "cardWordsP50": percentile(card_words, .5), "cardWordsMax": max(card_words) if card_words else None,
        "cardsP50": percentile([r["codeMetrics"]["cardCount"] for r in norm], .5),
        "cardsMax": max([r["codeMetrics"]["cardCount"] for r in norm], default=None),
        "threeCardResponses": sum(r["codeMetrics"]["cardCount"] == 3 for r in norm),
        "semanticJudgeRejected": sum(jm.get(r["id"], {}).get("qualityStatus") == "unknown" and bool(jm.get(r["id"], {}).get("sourceAuditProblems")) for r in rows),
        "lengthCapped": sum(r.get("finishReason") == "length" for r in rows),
        "usableAIJudgments": sum(jm.get(r["id"], {}).get("qualityStatus") == "usable_ai_estimate" for r in rows),
    }
rows = [{"model": m, **summary([g for g in gens if g["model"] == m])} for m in plan["models"]]
per_call = [{"callId": c["id"], "label": c["label"], "models": [
    {"model": m, **summary([g for g in gens if g["model"] == m and g["callId"] == c["id"]])} for m in plan["models"]]} for c in plan["corpus"]]
historical = []
def score(old_j, name):
    value = (old_j or {}).get("scores", {}).get(name)
    if isinstance(value, dict): value = value.get("score")
    return value if isinstance(value, (int, float)) else None
for m in plan["models"]:
    key = "current-production" if m == "gpt-4.1-mini" else m
    js = [j for j in judges if j["group"] == "historical" and j.get("oldCandidateId") == key]
    paired = [j for j in js if j.get("qualityStatus") == "usable_ai_estimate"
              and score(j.get("oldJudge"), "overall_live_copilot_quality") is not None
              and isinstance(j["parsed"].get("usefulnessScore"), (int, float))]
    historical.append({"model": m, "oldAnswers": len(js),
        "newUsableJudgments": sum(j.get("qualityStatus") == "usable_ai_estimate" for j in js),
        "pairedRatings": len(paired),
        "oldOverallPairedMean": mean([score(j.get("oldJudge"), "overall_live_copilot_quality") for j in paired]),
        "newUsefulnessSameOutputsMean": mean([j["parsed"]["usefulnessScore"] for j in paired]),
        "newInventedTrue": sum(j.get("qualityStatus") == "usable_ai_estimate" and j["parsed"]["inventedFacts"] is True for j in js)})
deltas = []
for j in judges:
    if j["group"] != "historical" or j.get("qualityStatus") != "usable_ai_estimate": continue
    os = score(j.get("oldJudge"), "overall_live_copilot_quality")
    ns = j["parsed"].get("usefulnessScore")
    if not isinstance(os, (int, float)) or not isinstance(ns, (int, float)): continue
    a = old[int(j["sourceId"].split("-")[-1])]
    deltas.append({"model": j["oldCandidateId"], "oldRunId": j["oldRunId"], "moment": j["fixtureId"],
        "reply": a["output"].get("suggested_reply", ""), "oldScore": os, "newScore": ns,
        "delta": round(ns-os, 2), "reason": j["parsed"]["reason"], "claims": j["parsed"]["claims"]})
deltas.sort(key=lambda d: abs(d["delta"]), reverse=True)
violations = []
for r in gens:
    j = jm.get(r["id"])
    if j and j.get("qualityStatus") == "usable_ai_estimate" and (
        j["parsed"]["inventedFacts"] is True or j["parsed"]["speakingForOwner"] is True or j["parsed"]["goal"] == "no"):
        violations.append({"model": r["model"], "moment": r["fixtureId"], "type": r["normalized"]["type"],
            "cards": r["normalized"]["cards"], "verdict": j["parsed"]})
report = {
    "format": "talkhint.hint-unified-replay-result", "version": 1,
    "caseId": plan["caseId"], "design": "90 saved Guest segments × 5 models; one new response per moment; current unmodified prompt",
    "frozenReferenceSHA256": receipt["referenceSha256"], "execution": receipt,
    "models": rows, "byCall": per_call, "historicalSameOutputRegrading": historical,
    "oldNewExamples": deltas[:5], "violationCounts": dict(Counter(v["model"] for v in violations)),
    "judge": {"requestedModel": plan["judge"]["model"], "receivedModels": sorted(set(j.get("providerModel", "") for j in judges if j.get("providerModel"))),
        "currentRequests": sum(j["group"] == "current" for j in judges),
        "historicalRequests": sum(j["group"] == "historical" for j in judges),
        "usable": sum(j.get("qualityStatus") == "usable_ai_estimate" for j in judges),
        "sourceAuditRejected": sum(bool(j.get("sourceAuditProblems")) for j in judges),
        "auditReasons": dict(Counter(reason for j in judges for reason in j.get("sourceAuditProblems", [])))},
    "limitations": [
        "Text-only historical reconstruction. No audio, live phone call, STT timing, delivery or iPhone screen measurement.",
        "90 stored Guest segments, including notices/fragmented turns; not 90 independent conversations. p95 is sample-specific.",
        "Reference was manually annotated by Replit in P.LAB before inference, not independently accepted by owner/Claude and not audio-verified.",
        "Same current system/user prompt builders, no strengthening. Private profile/cards/strategy state absent equally. Coffee goal reconstructed.",
        "Generation limit 250 and current GPT-5 effort=none; Sol is a quality reference under THIS profile, not its maximum attainable reasoning quality. Sol speed not a selection gate.",
        "Five concurrent API requests, interleaved calls/rotating models. Network/load and alias changes prevent attributing old/new speed differences purely to model architecture.",
        "Code counts words/cards and measures streaming first-content/full output. Latency excludes audio/EOT/iPhone.",
        "Judge is a separate GPT-5.4 model, with blind candidate identity and exact-field citation validation. This does not prove semantic infallibility.",
        "Failure/rejected/unknown verdicts remain unknown. Denominators exclude unknown explicitly; missing verdicts never become clean results.",
        "Historical comparison reevaluates the SAME 188 outputs. Judge and rubric both changed, and older score availability was partial; paired samples only for numeric deltas.",
        "Old overall and new usefulness scores share 0–10 range, not identical definitions. Differences are not calibrated improvement points.",
        "New current-prompt answers versus August answers additionally differ in prompt, context, output profile, sampling and date; not causal evidence of model improvement.",
        "Reported USD is usage × checked public tariffs without cache discounts, plus conservative maxima for missing usage; not an invoice.",
    ],
    "productionChanged": False, "liveEnabled": False, "ownerAcceptedImprovement": False,
    "status": "partially_complete_quota_and_judge_blocked",
    "billing": {
        "usagePricedUSD": round(sum(r["chargedConservativeUSD"] for r in ledger if r.get("usage")), 6),
        "unknownUsageReservedUpperUSD": round(sum(r["chargedConservativeUSD"] for r in ledger if not r.get("usage")), 6),
        "unknownUsageRequests": sum(not r.get("usage") for r in ledger),
        "notProviderInvoice": True,
    },
    "decisionRequest": {"status": "ждёт решения владельца; ничего не включать", "rows": [
        {"id": "UNIFIED.1", "question": "Выбирать модель для живого звонка по этой проверке?",
         "recommendation": "Нет: ранжирование качества недостоверно. Mini быстрее в этом текстовом опыте, но этого недостаточно.", "ownerAnswer": None},
        {"id": "UNIFIED.2", "question": "После восстановления квоты подготовить досверку только сохранённых ответов?",
         "recommendation": "Да, отдельным расчётом и разрешением: сначала контрастная калибровка судьи, затем недостающие оценки. 450 генераций не повторять.", "ownerAnswer": None},
    ]},
    "engineeringFindings": [
        "524 отдельных оценочных запроса получили 429 credit_balance_exhausted / insufficient_quota. Повторов того же запроса не было, но worker продолжал следующие задания вместо общего останова. После прогона этот hard-stop добавлен, новых вызовов нет.",
        "Из 112 разобранных ответов судьи 64 отвергнуты первой механической сверкой. Прохождение остальных 48 не доказывает верность оценки.",
        "Ручной spot-check выявил ложные штрафы за обычную предлагаемую реплику/будущее действие и неоднозначный пример JSON sourceId. Валидация первая была избыточно строгой к некоторым разным категориям. Плохие оценки не исправлялись выдуманными баллами.",
        "Полный выбор качества и статистическая сверка августовских баллов заблокированы. Отдельные пары старых/новых оценок являются материалом аудита, не рейтингом моделей.",
    ],
}
historical_source = json.loads(Path("generated-artifacts/hint-model-history/benchmark-source.json").read_text())
report["oldAugustAggregates"] = [{
    "runId": run["id"], "startedAtUTC": run["started_at"], "promptVersion": run["prompt_version"],
    "candidates": [{k: c.get(k) for k in ["model","turns","errors","avgReadyMs","avgFullOutputMs","judgeAverages","successfulHints"]}
                   for c in run["scorecard"]["candidates"]]
} for run in historical_source if run["id"] in ["6b913e74-d80c-4b0a-83f7-49977884973d", "b29ea02b-4176-4adf-8f7b-46ba9ce6ec32"]]
report["qualityRankingUsable"] = False
report["exampleComparisons"] = []
for moment, before, after, observation in [
    ("october-3:2", "gpt-5.2", "gpt-5.6-terra",
     "В первом ответе уже утверждаются негерметичность и протечка, которых в предшествующем тексте ещё нет. Второй спрашивает о фото и описывает упаковку без этого уточнения. Это локальная сверка P.LAB с O1, не общий рейтинг."),
    ("october-2:12", "gpt-4.1-mini", "gpt-5.6-terra",
     "До ответа владельца Mini даёт английскую рамку user_input с утверждением, что звонки/SMS работают. У Terra две условные ветки. Риск неподтверждённого факта меньше, но читать две карточки дольше; эффект на iPhone не проверен."),
    ("october-1:21", "gpt-4.1-mini", "gpt-5.6-sol",
     "У Mini только помогло/не помогло. У Sol есть ещё «я пока не перезагружал». Перезагрузка до этого момента не подтверждена. Sol покрывает больше состояний, но показывает три карточки — это не доказанное улучшение для быстрого разговора."),
]:
    items = [next(g for g in gens if g["fixtureId"] == moment and g["model"] == m) for m in [before, after]]
    report["exampleComparisons"].append({
        "moment": moment, "guest": refmap[moment]["guest"],
        "before": {"model": before, "type": items[0]["normalized"]["type"], "cards": items[0]["normalized"]["cards"]},
        "after": {"model": after, "type": items[1]["normalized"]["type"], "cards": items[1]["normalized"]["cards"]},
        "observation": observation, "liveChange": False, "reviewSource": "P.LAB, limited offline source inspection",
    })
(p / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
(p / "violations.json").write_text(json.dumps(violations, ensure_ascii=False, indent=2))
lines = ["# P.LAB → P.PRODUCT: единая линейка Hint — частичный результат", "",
    "**Только сохранённый текст. Продукт, аккаунты, телефония и почта не менялись.**", "",
    "**Выбрать модель по качеству пока нельзя.** 524 запроса судьи: исчерпана квота API; из 112 разобранных оценок 64 не прошли первую сверку. У оставшихся оценок также найдены ложные срабатывания. Важные неизвестные не заменены нулями.", "",
    "| Модель | Разобрано / 90 | p50 / p95, мс | Цель: да/част./нет/? | Выдумки, AI | За владельца, AI | Факты цели: да/част./нет/не нужно/? | Слов p50/max | Карточек p50/max |", "|---|---:|---:|---|---|---|---|---:|---:|"]
def yn(c): return f'{c["true"]}/{c["true"]+c["false"]}; ?={c["unknown"]}'
for r in rows:
    lines.append(f'| {r["model"]} | {r["parsedUsable"]}/90 | {r["fullOutputP50Ms"]}/{r["fullOutputP95Ms"]} | '
        + "/".join(str(r["goal"][k]) for k in ["yes","partial","no","unknown"]) + " | "
        + yn(r["inventedFacts"]) + " | " + yn(r["speakingForOwner"]) + " | "
        + "/".join(str(r["goalFactsUse"][k]) for k in ["yes","partial","no","not_needed","unknown"])
        + f' | {r["cardWordsP50"]}/{r["cardWordsMax"]} | {r["cardsP50"]}/{r["cardsMax"]} |')
lines += ["", "Выдумки и ответы за владельца — оценки AI: числитель/число определённых вердиктов, неизвестные отдельно. Категории могут пересекаться, их нельзя складывать.",
    "Скорость — полный ответ API, не время до экрана. Sol по скорости не отсеивается.", "",
    "## Август: те же ответы, новая оценка",
    "Надёжная общая переоценка не получилась: мало оценок, у судьи есть ложные срабатывания. Следующие пары — материал аудита, не доказательство ухудшения моделей."]
for r in historical:
    lines.append(f'- {r["model"]}: парных оценок {r["pairedRatings"]}; прежний overall {r["oldOverallPairedMean"]} → новая полезность {r["newUsefulnessSameOutputsMean"]}. Определения различаются.')
lines += ["", "## Где расходится мерка"]
for d in deltas[:5]:
    lines.append(f'- {d["model"]}, {d["moment"]}: {d["oldScore"]} → {d["newScore"]}; «{d["reply"]}». {d["reason"]}')
lines += ["", "## Три различия ответов — не внедрённые улучшения"]
for example in report["exampleComparisons"]:
    lines += [f'### {example["moment"]}', "Собеседник: "+example["guest"],
        example["before"]["model"]+": "+" / ".join(c["en"] for c in example["before"]["cards"]),
        "→ "+example["after"]["model"]+": "+" / ".join(c["en"] for c in example["after"]["cards"]),
        example["observation"], ""]
lines += ["", "## Нужно решение"] + [f'- {d["id"]}: {d["question"]} Рекомендация: {d["recommendation"]} Ответ владельца: не получен.' for d in report["decisionRequest"]["rows"]]
lines += ["", "## Расходы", f'Попыток API: {receipt["attempted"]} из максимум 1088; по полученному usage × тариф ${report["billing"]["usagePricedUSD"]}; консервативная верхняя граница с неизвестным usage ${receipt["chargedConservativeUSD"]} из разрешённых $35. Это не счёт. Повторов нет.',
    "", "## Ограничения"] + ["- "+v for v in report["limitations"]]
(p / "REPORT.md").write_text("\n".join(lines))
print(json.dumps({"models": rows, "historical": historical, "judge": report["judge"],
                  "attempted": receipt["attempted"], "cost": receipt["chargedConservativeUSD"]}, ensure_ascii=False))
