"""Offline-only aggregation of the last calibration and reused responses."""
from pathlib import Path
import json, statistics, hashlib, zipfile, math
from collections import Counter
p=Path("generated-artifacts/hint-unified-rescore-final")
b=Path("generated-artifacts/hint-unified-preflight")
read=lambda path: json.loads(path.read_text())
r=read(p/"RESULT.json"); plan=read(p/"preflight.json")
cal=read(p/"execution/calibration-results.json")
js=read(p/"execution/judgments.json")
gens=read(b/"execution/generations.json"); old=read(b/"old-answers-preserved.json")
base=read(b/"report.json")
models=[x["model"] for x in base["models"]]
valid={j["sourceId"]:j["parsed"] for j in js if j["qualityStatus"]=="usable_ai_estimate"}
def counts(rows,key,total):
    c=Counter(j[key] for j in rows)
    c["unknown"]+=total-len(rows)
    return {str(k).lower() if isinstance(k,bool) else k:v for k,v in c.items()}
def avg(v): return round(statistics.mean(v),3) if v else None
def quality(gs, allowed=None):
    selected=[g for g in gs if allowed is None or g["fixtureId"] in allowed]
    j=[valid[g["id"]] for g in selected if g["id"] in valid]
    return {"total":len(selected),"usableAI":len(j),
        "goal":counts(j,"goal",len(selected)),
        "inventedFacts":counts(j,"inventedFacts",len(selected)),
        "speakingForOwner":counts(j,"speakingForOwner",len(selected)),
        "goalFactsUse":counts(j,"goalFactsUse",len(selected)),
        "meanUsefulness":avg([x["usefulnessScore"] for x in j if x["usefulnessScore"] is not None]),
        "meanGoalScore":avg([x["goalScore"] for x in j if x["goalScore"] is not None])}
common=set.intersection(*[{g["fixtureId"] for g in gens if g["model"]==m and g["id"] in valid} for m in models])
rows=[]
for m in models:
    gs=[g for g in gens if g["model"]==m]; raw=next(x for x in base["models"] if x["model"]==m)
    measured={k:raw[k] for k in ["fullOutputP50Ms","fullOutputP95Ms","cardWordsP50","cardWordsMax","cardsP50","cardsMax","threeCardResponses","parsedUsable"]}
    costs=[g["chargedConservativeUSD"] for g in gs if g.get("usage") and isinstance(g.get("chargedConservativeUSD"),(int,float))]
    rows.append({"model":m,"code":measured,"allSavedMoments":quality(gs),"sameMomentsAcrossAllFive":quality(gs,common),
        "generationPricePer1000RequestsUSD":round(statistics.mean(costs)*1000,3) if costs else None,
        "generationPriceMeaning":"Prior saved generator usage at recorded tariff, not per-minute cost or invoice; judges excluded"})
historical=[]
paired=[]
for i,a in enumerate(old):
    v=valid.get(f"old-{i}")
    if not v: continue
    model="gpt-4.1-mini" if a["candidateId"]=="current-production" else a["candidateId"]
    old_judge=a.get("oldJudge") or {}
    scores=old_judge.get("scores") or {}
    if scores.get("overall_live_copilot_quality") is not None and v["usefulnessScore"] is not None:
        paired.append({"model":model,"runId":a["runId"],"turnIdx":a["turnIdx"],
            "oldOverall":scores["overall_live_copilot_quality"],"newUsefulness":v["usefulnessScore"],
            "numericDifferenceNotSameScale":v["usefulnessScore"]-scores["overall_live_copilot_quality"],
            "text":a["output"].get("suggested_reply",""),
            "oldReason":old_judge.get("rationale",""),"newReason":v["reason"],
            "newInventedFacts":v["inventedFacts"],"newSpeakingForOwner":v["speakingForOwner"]})
for m in models:
    a=[x for x in paired if x["model"]==m]
    total=sum(("gpt-4.1-mini" if x["candidateId"]=="current-production" else x["candidateId"])==m for x in old)
    historical.append({"model":m,"pairedComparableOutputs":len(a),"savedOutputs":total,
        "newUsableRegrades":sum(f"old-{i}" in valid for i,x in enumerate(old)
            if ("gpt-4.1-mini" if x["candidateId"]=="current-production" else x["candidateId"])==m),
        "oldQualityAbsent":sum(not (x.get("oldJudge") or {}).get("scores",{}).get("overall_live_copilot_quality") is not None
            for x in old if ("gpt-4.1-mini" if x["candidateId"]=="current-production" else x["candidateId"])==m),
        "oldOverallMean":avg([x["oldOverall"] for x in a]),"newUsefulnessMean":avg([x["newUsefulness"] for x in a]),
        "higherByAtLeast3":sum(x["numericDifferenceNotSameScale"]>=3 for x in a),
        "lowerByAtLeast3":sum(x["numericDifferenceNotSameScale"]<=-3 for x in a)})
