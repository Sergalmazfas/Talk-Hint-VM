"""Offline owner export and integrity checks, no network."""
import hashlib
import html
import json
import re
import zipfile
from pathlib import Path

p = Path("generated-artifacts/hint-mini-repeat")
r = json.loads((p / "report.json").read_text())
x = json.loads((p / "results.json").read_text())
before = json.loads((p / "model-before-authorized.json").read_text())
after = json.loads((p / "model-results.json").read_text())
assert after["operatingModel"] == before["operatingModel"]
changed = {"DOC-TALKHINT-IMPROVEMENT-JOURNAL", "DOC-HINT-FAST-DIALOGUE-TRIAL"}
assert [d for d in before["documents"] if d["id"] not in changed] == [
    d for d in after["documents"] if d["id"] not in changed]
trial = next(d for d in after["documents"] if d["id"] == "DOC-HINT-FAST-DIALOGUE-TRIAL")
old_trial = json.loads(next(d for d in before["documents"] if d["id"] == trial["id"])["text"])
new_trial = json.loads(trial["text"])
assert new_trial["authorizedProductIteration"] == old_trial["authorizedProductIteration"]
assert new_trial["miniRepeatedExperiment"] == r
journal = json.loads(next(d for d in after["documents"] if d["id"] == "DOC-TALKHINT-IMPROVEMENT-JOURNAL")["text"])
case = next(c for c in journal["cases"] if c["caseId"] == "HINT-OWNER-FEEDBACK-001")
assert next(d for d in case["productDecisionRequests"] if d["id"].endswith("/2"))["ownerAnswer"] == "да, только стенд"
assert r["summary"]["generations"] == 54 and r["summary"]["judgeGroups"] == 9
assert r["summary"]["judgedOutputs"] == 48 and r["summary"]["unknownQuality"] == 6
corpus = json.loads(Path("generated-artifacts/hint-owner-feedback-1/corpus.json").read_text())
for f in x["fixtures"]:
    lines = [line for line in corpus[f["callIndex"]]["transcript"].split("\n") if line]
    assert f["history"] == "\n".join(lines[:f["guestLineIndex"]])
    assert f["guest"] == lines[f["guestLineIndex"]].removeprefix("Guest:").strip()
for f in x["fixtures"]:
    for v in x["variants"]:
        rows = [row for row in x["results"] if row["fixtureId"] == f["id"] and row["variantId"] == v["id"]]
        assert sorted(row["repeat"] for row in rows) == [1, 2, 3]
        assert len({row["inputSha256"] for row in rows}) == 1
assert all(row["retries"] == 0 for row in x["results"] + x["judges"])
receipt = dict(
    revision=after["revision"], journalVersion=journal["version"],
    trialDocumentId=trial["id"], trialVersion=new_trial["version"],
    caseId=case["caseId"], operatingModelUnchanged=True, unrelatedDocumentsUnchanged=True,
    oldExperimentPreserved=True, noFutureTranscript=True, fixedInputsAcrossRepeats=True,
    generationRequests=54, separateJudgeRequests=9, automaticRetries=0,
    modelReaderVerified=all(d["readerVerified"] for d in json.loads((p / "readback-results.json").read_text())),
    productionChanged=False, callMade=False, audioProcessed=False, emailSent=False,
    ownerAcceptance=None,
    sourceVersions=[
        dict(id=d["id"], title=d["title"], sha256=hashlib.sha256(d["text"].encode()).hexdigest())
        for d in after["documents"] if d["id"] in changed or d["id"] in [
            "DOC-TALKHINT-PRODUCT-PASSPORT", "DOC-TALKHINT-CHAPTER-HINT", "DOC-PLAB-WORK-PACKAGE"]])
