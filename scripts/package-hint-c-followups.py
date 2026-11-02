"""Metadata-only review package. Never includes manifest, audio or transcripts."""
from pathlib import Path
from collections import defaultdict
from statistics import mean
from datetime import datetime, timezone
import csv, hashlib, json, math, zipfile, subprocess

ROOT=Path("generated-artifacts/hint-polygon")
OUT=ROOT/"c-followups-review"
OUT.mkdir(parents=True,exist_ok=True)
def load(p): return json.loads(Path(p).read_text())
def digest(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rows(trial):
    return {p.stem:dict(load(p),evidence_path=str(p)) for p in (ROOT/"trials"/trial/"rows").glob("*.json")}
def write(name,value):
    (OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2))
def pct(values,q):
    s=sorted(values)
    return s[max(0,math.ceil(len(s)*q)-1)] if s else None
def physical(data,ids):
    found=defaultdict(list)
    for id in ids:
        r=data.get(id)
        if not r or not r["valid"]: continue
        for t in r["turns"]:
            if t["valid"] and t["speechEndMs"] is not None:
                found[(id,t["speechEndMs"])].append(t)
    # Never select the faster of multiple outputs aligned to one VAD end.
    return {k:v[0] for k,v in found.items() if len(v)==1},sum(len(v)>1 for v in found.values())

ledger=load(ROOT/"series-ledger.json")
cache_plan=load(ROOT/"historical-cache-write-contingency.json")
integrity=json.loads(subprocess.check_output(["node","-e",r"""
const fs=require('node:fs'),crypto=require('node:crypto'),root='generated-artifacts/hint-polygon/';
const l=JSON.parse(fs.readFileSync(root+'series-ledger.json','utf8'));
const p=JSON.parse(fs.readFileSync(root+'historical-cache-write-contingency.json','utf8'));
const n=l.entries.findIndex(e=>e.id===p.id);if(n<0)throw Error('MISSING_CONTINGENCY');
const hash=crypto.createHash('sha256').update(JSON.stringify({...l,entries:l.entries.slice(0,n)})).digest('hex');
if(hash!==p.beforeLedgerHash)throw Error('HISTORICAL_LEDGER_CHANGED');
console.log(JSON.stringify({historicalChargesAndMetadataUnchanged:true,entriesBefore:n,verifiedHash:hash}));
"""],text=True))
premiums={e["id"]:e["maximumMissingWritePremiumMicro"]for e in cache_plan["historical"]}
def historical_premium(data,ids):
    total=0
    for id in ids:
        if id not in data:continue
        trial=Path(data[id]["evidence_path"]).parent.parent.name
        prefix=f"{ledger['series']}-{trial}-{id}-"
        total+=sum(amount for key,amount in premiums.items() if key.startswith(prefix))
    return total
budget={s:sum(e["charged"] if s=="spent" else e["reserve"] for e in ledger["entries"] if e["status"]==s)
        for s in ("spent","reserved","unknown")}