diff=[]
for x in sorted(paired,key=lambda x:abs(x["numericDifferenceNotSameScale"]),reverse=True):
    if len(diff)==3: break
    if any(d["turnIdx"]==x["turnIdx"] for d in diff): continue
    diff.append(x)
examples=[]
for fid in ["august-fixture-2:8","october-1:19","october-2:24","october-3:16","october-3:26"]:
    item={"fixtureId":fid,"kind":"Saved alternative texts, NOT deployed before/after"}
    for m in ["gpt-5.6-terra","gpt-4.1-mini"]:
        g=next(x for x in gens if x["model"]==m and x["fixtureId"]==fid)
        item[m]={"cards":[c["en"] for c in g.get("normalized",{}).get("cards",[])],
                 "judge":valid.get(g["id"],"unknown")}
    examples.append(item)
closed=not r["calibrationPassed"]
decision={"status":"Нужно решение владельца; ничего не включено","rows":[
    {"id":"UNIFIED.LIVE.1","proposal":(
        "Подготовить изолированную проверку моделей живыми звонками только на аккаунте владельца; модели, порядок, число звонков и расходы согласовать перед включением."
        if closed else
        "Подготовить персональный пилот gpt-4.1-mini с текущей Terra как контролем, без изменения промпта и STT; остальные пользователи без изменений. Включение, число звонков и расходы — отдельное решение."),
     "reason":"Путь через судью закрыт после последней калибровки" if closed else
        "Mini быстрее по полному ответу модели, но качество не доказано лучшим. Текстовый стенд не измеряет быстрый живой разговор и доставку на iPhone.",
     "answer":None,"globalRuntimeChangeAllowed":False},
    {"id":"UNIFIED.PROMPT.1","proposal":"После выбора модели отдельно проверить правило неизвестного состояния по определению владельца; сейчас не менять промпт.",
     "answer":None,"status":"Отложено до выбора модели"}]}
analysis={"version":1,"caseId":"HINT-MODEL-HISTORY-001","method":"Owner-defined narrow rubric; independent GPT-5.4 snapshot, saved text only",
    "calibrationPassed":r["calibrationPassed"],"calibrationMatched":r["calibrationMatched"],
    "judgeRouteClosed":closed,"paidRequests":r["attemptedRequests"],"generationRequests":0,
    "pricedUsageUSD":r["pricedUsageUSD"],"conservativeUSD":r["conservativeUSD"],
    "priorCalibrationUSD":.11625,"bothJudgingRoundsUSD":round(.11625+r["conservativeUSD"],6),
    "ownerResidualCapUSD":9.88,"sameUsableMomentsAcrossAllFive":len(common),
    "interruptedUnconfirmedNeverRetried":r.get("interruptedUnconfirmed",0),
    "restartRecovery":read(p/"execution/RECOVERY.json") if (p/"execution/RECOVERY.json").exists() else None,
    "currentRows":rows if not closed else [],
    "historicalSameOutputRegrading":historical if not closed else [],
    "historicalInterpretation":"Old overall vs new usefulness are different rubrics; not a causal effect of rubric alone. Old judge Sol evaluated itself; new independent judge did not. No new generation of historical replies.",
    "historicalDifferenceExamples":diff if not closed else [],
    "limitations":["AI estimate, not human acceptance, not audio verification.",
      "Latency reused from original full generator requests: not EOT-to-screen or a live-call measurement.",
      "Unknown/rejected judgments are not zero; common-moment comparisons exclude them symmetrically.",
      "Goal intent is not proof of completed action; latest explicit Owner evidence overrides older state.",
      "Sol is a quality reference; its latency is not a disqualifier for that reference role.",
      "Future prompt change and live rollout are NOT applied; current production model untouched."],
    "needDecision":decision,"productChanged":False,"modelSelected":False}
(p/"ANALYSIS.json").write_text(json.dumps(analysis,ensure_ascii=False,indent=2))
full={**analysis,"byCall":[{"callId":cid,"model":m,**quality([g for g in gens if g["model"]==m and g["callId"]==cid])}
    for cid in dict.fromkeys(g["callId"] for g in gens) for m in models] if not closed else [],
    "savedAlternativeExamples":examples if not closed else [],"allHistoricalPairs":paired if not closed else []}
(p/"FULL_REPORT.json").write_text(json.dumps(full,ensure_ascii=False,indent=2))
lines=["# Hint — последняя калибровка и досверка","",
    f"Калибровка: {r['calibrationMatched']}/20. Массовых запросов: {r['rescoredRequests']}/636.",
    f"Usage × тариф: ${r['pricedUsageUSD']:.6f}; консервативный учёт: ${r['conservativeUSD']:.6f}.",
    f"С предыдущей калибровкой: ${.11625+r['conservativeUSD']:.6f}. Новых генераций Hint: 0.",
    "Расчёт по сохранённому тарифу, не сверенный счёт провайдера.",
    f"После перезапуска среды {r.get('interruptedUnconfirmed',0)} начатых запросов остались неизвестными и НЕ повторялись; их верхняя стоимость удержана в лимите.",""]
