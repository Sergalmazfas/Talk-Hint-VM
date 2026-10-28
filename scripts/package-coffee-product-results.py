"""Offline integrity checks and owner-readable export; never executes a model."""
import json
import hashlib
import html
import re
import zipfile
from pathlib import Path

out = Path("generated-artifacts/coffee-product-decisions")
x = json.loads((out / "results.json").read_text())
r = json.loads((out / "review-results.json").read_text())
after = json.loads((out / "model-results.json").read_text())
authorized = json.loads((out / "model-authorized.json").read_text())
assert after["revision"] == 837
assert after["operatingModel"] == authorized["operatingModel"]
allowed = {"DOC-TALKHINT-IMPROVEMENT-JOURNAL", "DOC-HINT-FAST-DIALOGUE-TRIAL"}
assert [d for d in after["documents"] if d["id"] not in allowed] == [
    d for d in authorized["documents"] if d["id"] not in allowed]
assert len(x["results"]) == 54 and len(x["judges"]) == 9
assert len({(v["fixtureId"], v["variantId"]) for v in x["results"]}) == 54
assert all(v["retries"] == 0 for v in x["results"] + x["judges"])
corpus = json.loads(Path("generated-artifacts/hint-owner-feedback-1/corpus.json").read_text())
for fixture in x["fixtures"]:
    lines = corpus[fixture["callIndex"]]["transcript"].split("\n")
    lines = [line for line in lines if line]
    assert fixture["history"] == "\n".join(lines[:fixture["guestLineIndex"]])
    assert fixture["guest"] == lines[fixture["guestLineIndex"]].replace("Guest:", "", 1).strip()
assert len(r["pairs"]) == 5
assert r["summary"]["generationsCompleted"] == 53
assert r["summary"]["judgedOutputs"] == 47
assert r["summary"]["generatedOutputsWithoutValidJudge"] == 6
assert r["summary"]["qualityGateStatus"].startswith("не пройдена")
assert r["nextDecisionRequest"]["ownerAnswer"] is None
for d in after["documents"]:
    if d["id"] in allowed:
        (out / f"{d['id']}.json").write_text(json.dumps({
            "revision": after["revision"], "documentId": d["id"], "title": d["title"],
            "textSha256": hashlib.sha256(d["text"].encode()).hexdigest(),
            "content": json.loads(d["text"]),
        }, ensure_ascii=False, indent=2))