assert budget["reserved"]==0 and sum(budget.values())<=15_000_000
assert load(ROOT/"c-factor-runs.json")["status"] in ("completed_bounded_factors","blocked_no_retry")
manifest=load(ROOT/"private-manifest.json")
expected={f["id"] for f in manifest["fixtures"] if f["goal"]}
assert len(expected)==15
a=rows("a-qc30-goal-full")
# Prefer the clean repeat over older results; never copy or mutate source rows.
c=rows("c-goal-panel")
c.update(rows("c-clean-panel"))
c.update(rows("c-expanded-goal"))
c.update(rows("c-expanded-tail"))
common={i for i in expected if a.get(i,{}).get("valid") and c.get(i,{}).get("valid")}
ap,_=physical(a,common)
cp,_=physical(c,common)
primary_anchor=set(ap)&set(cp)
control=load(ROOT/"c-followup-control-v3.json")
panel=set(control["panel"])
pa,_=physical(a,panel)
pc,_=physical(c,panel)
panel_anchor=set(pa)&set(pc)
table=[]
def summarize(label,data,ids,anchor,cohort):
    by_end,duplicates=physical(data,ids)
    eligible=[by_end[k] for k in anchor if k in by_end]
    first=[t["firstWordMs"]-t["speechEndMs"] for t in eligible if t["firstWordMs"] is not None]
    full=[t["fullHintMs"]-t["speechEndMs"] for t in eligible if t["fullHintMs"] is not None]
    quality_rows=[data[i] for i in ids if i in data and data[i]["valid"]]
    qualities=[r["quality"] for r in quality_rows if r.get("quality") is not None]
    complete=len(qualities)==len(ids) and len(ids)>0
    r={
        "cohort":cohort,"variant":label,"requested_calls":len(ids),
        "attempted_calls":sum(i in data for i in ids),"valid_calls":len(quality_rows),
        "reference_vad_ends":len(anchor),"hints_on_reference":len(first),
        "missing_reference_hints":len(anchor)-len(first),
        "first_word_p50_ms":pct(first,.5),"first_word_p95_ms":pct(first,.95),
        "full_english_p50_ms":pct(full,.5),"full_english_p95_ms":pct(full,.95),
        "quality_0_to_5":mean(qualities) if complete else None,
        "quality_complete":complete,"partial_quality_do_not_rank":mean(qualities) if qualities and not complete else None,
        "quality_call_count":len(qualities),"duplicate_vad_alignments_excluded":duplicates,
        "cost_attempts_usd":(sum(data[i]["chargedMicro"] for i in ids if i in data)+historical_premium(data,ids))/1e6,
        "recorded_row_cost_usd":sum(data[i]["chargedMicro"] for i in ids if i in data)/1e6,
        "historical_cache_write_reserve_allocation_usd":historical_premium(data,ids)/1e6,
        "cost_includes_failed_attempts":True,"notes":"",
    }
    table.append(r)
    return r

primary_a=summarize("А",a,common,primary_anchor,"primary_matched_valid_calls")
primary_c=summarize("В — полный промпт",c,common,primary_anchor,"primary_matched_valid_calls")
summarize("А",a,panel,panel_anchor,"fixed_three_call_factor_panel")
summarize("В — полный промпт",c,panel,panel_anchor,"fixed_three_call_factor_panel")
for trial,label in [
    ("c-short-three","В + короткий промпт, 3 реплики"),
    ("c-flux-060","В + Flux 0.6 / 3000 мс"),
    ("c-flux-050","В + Flux 0.5 / 3000 мс"),
    ("c-cards-addon","В + карточки, иначе поток"),
]:
    summarize(label,rows(trial),panel,panel_anchor,"fixed_three_call_factor_panel")
catalog=[]
for id in sorted(expected):
    ar,cr=a.get(id),c.get(id)
    catalog.append({
        "fixture":id,
        "a_status":"valid" if ar and ar["valid"] else "invalid" if ar else "not_attempted",
        "c_status":"valid" if cr and cr["valid"] else "invalid" if cr else "not_attempted",
        "a_reasons":ar["reasons"] if ar else ["prior_unknown_not_retried"],
        "c_reasons":cr["reasons"] if cr else ["prior_unknown_not_retried_or_not_started"],
        "a_source":ar["evidence_path"] if ar else None,
        "c_source":cr["evidence_path"] if cr else None,
    })
addon=rows("c-cards-addon")
decisions=[(r,t) for r in addon.values() for t in r.get("providerAudit",[]) if t.get("stage")=="card-decision"]
eligible_hits=[]
for r,d in decisions:
    turn=next((t for t in r["turns"] if t["turnId"]==d["turnId"]),None)
    if r["valid"] and turn and turn["valid"]: eligible_hits.append(d["hit"])
for r in table:
    if r["variant"]=="В + карточки, иначе поток":
        r["notes"]=f"Card hits {sum(eligible_hits)}/{len(eligible_hits)} eligible turns. With zero hits, quality is fallback V only; card-hit quality is unmeasured."