if closed:
    lines+=["## Стоп: путь через судью закрыт","Третья калибровка и массовая досверка не запускались.",
        "Разногласия см. RESULT.json и execution/calibration-results.json.",""]
else:
    lines += [f"## Одна линейка: {len(common)} одинаковых пригодных моментов для всех пяти",
      "Скорость — из исходных 90 запросов каждой модели, не время до экрана.",
      "Качество ниже — только общие моменты; все исходные 450 строк с неизвестными см. FULL_REPORT.json.","",
      "| Модель | p50 / p95, мс | Цель yes | Выдуманный факт | Ответ за владельца | Полезность /10 | Слов p50 / max |",
      "|---|---:|---:|---:|---:|---:|---:|"]
    for x in rows:
        q=x["sameMomentsAcrossAllFive"];co=x["code"]
        lines.append(f"| {x['model']} | {co['fullOutputP50Ms']:.0f} / {co['fullOutputP95Ms']:.0f} | {q['goal'].get('yes',0)}/{len(common)} | {q['inventedFacts'].get('true',0)}/{len(common)} | {q['speakingForOwner'].get('true',0)}/{len(common)} | {q['meanUsefulness']} | {co['cardWordsP50']} / {co['cardWordsMax']} |")
    lines+=["","## Август: те же сохранённые ответы, другая оценка",
       analysis["historicalInterpretation"],"",
       "| Модель | Пар | Старый overall | Новая полезность | Рост ≥3 | Снижение ≥3 |",
       "|---|---:|---:|---:|---:|---:|"]
    for x in historical: lines.append(f"| {x['model']} | {x['pairedComparableOutputs']}/{x['savedOutputs']} | {x['oldOverallMean']} | {x['newUsefulnessMean']} | {x['higherByAtLeast3']} | {x['lowerByAtLeast3']} |")
    for x in diff:
        lines += ["",f"### Август: turn {x['turnIdx']}, {x['model']}",
                  f"Тот же текст: {x['text']}",f"Старая оценка: {x['oldOverall']}. {x['oldReason']}",
                  f"Новая полезность: {x['newUsefulness']}. {x['newReason']}"]
    lines+=["","## Пять пар текстов: Terra и Mini","Это варианты из сохранённого стенда, не внедрённое улучшение."]
    for x in examples:
        lines += ["",f"### {x['fixtureId']}","Terra: "+" / ".join(x["gpt-5.6-terra"]["cards"]),
                  "Mini: "+" / ".join(x["gpt-4.1-mini"]["cards"])]
lines+=["","## Нужно решение (ответы пока не получены)","| Строка | Предложение | Да/нет |","|---|---|---|"]
for x in decision["rows"]:lines.append(f"| {x['id']} | {x['proposal']} | — |")
lines+=["","## Ограничения"]+["- "+s for s in analysis["limitations"]]
(p/"REPORT.md").write_text("\n".join(lines))
assert r["conservativeUSD"]<=9.88 and .11625+r["conservativeUSD"]<10
assert len(cal)==20 and r["attemptedRequests"]<=656
assert (r["rescoredRequests"]==0) if closed else True
assert hashlib.sha256((b/"frozen-reference-v1.json").read_bytes()).hexdigest()==plan["freezeSHA256"]
print(json.dumps({"calibrationPassed":not closed,"commonMoments":len(common),"usableJudgments":len(valid),
    "analysisChars":len(json.dumps(analysis,ensure_ascii=False)),"costUSD":r["pricedUsageUSD"]}))
if (p/"READBACK_RESULT.json").exists():
    files=["REPORT.md","FULL_REPORT.json","ANALYSIS.json","RESULT.json","preflight.json",
        "AUTHORIZATION.json","READBACK_RESULT.json","calibration.json","JUDGE.txt",
        "execution/calibration-results.json","execution/judgments.json","execution/ledger.jsonl"]
    if (p/"execution/RECOVERY.json").exists():files.append("execution/RECOVERY.json")
    if (p/"FINAL_CHECKS.json").exists():files.append("FINAL_CHECKS.json")
    sources={f:p/f for f in files}
    sources.update({
        "baseline/generations.json":b/"execution/generations.json",
        "baseline/old-answers-preserved.json":b/"old-answers-preserved.json",
        "baseline/frozen-reference-v1.json":b/"frozen-reference-v1.json",
    })
    manifest={f:hashlib.sha256(path.read_bytes()).hexdigest() for f,path in sources.items()}
    (p/"MANIFEST.json").write_text(json.dumps(manifest,indent=2))
    with zipfile.ZipFile(p/"Hint_final_calibration_and_rescore_v1.zip","w",zipfile.ZIP_DEFLATED) as z:
        for f,path in sources.items():z.write(path,f)
        z.write(p/"MANIFEST.json","MANIFEST.json")
    with zipfile.ZipFile(p/"Hint_final_calibration_and_rescore_v1.zip") as z:
        assert z.testzip() is None
        for f,h in manifest.items():assert hashlib.sha256(z.read(f)).hexdigest()==h
    print("ZIP verified")