validation = dict(
    finalRevision=837, operatingModelVersion=38, journalVersion=7, trialDocumentVersion=2,
    sourceDocumentsPreserved=True, oldExperimentPreserved=True,
    generationRows=54, separateJudgeRows=9, noRetries=True,
    futureTranscriptNotUsed=True, beforeAfterPairs=5,
    productionChanged=False, iPhoneTestPerformed=False,
    gmailReadPerformed=False, scheduleChanged=False,
    scope="Проверка целостности опыта; не независимая QA, не приёмка владельца",
)
(out / "VALIDATION.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2))
(out / "next_needs_decision.json").write_text(json.dumps(r["nextDecisionRequest"], ensure_ascii=False, indent=2))
esc = lambda text: html.escape(str(text))
cards = []
for v in r["summary"]["table"]:
    cards.append(f"""<article><h3>{esc(v['label'])}</h3>
<dl><dt>Ответы</dt><dd>{v['success']} из {v['scheduled']}</dd>
<dt>Время текста p50 / p95</dt><dd>{v['completeJsonP50Ms']} / {v['completeJsonP95Ms']} мс</dd>
<dt>Цель, по AI-судье</dt><dd>да {v['goalRetained']}; частично {v['goalPartial']}; нет {v['goalNo']}; неизвестно {v['goalUnknown']} — из {v['judged']} оценённых</dd>
<dt>Метки выдумки у судьи</dt><dd>{v['hintsWithInventedFacts']} из {v['judged']}; не эталон — есть пропуски и спорные метки</dd>
<dt>Факты цели вовремя, AI</dt><dd>{v['goalUsedTimely']} из {v['goalOpportunities']} отмеченных возможностей</dd>
<dt>Слов EN: медиана / максимум</dt><dd>{v['totalEnglishWordsP50']} / {v['maxEnglishWords']}</dd>
<dt>Карточек JSON: медиана / максимум</dt><dd>{v['jsonCardsP50']} / {v['maxJsonCards']}</dd></dl></article>""")


def phrase(s):
    if s["type"] == "choice":
        return " / ".join(o["en"] for o in s["options"])
    return s.get("en") or s.get("native_helper", "Нужен ответ владельца")


pairs = []
for i, p in enumerate(r["pairs"], 1):
    pairs.append(f"""<article><h3>{i}. {esc(p['call'])}</h3>
<p>Собеседник: {esc(p['guest'])}</p>
<p class="label">Было — реконструкция Dev-промпта</p><blockquote>{esc(phrase(p['before']))}</blockquote>
<p class="label">Стало — вариант стенда, не продукта</p><blockquote>{esc(phrase(p['after']))}</blockquote>
<p>{p['beforeMs']} → {p['afterMs']} мс; карточек {p['beforeCards']} → {p['afterCards']}.</p>
<p class="muted">{esc(p['judge']['explanation'])}</p></article>""")
findings = "".join(f"<li>{esc(f['conclusion'])}</li>" for f in r["engineeringReview"]["findings"])
limits = "".join(f"<li>{esc(l)}</li>" for l in r["limitations"])
document = f"""<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hint · кофейня · результаты согласованного стенда</title>
<style>body{{margin:0;background:#f3f7f7;color:#152b2b;font:16px/1.55 system-ui,sans-serif}}
main{{max-width:980px;margin:auto;padding:22px}}h1{{font-size:29px;line-height:1.2}}h2{{margin-top:34px}}
article,.note{{background:white;border:1px solid #cddedc;border-radius:14px;padding:18px;margin:14px 0}}
.warning{{background:#fff3dd;border-color:#ddb873}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:14px}}
.grid article{{margin:0}}dt{{font-size:14px;color:#47605f;margin-top:12px}}dd{{margin:0;font-weight:600}}
blockquote{{margin:8px 0;padding:12px;background:#eaf4f1;border-radius:8px}}.muted,.label{{color:#47605f}}
.label{{font-size:14px;margin-bottom:0}}a{{color:#086b5b}}li{{margin:10px 0}}</style>
<main><p>P.LAB → HEAD.07 → P.PRODUCT · Dev · rev837</p>
<h1>Кофейня №1: что показал текстовый стенд</h1>
<p>53 из 54 ответов; отдельный gpt-5.2 проверил 47 ответов в 8 из 9 групп.
Один запрос генерации дал API 500, один протокол судьи неполный. Без повторов.</p>
<div class="note warning"><strong>QA-гейт не пройден. В продукт ничего не переносилось.</strong>
Mini быстрее в этой выборке, но добавляет неподтверждённый факт про посадку крышки.
AI-судья это пропустил. Ноль меток у судьи не означает ноль ошибок.</div>
<h2>Варианты</h2><p>Время — до полного JSON, не до экрана. По 8–9 наблюдений, без повторов;
p95 — не обещание скорости. Карточки — структура ответа, а не проверка iPhone.</p>
<div class="grid">{''.join(cards)}</div>
<h2>Пять пар «было → стало»</h2><p>Пары демонстрируют и улучшения формулировки,
и компромиссы. Это не принятый новый продукт.</p>{''.join(pairs)}
<h2>Проверка источников HEAD.07</h2><p>Не независимая QA и не сплошной эталон всех ответов.</p><ul>{findings}</ul>
<h2>Ограничения</h2><ul>{limits}</ul>
<h2>Что согласовано, но не включено</h2><ul>
<li>Gmail: подготовлен контракт чтения только ответов владельца в разрешённых цепочках лаборатории.
Reader не реализован, доступ роли не выдан, почта в этом запросе не читалась.</li>
<li>Недельный продуктовый блок: понедельник 08:00 America/Denver в письме P.OPS.
Подготовлен контракт; renderer и расписание не менялись.</li></ul>
<h2>Следующее «Нужно решение»</h2>
<p>Разрешить следующий только текстовый стенд Mini с усилениями против Mini без усилений:
9 моментов × 2 варианта × 3 повтора, максимум 54 генерации и 9 отдельных проверок,
без автоматических повторов? Сначала зафиксировать эталон фактов и исправить рубрику судьи.
Цена API неизвестна; новые подписки не нужны. Без вашего ответа запусков не будет.</p>
<p class="muted">Существующий журнал v7, документ стенда v2; книга и roadmap не получают
статус внедрения. Сумма расходов неизвестна; usage сохранена в ZIP, это не счёт.</p></main></html>"""
html_path = out / "Hint_coffee_results_rev837.html"
html_path.write_text(document)
names = ["REPORT.md", html_path.name, "review-results.json", "results.json",
         "reservation.json", "execution-complete.json", "owner_authorization.json",
         "gmail_reply_preparation.json", "weekly_product_block_preparation.json",
         "next_needs_decision.json", "VALIDATION.json",
         "DOC-TALKHINT-IMPROVEMENT-JOURNAL.json", "DOC-HINT-FAST-DIALOGUE-TRIAL.json"]
manifest = {}
for name in names:
    data = (out / name).read_bytes()
    assert not re.search(rb"\bsk-(?:proj-)?[A-Za-z0-9_-]{28,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----", data)
    manifest[name] = hashlib.sha256(data).hexdigest()
(out / "SHA256SUMS.json").write_text(json.dumps(manifest, indent=2))
archive = Path("generated-artifacts/Hint_coffee_lab_results_rev837.zip")
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
    for name in names + ["SHA256SUMS.json"]:
        z.write(out / name, name)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for name, digest in json.loads(z.read("SHA256SUMS.json")).items():
        assert hashlib.sha256(z.read(name)).hexdigest() == digest
print(json.dumps(dict(zip=str(archive), html=str(html_path), bytes=archive.stat().st_size,
                      validation=validation), ensure_ascii=False))