format_failures=[x for x in catalog if any("INVALID_HINT_JSON" in r for r in x["c_reasons"])]
tests=load(ROOT/"tests-c-followups-budget-final.json")
report={
    "generated":datetime.now(timezone.utc).isoformat(),"status":"independent_review_required",
    "primary_requested":15,"primary_attempted_c":sum(i in c for i in expected),
    "primary_valid_c":sum(bool(c.get(i,{}).get("valid")) for i in expected),
    "primary_matched_valid_calls":len(common),
    "primary_common_unique_vad_ends":len(primary_anchor),
    "fixed_factor_panel":sorted(panel),"panel_reference_vad_ends":len(panel_anchor),
    "corpus_status":catalog,"comparison":table,
    "format_failure_count":len(format_failures),
    "cards":{"raw_decisions":len(decisions),"raw_hits":sum(bool(d["hit"])for _,d in decisions),
             "valid_eligible_decisions":len(eligible_hits),"valid_eligible_hits":sum(eligible_hits),
             "valid_eligible_hit_rate":mean(eligible_hits) if eligible_hits else None,
             "card_hit_quality":None,"card_hit_quality_note":"No card hits: cannot measure their quality; overall pipeline score comes from fallback V.",
             "precompute_ms":[x["precomputeMs"]for r in addon.values()for x in r.get("providerAudit",[]) if x.get("stage")=="goal-only-precompute"],
             "matching":">=2 meaningful distinct trigger words and >=75% overlap; negative sentences refuse; miss uses unchanged V; Guest translation preserved"},
    "budget_micro":budget,"series_held_micro":sum(budget.values()),
    "historical_ledger_integrity":integrity,
    "cache_write_contingency_micro":cache_plan["amountMicro"],
    "provider_unknown_micro":sum(e["reserve"]for e in ledger["entries"]if e["status"]=="unknown"and e["kind"]!="accounting-contingency"),
    "factor_execution":load(ROOT/"c-factor-runs.json"),
    "price_source":"https://developers.openai.com/api/docs/models/gpt-5.6-terra",
    "price_micro_per_token":{"input":2,"cached":.2,"output":12,"cache_write_30m":2.5},
    "cost_basis":"Conservative usage/rate estimate plus FULL provider unknown and historical cache-write contingency. New missing-write breakdown uses maximum premium. Not provider invoice. No history repricing.",
    "cost_whole_primary_a_attempts_usd":(sum(r["chargedMicro"]for r in a.values())+historical_premium(a,set(a)))/1e6,
    "cost_whole_primary_c_attempts_usd":(sum(r["chargedMicro"]for r in c.values())+historical_premium(c,set(c)))/1e6,
    "tests":{"files":len(tests["testResults"]),"passed":tests["numPassedTests"],"failed":tests["numFailedTests"]},
    "latency_method":"First displayable English word minus same-channel unpadded physical VAD end; 1x per recording. Unique physical end key, never turn ordinal.",
    "quality_method":"Same gpt-4.1-mini blind judge, four dimensions; unweighted call means. Quality scores cover each valid call's eligible turns, not just intersected latency samples. Incomplete cohort quality is null.",
    "factor_method":"Each factor against V full/.7/3000. No prompt+Flux combination; .7/.6/.5 threshold with timeout fixed. Small panel, provider-auto cache, order not randomized.",
    "live_readiness":{"enabled":False,"live_code_changed":False,
                      "blocking_reliability_failures":len(format_failures),
                      "note":"No automatic product acceptance. Original V emitted malformed JSON on corpus; no live rollout until hardened and independently checked."},
    "scope":"New isolated polygon only. D and E closed at paid CLI gate; native deferred; standalone cards replaced by additive experiment. No calls, Katya, live Hint, agents or Publish.",
    "sources":{str(p):digest(p)for p in(ROOT/"trials").glob("*/rows/*.json") if p.parent.parent.name in {
        "a-qc30-goal-full","c-goal-panel","c-clean-panel","c-expanded-goal","c-expanded-tail",
        "c-short-three","c-flux-060","c-flux-050","c-cards-addon"}},
}
write("report.json",report)
with(OUT/"comparison.csv").open("w",encoding="utf-8-sig",newline="")as f:
    writer=csv.DictWriter(f,fieldnames=table[0].keys());writer.writeheader();writer.writerows(table)
