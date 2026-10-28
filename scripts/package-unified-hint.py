"""Static, self-contained delivery; no queries or runtime in the HTML."""
from pathlib import Path
import json, hashlib, zipfile
from html import escape

p = Path("generated-artifacts/hint-unified-preflight")
r = json.loads((p / "report.json").read_text())
e = escape
header = """<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Hint — единая линейка моделей</title>
<style>body{margin:0;background:#f6f8f8;color:#132d2b;font:17px/1.55 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:24px}
h1{font-size:30px;line-height:1.2}h2{margin-top:36px;font-size:23px}.note{padding:18px;border-left:4px solid #a86300;background:#fff5dd}
.scroll{overflow:auto}table{border-collapse:collapse;min-width:760px;width:100%;background:white}th,td{padding:13px;text-align:left;border-bottom:1px solid #d7e1df}
th{font-size:14px;vertical-align:bottom}details{padding:14px 0;border-bottom:1px solid #ccd7d4}summary{cursor:pointer;font-weight:650}
blockquote{margin:14px 0;padding:14px;background:#fff;border-left:3px solid #147e70}pre{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
small{color:#4c6461}a{color:#066a5b}li{margin-bottom:8px}@media(max-width:600px){main{padding:17px}h1{font-size:27px}}
</style><main>"""
html = [header, "<p><small>P.LAB → P.PRODUCT · Dev · 27 октября 2026, Денвер</small></p>",
    "<h1>Скорость измерена.<br>Выбор по качеству пока заблокирован.</h1>",
    "<p class='note'>450 генераций на четырёх сохранённых звонках. 448 ответов разобраны. "
    "Провайдер вернул 429 credit_balance_exhausted на 524 запроса судьи. "
    "Из 112 разобранных оценок 64 отвергнуты первой сверкой; у судьи также обнаружены ложные штрафы. "
    "<strong>Не объявляем победителя и ничего не включаем.</strong></p>",
    "<p>Один и тот же нынешний промпт, без усилений. Только текст: августовский Fixture #2 и три октябрьских звонка. "
    "90 срезов × 5 моделей. Эталон фактов зафиксирован до вызовов; это разметка сохранённого текста, не проверенная владельцем аудиорасшифровка.</p>",
    "<h2>Единая таблица</h2><div class='scroll'><table><thead><tr><th>Модель</th><th>Полный ответ p50 / p95, мс</th>"
    "<th>Разобрано</th><th>Слов в карточке p50 / max</th><th>Карточек p50 / max</th><th>Качество</th></tr></thead><tbody>"]
for row in r["models"]:
    html.append("<tr>"+"".join(f"<td>{e(str(v))}</td>" for v in [
        row["model"], f'{row["fullOutputP50Ms"]:.0f} / {row["fullOutputP95Ms"]:.0f}', f'{row["parsedUsable"]}/90',
        f'{row["cardWordsP50"]} / {row["cardWordsMax"]}', f'{row["cardsP50"]} / {row["cardsMax"]}', "неизвестно"])+"</tr>")
html += ["</tbody></table></div><p><small>Скорость — полный ответ API, не время до экрана. p50/p95: nearest-rank по 90 полученным ответам, включая два неразобранных. "
    "Длина и карточки — после нынешнего нормализатора, по разобранным ответам. Sol не отсеиваем по скорости. "
    "Удержание цели, выдумки, ответ за владельца и подхват фактов не имеют надёжного итогового балла.</small></p>",
    "<h2>Три различия ответов</h2><p>Это примеры на одном и том же моменте, а не «исправлено в продукте» и не доказанный живой эффект.</p>"]
for example in r["exampleComparisons"]:
    html += [f"<details><summary>{e(example['moment'])}</summary><p>Собеседник: {e(example['guest'])}</p>",
        "<blockquote><b>"+e(example["before"]["model"])+"</b><br>"+e(" / ".join(c["en"] for c in example["before"]["cards"]))+"</blockquote>",
        "<p>→</p><blockquote><b>"+e(example["after"]["model"])+"</b><br>"+e(" / ".join(c["en"] for c in example["after"]["cards"]))+"</blockquote>",
        "<p>"+e(example["observation"])+"</p></details>"]
