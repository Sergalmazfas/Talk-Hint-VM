import json,statistics,hashlib
from pathlib import Path
p=Path("generated-artifacts/hint-unknown-owner-rule-v1")
read=lambda f:json.loads(Path(f).read_text())
r=read(p/"RESULT.json")
gens=read("generated-artifacts/hint-unified-preflight/execution/generations.json")
old=read("generated-artifacts/hint-unified-rescore-final/execution/judgments.json")
previous={x["sourceId"]:x for x in old if x["qualityStatus"]=="usable_ai_estimate"}
fresh={(x["fixtureId"],x.get("candidateModel")):x for x in r["rows"] if x["kind"]=="judge"}
newgen={(x["fixtureId"],x["model"]):x for x in r["rows"] if x["kind"]=="generation"}
models=["gpt-4.1-mini","gpt-5.6-terra"]
ids=[f for f in r["commonFixtureIds"] if all(fresh.get((f,m),{}).get("qualityStatus")=="usable_ai_estimate" for m in models)]
def percentile(a,p):
 import math
 return sorted(a)[max(0,math.ceil(len(a)*p)-1)] if a else None
def metrics(j,g):
 return {"n":len(j),"goalYes":sum(x["goal"]=="yes" for x in j),
   "inventedFacts":sum(x["inventedFacts"] is True for x in j),
   "speakingForOwner":sum(x["speakingForOwner"] is True for x in j),
   "usefulness":round(statistics.mean(x["usefulnessScore"] for x in j if x["usefulnessScore"] is not None),3),
   "fullOutputP50Ms":percentile([x["fullOutputMs"] for x in g],.5),
   "fullOutputP95Ms":percentile([x["fullOutputMs"] for x in g],.95),
   "codeMetrics":[x["codeMetrics"] for x in g]}
summary=[];pairs=[];disputed=[]
for m in models:
 a=[next(x for x in gens if x["fixtureId"]==f and x["model"]==m) for f in ids]
 b=[newgen[f,m] for f in ids]
 aj=[previous[x["id"]]["parsed"] for x in a];bj=[fresh[f,m]["parsed"] for f in ids]
 changes={"fixed":0,"newViolations":0,"unchangedViolations":0,"unchangedClean":0}
 for f,ag,bg,av,bv in zip(ids,a,b,aj,bj):
  k="unchangedViolations" if av["speakingForOwner"] is True and bv["speakingForOwner"] is True else (
   "fixed" if av["speakingForOwner"] is True else ("newViolations" if bv["speakingForOwner"] is True else "unchangedClean"))
  changes[k]+=1
  record={"fixtureId":f,"model":m,"transition":k,"before":ag["normalized"],"after":bg["normalized"],
   "beforeJudge":av,"afterJudge":bv}
  pairs.append(record)
  for phase,g,v in [("before",ag,av),("after",bg,bv)]:
   if g["normalized"]["type"]=="choice" and v["speakingForOwner"] is True:
    disputed.append({"fixtureId":f,"model":m,"phase":phase,"candidate":g["normalized"],"judge":v,
     "status":"needs_review_not_overwritten","reason":"Judge flags a choice; inspect whether this is a shared unsupported premise or a forbidden penalty for conditional options."})
 summary.append({"model":m,"before":metrics(aj,a),"after":metrics(bj,b),"ownerStateTransitions":changes})
audit=read(p/"FLAG_AUDIT.json")
report={"version":1,"scope":"Text bench only; production prompt unchanged","attempted":r["attempted"],
 "accountedUSD":r["accountedUSD"],"maximumUSD":5,"initialCommonMoments":83,
 "pairedComparableMomentsAcrossBothModels":len(ids),"models":summary,
 "unknowns":[{"fixtureId":x["fixtureId"],"model":x.get("candidateModel",x["model"]),"error":x.get("error")}
  for x in r["rows"] if x["status"]!="complete"],
 "flagAudit":{"sameFlagsCommonRows":415,"differentFlagsCommonRows":len(audit["disagreeingCases"]),
  "notForcedEqualByValidator":True,"asymmetricCalibrationVerified":True,
  "interpretation":"Owner-state violations are a subset of factual violations. Common sample positives contain unsupported owner assertions; mixed cases may contain third-party claims too. Equality in this sample is not equality of metric definitions."},
 "conditionalClaimsNeedingReview":len(disputed),
 "verdict":"Rule not accepted for runtime: remaining violations, new regressions and disputed AI labels need review. No automatic model or prompt change.",
 "ownerApprovedPilotOrder":["Terra","Mini","Mini","Terra"],
 "pilotGate":"Only after production lab is enabled and actual report emails arrive; explicit later activation, no pilot now.",
 "pairs":pairs,"disputedChoices":disputed}
(p/"REPORT.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
lines=["# Hint: проверка правила неизвестного состояния — только стенд",
 f"83 исходных момента; общая парная выборка после неизвестного исхода: {len(ids)}.",
 f"Вызовы: {r['attempted']}; консервативно ${r['accountedUSD']:.6f} из $5; повторов нет.",
 "Один тайм-аут судьи оставлен неизвестным, не нулём.",
 "",
 "| Модель | Ответ за владельца: было → стало | Цель полностью: было → стало | Исправлено / новых нарушений |",
 "|---|---:|---:|---:|"]
for x in summary:
 a,b,t=x["before"],x["after"],x["ownerStateTransitions"]
 lines.append(f'| {x["model"]} | {a["speakingForOwner"]} → {b["speakingForOwner"]} | {a["goalYes"]} → {b["goalYes"]} | {t["fixed"]} / {t["newViolations"]} |')
lines+=["","## Почему два показателя совпали",
 "Код не связывает флаги равенством. В 415 строках общей выборки они совпали; неподтверждённое состояние владельца одновременно является неподтверждённым фактом. В смешанном ответе могут присутствовать и сторонние факты.",
 "Сохранённая калибровка различает их: «Вы прочитали мои фотографии» → выдуманный факт=true, ответ за владельца=false. Контракт допускает такой результат; добавлен отдельный офлайн-тест.",
 f"Обнаружено {len(disputed)} оценок условных вариантов, требующих рассмотрения: их нельзя объявить достоверными только по калибровке 20/20. Исходные оценки сохранены, не исправлены вручную на удобные.",
 "","## Вывод",
 report["verdict"],"Время — полный ответ модели в текстовом стенде, не путь от речи до экрана. Случайные ответы и разная нагрузка провайдера ограничивают сравнение. Эталон текстовый, не независимая проверка аудио.",
 "","## Примеры изменений"]
for x in [x for x in pairs if x["transition"] in ["fixed","newViolations"]][:5]:
 lines+= [f'### {x["model"]}, {x["fixtureId"]}, {x["transition"]}',
  "Было: "+" / ".join(c["en"] for c in x["before"]["cards"]),
  "Стало: "+" / ".join(c["en"] for c in x["after"]["cards"])]
(p/"REPORT.md").write_text("\n".join(lines))
compact={**report,"models":[{**x,"before":{k:v for k,v in x["before"].items() if k!="codeMetrics"},
 "after":{k:v for k,v in x["after"].items() if k!="codeMetrics"}} for x in summary]}
del compact["pairs"];del compact["disputedChoices"]
compact["fullReportSHA256"]=hashlib.sha256((p/"REPORT.json").read_bytes()).hexdigest()
(p/"SUMMARY.json").write_text(json.dumps(compact,ensure_ascii=False,indent=2))
print(json.dumps(compact,ensure_ascii=False))