def fmt(v): return "—" if v is None else f"{v/1000:.2f}"
lines=["# Hint — расширение В и однофакторные опыты",
       "", "На независимую проверку. Не приёмка рабочего Hint.", "",
       "## Основной корпус",
       f"Запрошено 15 с сохранённой целью. В: {report['primary_attempted_c']} попыток, {report['primary_valid_c']} действительных. "
       f"А/В сравниваются на {len(common)} общих действительных записях, {len(primary_anchor)} общих уникальных физических VAD-концах.",
       "Успешные старые В переиспользованы без новой оплаты. Прежние unknown не повторялись. Невалидные ответы не выдаются за скорость.",
       "Одна общая серия $15, без сброса дня/процесса. Расходы невалидных попыток и резервы unknown включены.", "",
       "## Таблица",
       "| Корпус | Вариант | Первое слово p50/p95, с | Подсказки / опорные VAD-концы | Качество / 5 | Цена попыток, верхняя оценка $ |",
       "|---|---|---:|---:|---:|---:|"]
for r in table:
    q="— (неполно)" if r["quality_0_to_5"] is None else f"{r['quality_0_to_5']:.2f}"
    lines.append(f"| {r['cohort']} | {r['variant']} | {fmt(r['first_word_p50_ms'])} / {fmt(r['first_word_p95_ms'])} | {r['hints_on_reference']} / {r['reference_vad_ends']} | {q} | {r['cost_attempts_usd']:.6f} |")
lines+=["", "Цены в строках основного сравнения относятся только к общим действительным записям; "
        "полная цена всех попыток и отказы — в report.json и ledger. В факторной панели цена включает все попытки трёх записей.",
        "Быстрота среди выданных ответов не компенсирует пропуски или невалидные звонки. "
        "У всех факторов одинаковый набор аудио; часть VAD-концов может исчезнуть при другом Flux. Это показано в покрытии, а не скрыто.",
        "Пустая подсказка иногда корректна (например, простое подтверждение без вопроса); не каждый пропуск означает ошибку. Это оценивает судья.",
        "", "## Границы метода",
        "- В полном корпусе — исходный В, без скрытого JSON-mode или замены промпта. INVALID_HINT_JSON — известный оплаченный ответ, не unknown.",
        "- Дословный невалидный ответ не сохранялся ради приватности; конкретную синтаксическую ошибку задним числом не восстанавливаем.",
        "- API request body не содержит response_format. Требование JSON пока задано промптом, а не строгой API-схемой. Это кандидат причины, не доказательство формы исторического ответа.",
        "- В коротком промпте остаются цель, последние три полные реплики и правила заземления. Русский перевод — тот же второй запрос.",
        "- Flux: 0.7 контроль; 0.6 и 0.5 — по одному изменённому threshold, timeout всегда 3000 мс. Eager/speculation выключены.",
        "- Карточки делаются до аудиочасов только из цели. Промах запускает В; попадание не убирает перевод Guest. Precompute — отдельное время/расход.",
        f"- Карточки: {sum(eligible_hits)}/{len(eligible_hits)} попаданий на пригодных репликах. При нуле попаданий качество самих карточек не измерено; балл конвейера относится к fallback В.",
        "- Судья — тот же gpt-4.1-mini. Это машинная оценка подсказок, не ручная приёмка STT или iPhone.",
        "- Cache provider-auto, порядок опытов не рандомизирован. Маленькая панель — разведочный результат, не доказательство на всех 15.",
        "", "## Деньги",
        f"Учтено ${sum(budget.values())/1e6:.6f}: known usage estimate ${budget['spent']/1e6:.6f}, "
        f"provider unknown ${report['provider_unknown_micro']/1e6:.6f}, historical cache-write contingency ${cache_plan['amountMicro']/1e6:.6f}.",
        "Terra: $2 вход / $0.20 cached / $12 выход за 1M на официальной карточке модели: "
        "https://developers.openai.com/api/docs/models/gpt-5.6-terra . Cache write 30m — $2.50 за 1M: "
        "https://developers.openai.com/api/docs/guides/prompt-caching . Подтверждённые страницы в evidence.",
        "Старые начисления не переписаны. Добавлен отдельный верхний резерв 25% исторических Terra-расходов. "
        "Это завышенная граница (включает и output), не ещё один расход провайдера. "
        "В цене старых строк таблицы показана их доля этого резерва, без двойного списания из ledger.",
        "Новые запросы учитывают cache_write_tokens; если разбивки нет — консервативно считают весь не-cached вход по write-тарифу.",
        "", "## Тесты",
        f"{report['tests']['files']} файлов; {report['tests']['passed']} passed; {report['tests']['failed']} failed. "
        "TypeScript отдельно. Это изолированный полигон плюс регрессии прежнего стенда/провайдера, НЕ полный Vitest приложения.",
        "", "## Подготовка рабочего включения",
        "Пока НЕ выполнена: у исходного В есть отказы формата на большом корпусе, условие надёжной готовности не подтверждено.",
        "Не добавляли переключатель, который на деле не управляет рабочим Hint. Production и iOS не менялись.",
        "Перед переносом: защитить формат ответа, проверить чтение частичного English и обновление одной карточки с переводом "
        "(без дублей/устаревших подсказок), сохранить Translation OFF, Hints OFF, grounding, carryover, CHOICE и стратегии.",
        "Предлагаемый будущий режим — один owner-only runtime enum legacy/english-first, default legacy. "
        "После единственной поставки механизма переключение/откат без нового Publish; ранее начатые ответы отсекать epoch. "
        "Включение только после отдельного «да» владельца и независимой проверки, затем его пробный звонок.",
        "", "## Не проверено",
        "Живой звонок, iPhone/сеть/видимость частичных слов, реальные счета провайдеров, "
        "полный корпус для каждого отдельного фактора, статистическая значимость, фактическая форма исторического невалидного JSON.",
        "", "Подробности: report.json, comparison.csv, source snapshots, control journal и ledger. Без аудио, целей, транскриптов и ключей."]