html += ["<h2>Август: что можно и нельзя заключить</h2>",
    "<p>Сохранены 188 прежних ответов и оригинальные баллы двух прогонов 15 августа. Их повторная оценка новым судьёй неполна. "
    "Прежний судья Sol оценивал и собственные ответы; баллы были не у всех попыток. "
    "Исходные оценки не переписаны. Отдельные пары в JSON — материал проверки судьи, не численное доказательство ухудшения или улучшения модели.</p>"]
for run in r["oldAugustAggregates"]:
    html.append("<details><summary>Исходный августовский прогон "+e(run["runId"][:8])+"</summary><ul>")
    for c in run["candidates"]:
        html.append("<li>"+e(c["model"])+": среднее полного ответа "+e(str(c["avgFullOutputMs"]))+
            " мс; старый overall "+e(str((c.get("judgeAverages") or {}).get("overall_live_copilot_quality")))+
            " из 10. Это не p50/p95 и не оценка пользы на iPhone.</li>")
    html.append("</ul></details>")
html += ["<h2>Нужно решение</h2><ol>"]
for d in r["decisionRequest"]["rows"]:
    html.append("<li><strong>"+e(d["question"])+"</strong><br>"+e(d["recommendation"])+"<br><small>Решение владельца не получено.</small></li>")
html += ["</ol><h2>Вызовы и стоимость</h2>",
    f'<p>{r["execution"]["attempted"]} попыток API из максимум 1088. Повторов нет. '
    f'По полученному usage × опубликованный тариф: <b>${r["billing"]["usagePricedUSD"]:.2f}</b>. '
    f'Для {r["billing"]["unknownUsageRequests"]} ошибок usage отсутствует; удержанная расчётная верхняя граница — '
    f'${r["billing"]["unknownUsageReservedUpperUSD"]:.2f}. Итого консервативная верхняя граница '
    f'${r["execution"]["chargedConservativeUSD"]:.2f} из разрешённых $35. <b>Это не счёт и не подтверждение списания всей этой суммы.</b></p>',
    "<p>Продолжать задания после исчерпания квоты было ошибкой runner. После этого прогона добавлен общий останов по такой ошибке. "
    "Offline-проверки пройдены; новые платные проверки не выполнялись.</p>",
    "<h2>Детали и ограничения</h2><ul>"]+["<li>"+e(v)+"</li>" for v in r["limitations"]]+["</ul>"]
for c in r["byCall"]:
    html.append("<details><summary>"+e(c["label"])+" — подробные счётчики</summary><pre>"+e(json.dumps(c, ensure_ascii=False, indent=2))+"</pre></details>")
html.append("<p><small>Существующий случай "+e(r["caseId"])+". SHA-256 эталона: "+e(r["frozenReferenceSHA256"])+". "
    "Продукт, телефония, аккаунты, аудио, почта и публикация не менялись. Независимая модель ≠ приёмка владельца.</small></p></main></html>")
page = "\n".join(html)
assert len(page.encode()) < 5_242_880
(p / "REPORT.html").write_text(page)
allowed = ["REPORT.html","REPORT.md","report.json","violations.json","preflight.json","prices.json",
    "REFERENCE_FREEZE.json","frozen-reference-v1.json","old-answers-preserved.json",
    "OFFLINE_CHECKS.json","readback-results.json","execution/generations.json","execution/judgments.json",
    "execution/ledger.jsonl","execution/execution-complete.json","execution/reservation.json"]
assert all((p/a).exists() for a in allowed)
manifest = {a: hashlib.sha256((p/a).read_bytes()).hexdigest() for a in allowed}
(p / "MANIFEST.json").write_text(json.dumps(manifest, indent=2))
zip_path = p / "TalkHint_unified_models_partial_v1.zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for name in allowed+["MANIFEST.json"]: z.write(p/name, name)
with zipfile.ZipFile(zip_path) as z:
    assert z.testzip() is None
    for name, sha in manifest.items(): assert hashlib.sha256(z.read(name)).hexdigest() == sha
    for name in z.namelist():
        if name.endswith(".json"): json.loads(z.read(name))
print(json.dumps({"zip": str(zip_path), "zipBytes": zip_path.stat().st_size, "htmlBytes": len(page.encode()),
    "files": len(allowed)+1, "manifestVerified": True}))