(p / "VALIDATION.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
(p / "saved-case.json").write_text(json.dumps(dict(
    revision=after["revision"], journalVersion=journal["version"], case=case), ensure_ascii=False, indent=2))
esc = lambda t: html.escape(str(t))
cards = []
for t in r["summary"]["table"]:
    label = "Mini: исходный промпт" if t["variant"] == "mini_baseline" else "Mini: факты + цель + краткость"
    g = t["goal"]
    cards.append(f"""<article><h3>{label}</h3><dl>
<dt>Ответы</dt><dd>{t['completed']} из 27</dd>
<dt>Полный JSON: p50 / p95</dt><dd>{t['p50Ms']} / {t['p95Ms']} мс</dd>
<dt>Слов: медиана / максимум</dt><dd>{t['wordsMedian']} / {t['wordsMax']}</dd>
<dt>Карточек: медиана / максимум</dt><dd>{t['cardsMedian']} / {t['cardsMax']}</dd>
<dt>Одна карточка ≤12 слов</dt><dd>{t['shortSingleOutputs']} из 27; это не доказательство чтения за секунду</dd>
<dt>Цель по судье: да / частично / нет / ?</dt><dd>{g['yes']} / {g['partial']} / {g['no']} / {g['unknown']} из {t['judged']}; ещё {t['qualityUnknown']} оценки отклонены</dd>
<dt>Метки неподтверждённых фактов AI</dt><dd>{t['issuesPerOutput']['unsupported_fact']} из {t['judged']}; судья пропускает ошибки, это не истинная частота</dd>
</dl></article>""")


def phrase(v):
    if v is None: return "Нет успешного ответа"
    s = v["suggestion"]
    return " / ".join(o["en"] for o in s["options"]) if s["type"] == "choice" else s["en"]


pairs = []
for pair in r["beforeAfterPairs"]:
    pairs.append(f"""<article><h3>{esc(pair['call'])} · {esc(pair['fixtureId'])}</h3>
<p>Собеседник: {esc(pair['guest'])}</p><p class="label">Было — Mini исходный</p>
<blockquote>{esc(phrase(pair['before']))}</blockquote><p class="label">Стало — Mini усиленный, не продукт</p>
<blockquote>{esc(phrase(pair['after']))}</blockquote>
<p>{pair['beforeMs']} → {pair['afterMs']} мс. Первый повтор заранее фиксирован, не выбран лучший.</p></article>""")
findings = "".join(f"<li>{esc(f['finding'])}</li>" for f in r["engineeringReview"]["findings"])
limits = "".join(f"<li>{esc(l)}</li>" for l in r["limitations"])
document = f"""<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hint · повторный стенд Mini · rev{after['revision']}</title>
<style>body{{margin:0;background:#f2f6f5;color:#17332e;font:16px/1.6 system-ui,sans-serif}}
main{{max-width:960px;margin:auto;padding:20px}}h1{{font-size:28px;line-height:1.25}}
h2{{margin-top:32px}}article,.note{{background:white;border:1px solid #ceded9;border-radius:14px;padding:18px;margin:16px 0}}
.warning{{background:#fff2dc;border-color:#d9b575}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:14px}}
.grid article{{margin:0}}dt,.label{{color:#4b645d;font-size:14px}}dt{{margin-top:12px}}
dd{{margin:0;font-weight:600}}blockquote{{margin:6px 0;padding:12px;background:#e9f3ef;border-radius:8px}}
li{{margin:12px 0}}.muted{{color:#4b645d}}</style>
<main><p>P.LAB → HEAD.07 → P.PRODUCT · Только Dev · rev{after['revision']}</p>
<h1>Mini: короче — не значит надёжнее</h1>
<div class="note warning"><strong>QA-гейт не пройден. Перенос в рабочий Hint не рекомендован.</strong>
<p>Усиленный вариант стал короче, но всё ещё выбирает неизвестные факты за владельца.
Устойчивая победа по скорости и качеству не получена.</p></div>
<p>9 моментов из трёх сохранённых звонков × 2 варианта × 3 повтора: 54 из 54 ответов.
Отдельный судья gpt-5.2 вернул 9 из 9 протоколов. Один протокол по 6 ответам отклонён offline:
судья принял перевод Guest за утверждение Owner. Повторов запросов не было.</p>
<h2>План / факт</h2><div class="grid">{''.join(cards)}</div>
<p>Это время полного ответа модели, не speech-end → экран. p95 — выборочная статистика,
не обещание скорости. Оценки цели и фактов AI приведены отдельно от обзора источников.</p>
<h2>Ошибки и ограничения QA</h2><ul>{findings}</ul>
<h2>Пять пар «было → стало»</h2><p>Не все пары являются улучшениями.</p>{''.join(pairs)}
<h2>Что сохранено</h2><p>Тот же случай HINT-OWNER-FEEDBACK-001;
журнал v{journal['version']}, существующий документ стенда v{new_trial['version']}.
Предыдущие опыты сохранены. Книга v14, глава Hint v3 и операционная модель не менялись.
Чтение через штатный get_document сверено с сохранёнными данными.</p>
<h2>Рекомендация P.PRODUCT</h2><p>{esc(r['recommendation']['decision'])}.
{esc(r['recommendation']['nextStep'])}. Дополнительные вызовы не разрешены этим отчётом.</p>
<h2>Границы доказательств</h2><ul>{limits}</ul>
<p class="muted">Никаких новых звонков, аудио, писем, публикации, включения ролей или изменений production.
API usage: 256516 входных и 9574 выходных токена по 63 запросам; сумма расходов неизвестна, это не счёт.</p>
</main></html>"""
html_path = p / f"Hint_Mini_repeat_rev{after['revision']}.html"
html_path.write_text(document)
names = ["REPORT.md", "report.json", "results.json", "engineering-review.json",
         "fact-reference.json", "reservation.json", "execution-complete.json",
         "VALIDATION.json", "saved-case.json", html_path.name]
hashes = {}
for name in names:
    data = (p / name).read_bytes()
    assert not re.search(rb"\bsk-(?:proj-)?[A-Za-z0-9_-]{28,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----", data)
    hashes[name] = hashlib.sha256(data).hexdigest()
(p / "SHA256SUMS.json").write_text(json.dumps(hashes, indent=2))
target = Path(f"generated-artifacts/Hint_Mini_repeat_results_rev{after['revision']}.zip")
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
    for name in names + ["SHA256SUMS.json"]: z.write(p / name, name)
with zipfile.ZipFile(target) as z:
    assert z.testzip() is None
    for name, digest in hashes.items(): assert hashlib.sha256(z.read(name)).hexdigest() == digest
print(json.dumps(dict(zip=str(target), html=str(html_path), revision=after["revision"],
                      journalVersion=journal["version"], trialVersion=new_trial["version"],
                      bytes=target.stat().st_size, verified=True), ensure_ascii=False))