(OUT/"README.md").write_text("\n".join(lines)+"\n")
zip_path=Path("generated-artifacts/Hint_English_First_Followups_Review.zip")
items={f"report/{p.name}":p for p in OUT.iterdir() if p.is_file() and p.name!="SHA256SUMS.json"}
for name in ("series-ledger.json","terra-pricing-confirmed.json","openai-cache-write-pricing.json",
             "historical-cache-write-contingency.json","pricing-accounting-hold.json","c-factor-runs.json",
             "c-followup-control.json","c-followup-control-v2.json","c-followup-control-v3.json",
             "tests-c-followups-budget-final.json","tests-c-followups-budget-final.log","typecheck-c-followups-budget-final.log"):
    p=ROOT/name
    if p.exists(): items["evidence/"+name]=p
trials={Path(p).parent.parent.name for p in report["sources"]}
for trial in trials:
    directory=ROOT/"trials"/trial
    for p in directory.glob("*.json"):
        if p.name in ("execution.json","summary.json","source-snapshot.json","prompt-registry.json"):
            items[f"attempts/{trial}/{p.name}"]=p
    for p in (directory/"rows").glob("*.json"):items[f"attempts/{trial}/rows/{p.name}"]=p
for p in Path("server/hintPolygon").rglob("*.ts"):items["current-source/"+str(p)]=p
for name in ("scripts/hint-polygon.ts","scripts/continue-hint-c-experiments.mjs","scripts/package-hint-c-followups.py",
             "scripts/hint-c-factors.mjs","scripts/hint-polygon-cache-budget.ts",
             "shared/prompts.ts","server/hintProvider.ts","server/hintShape.ts","server/hintActionResults.ts"):
    items["current-source/"+name]=Path(name)
checksums={name:digest(p)for name,p in sorted(items.items())}
write("SHA256SUMS.json",checksums)
items["report/SHA256SUMS.json"]=OUT/"SHA256SUMS.json"
with zipfile.ZipFile(zip_path,"w",zipfile.ZIP_DEFLATED)as z:
    for name,p in sorted(items.items()):z.write(p,name)
print(json.dumps({"zip":str(zip_path),"held_usd":sum(budget.values())/1e6,"primary_valid_c":report["primary_valid_c"],
                  "primary_format_failures":len(format_failures),"rows":table},ensure_ascii=False))
